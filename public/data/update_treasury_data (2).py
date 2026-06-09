"""
update_treasury_data.py
=======================
Extends treasury_data_YYYYMMDD.xlsx with the latest available data for:
  1. FX_Rates         — monthly close via Yahoo Finance (yfinance)
  2. Crop_Prices      — annual estimates for Maize, Wheat, Rice (CBOT futures)
  3. Weather_Forecast — Open-Meteo archive + forecast + ERA5 baseline extension
  4. Political_Risk   — appends latest month using political_risk_scores CSV
  5. USD_Index        — monthly DXY (ICE US Dollar Index) close via Yahoo Finance
                        Sheet is created automatically if not present in the workbook.

Weather scoring (v7 — replaces custom sqrt formula):
  drought_risk_score  →  SPI-1 (Standardised Precipitation Index, WMO-No.1090)
                         Gamma distribution fit to ERA5 historical same-month values.
                         SPI=0 → score 0  |  SPI=-3 → score 100
  flood_risk_score    →  API percentile (Antecedent Precipitation Index, k=0.90)
                         Soil-moisture accumulation normalised against historical
                         API distribution for the same period (percentile rank 0-100).

Usage
-----
  pip install yfinance openpyxl requests scipy numpy pandas python-dateutil
  python update_treasury_data.py \\
      --input  treasury_data_20260609.xlsx \\
      --output treasury_data_updated.xlsx \\
      --pol_risk political_risk_scores_YYYYMMDD.csv
"""

import argparse
import os
import time
import warnings
from datetime import datetime, date, timedelta

import numpy as np
import pandas as pd
import requests
from dateutil.relativedelta import relativedelta
from scipy import stats

warnings.filterwarnings("ignore")

# ── CLI ───────────────────────────────────────────────────────────────────────

parser = argparse.ArgumentParser()
parser.add_argument("--input",    default="treasury_data_20260609.xlsx")
parser.add_argument("--output",   default="treasury_data_updated.xlsx")
parser.add_argument("--pol_risk", default="political_risk_scores_latest.csv")
args = parser.parse_args()

INGEST_NOW = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
TODAY      = date.today()
TODAY_YM   = TODAY.strftime("%Y-%m")

# ── Config ────────────────────────────────────────────────────────────────────

ARCHIVE_URL          = "https://archive-api.open-meteo.com/v1/archive"
ARCHIVE_URL_FALLBACK = "https://historical-forecast-api.open-meteo.com/v1/historical"
FORECAST_URL         = "https://api.open-meteo.com/v1/forecast"

BASELINE_YEARS  = 5      # ERA5 years for SPI/API distributions
DOY_WINDOW      = 15     # ± days around DOY for distribution window
API_K           = 0.90   # API decay constant (tropical/subtropical soils)
TIMEOUT_SEC     = 90
MAX_RETRIES     = 4

# ── Region coordinates ────────────────────────────────────────────────────────

REGION_COORDS = {
    "ET-BA": (7.05, 40.17), "ET-ES": (8.54, 39.27),
    "ET-SI": (7.80, 38.30), "ET-WA": (7.00, 38.50),
    "KE-CT": (-0.18, 36.60), "KE-NY": (-0.09, 34.77),
    "KE-RV": (-0.78, 35.73), "KE-WR": (-0.09, 34.76),
    "NG-KD": (10.52,  7.44), "NG-KN": (12.00,  8.59),
    "NG-NC": ( 8.72,  8.53), "NG-NE": (10.52, 11.37),
    "NG-NW": (10.52,  7.44), "NG-SE": ( 6.44,  7.55),
    "NG-SW": ( 7.85,  3.93),
    "RW-EP": (-1.54, 30.46), "RW-KG": (-1.94, 30.06),
    "UG-CR": ( 0.35, 32.58), "UG-ER": ( 1.13, 34.18),
    "UG-NR": ( 2.77, 32.30), "UG-WR": (-0.61, 30.66),
}

# ── FX / Crop tickers ─────────────────────────────────────────────────────────

FX_TICKERS = {
    "ETB": "ETBUSD=X", "KES": "KESUSD=X", "NGN": "NGNUSD=X",
    "RWF": "RWFUSD=X", "UGX": "UGXUSD=X", "GHS": "GHSUSD=X",
}

CROP_TICKERS = {
    "Maize": {"ticker": "ZC=F", "conv": 39.368},
    "Wheat": {"ticker": "ZW=F", "conv": 36.744},
    "Rice":  {"ticker": "ZR=F", "conv": 22.046},
}

# ── USD Index ──────────────────────────────────────────────────────────────────

DXY_TICKER     = "DX-Y.NYB"   # ICE US Dollar Index spot, Yahoo Finance
DXY_SEED_DATE  = "2020-12-31" # fallback start date when USD_Index sheet is empty
USD_INDEX_COLS = [             # schema for sheet initialisation
    "observed_at", "index_value", "pct_change_1m",
    "ingested_at", "source", "is_interpolated",
]


# ══════════════════════════════════════════════════════════════════════════════
# HTTP helper
# ══════════════════════════════════════════════════════════════════════════════

def _get(url: str, params: dict) -> dict:
    """GET with exponential backoff; falls back to secondary archive URL on DNS failure."""
    urls = [url]
    if url == ARCHIVE_URL:
        urls.append(ARCHIVE_URL_FALLBACK)
    last_exc = None
    for attempt in range(MAX_RETRIES):
        current = urls[min(attempt, len(urls) - 1)]
        try:
            r = requests.get(current, params=params, timeout=TIMEOUT_SEC)
            r.raise_for_status()
            return r.json()
        except requests.exceptions.ConnectionError as e:
            last_exc = e
            wait = min(60, 4 * (2 ** attempt))
            note = " → switching to fallback" if attempt == 0 and len(urls) > 1 else ""
            print(f"    DNS/connection error (attempt {attempt+1}){note}, retrying in {wait}s...")
            time.sleep(wait)
        except requests.exceptions.Timeout as e:
            last_exc = e
            wait = min(60, 4 * (2 ** attempt))
            print(f"    Timeout (attempt {attempt+1}), retrying in {wait}s...")
            time.sleep(wait)
        except requests.exceptions.HTTPError:
            raise
    raise last_exc


# ══════════════════════════════════════════════════════════════════════════════
# SPI — Standardised Precipitation Index  (WMO-No.1090)
# ══════════════════════════════════════════════════════════════════════════════

def _fit_gamma_spi(value: float, hist_values: np.ndarray) -> float:
    """
    Compute SPI for one value against its ERA5 historical distribution.

    Steps:
      1. Estimate q = P(X=0) from historical zero-precipitation frequency.
      2. Fit gamma(α, β) to the nonzero historical values.
      3. Mixed CDF:  H(x) = q + (1-q) × Gamma_CDF(x)
      4. SPI = Φ⁻¹(H(x))  where Φ⁻¹ is the standard normal quantile.

    Returns SPI z-score; typical range [-3, +3].
    Negative = drier than normal → drought risk.
    """
    n      = len(hist_values)
    q      = np.sum(hist_values == 0) / n
    nz     = hist_values[hist_values > 0]
    if len(nz) < 6:
        return 0.0
    try:
        alpha, _, beta = stats.gamma.fit(nz, floc=0)
    except Exception:
        return 0.0
    cum = q if value <= 0 else q + (1 - q) * stats.gamma.cdf(value, alpha, scale=beta)
    cum = float(np.clip(cum, 0.0013, 0.9987))
    return float(stats.norm.ppf(cum))


def spi_to_drought_score(spi: float) -> float:
    """Map SPI to drought risk 0-100.  SPI=0 → 0,  SPI=-3 → 100."""
    return round(float(np.clip(-spi / 3.0 * 100.0, 0.0, 100.0)), 2)


# ══════════════════════════════════════════════════════════════════════════════
# API — Antecedent Precipitation Index
# ══════════════════════════════════════════════════════════════════════════════

def compute_api_series(precip_series: pd.Series, k: float = API_K) -> pd.Series:
    """
    API_t = P_t + k × API_(t-1)
    Represents accumulated soil moisture weighted toward recent rainfall.
    k=0.90 appropriate for tropical/subtropical soils.
    """
    api_vals, api = [], 0.0
    for p in precip_series:
        api = float(p) + k * api
        api_vals.append(api)
    return pd.Series(api_vals, index=precip_series.index)


def api_to_flood_score(api_value: float, hist_api: np.ndarray) -> float:
    """
    Percentile rank of api_value against hist_api distribution → 0-100.
    Distribution-free; naturally accounts for regional rainfall intensity.
    95th percentile soil saturation → flood score 95.
    """
    if len(hist_api) == 0 or api_value <= 0:
        return 0.0
    return round(float(np.clip(np.mean(hist_api <= api_value) * 100.0, 0.0, 100.0)), 2)


# ══════════════════════════════════════════════════════════════════════════════
# ERA5 distribution builders  (called once per region)
# ══════════════════════════════════════════════════════════════════════════════

def _doy_mask(df: pd.DataFrame, doy: int) -> pd.Series:
    lo, hi = doy - DOY_WINDOW, doy + DOY_WINDOW
    if lo < 1:
        return (df["doy"] >= 365 + lo) | (df["doy"] <= hi)
    if hi > 365:
        return (df["doy"] >= lo) | (df["doy"] <= hi - 365)
    return (df["doy"] >= lo) & (df["doy"] <= hi)


def build_era5_distributions(lat: float, lon: float):
    """
    Fetch BASELINE_YEARS of ERA5 daily precip for this location.
    Returns (spi_dists, api_dists, baseline_means):
      spi_dists     {doy: np.array of historical daily precip}
      api_dists     {doy: np.array of historical API values}
      baseline_means {doy: float mean daily precip}
    """
    start = date(TODAY.year - BASELINE_YEARS, 1, 1)
    end   = TODAY - timedelta(days=1)
    data  = _get(ARCHIVE_URL, {
        "latitude":   lat, "longitude":  lon,
        "start_date": start.isoformat(), "end_date": end.isoformat(),
        "daily":      "precipitation_sum",
        "timezone":   "UTC",
    })
    hist = pd.DataFrame(data["daily"])
    hist["time"]   = pd.to_datetime(hist["time"]).dt.date
    hist["doy"]    = hist["time"].apply(lambda d: d.timetuple().tm_yday)
    hist["precip"] = hist["precipitation_sum"].fillna(0).clip(lower=0)

    # Build API on full historical series
    hist_sorted      = hist.sort_values("time").copy()
    hist_sorted["api"] = compute_api_series(hist_sorted["precip"]).values

    spi_dists, api_dists, baseline_means = {}, {}, {}
    for doy in range(1, 366):
        mask          = _doy_mask(hist, doy)
        mask_s        = _doy_mask(hist_sorted, doy)
        spi_dists[doy]      = hist.loc[mask, "precip"].values
        api_dists[doy]      = hist_sorted.loc[mask_s, "api"].values
        baseline_means[doy] = float(hist.loc[mask, "precip"].mean()) if mask.any() else 0.0

    return spi_dists, api_dists, baseline_means


def score_daily_df(daily_df: pd.DataFrame,
                   spi_dists: dict, api_dists: dict) -> pd.DataFrame:
    """
    Given a daily DataFrame with columns [time, precip, tier]:
      - Compute running API across the full series
      - Score each day: SPI → drought, API percentile → flood
      - Aggregate to monthly totals/averages
    Returns monthly DataFrame.
    """
    daily_df = daily_df.sort_values("time").copy()
    daily_df["api"] = compute_api_series(daily_df["precip"]).values

    records = []
    for _, row in daily_df.iterrows():
        doy        = row["time"].timetuple().tm_yday
        fmm        = float(row["precip"])
        hist_p     = spi_dists.get(doy, np.array([]))
        hist_a     = api_dists.get(doy, np.array([]))
        baseline   = float(np.mean(hist_p)) if len(hist_p) > 0 else 0.0
        spi        = _fit_gamma_spi(fmm, hist_p)
        records.append({
            "year_month":  row["time"].strftime("%Y-%m"),
            "precip":      fmm,
            "baseline":    baseline,
            "drought":     spi_to_drought_score(spi),
            "flood":       api_to_flood_score(float(row["api"]), hist_a),
            "tier":        row["tier"],
        })

    df = pd.DataFrame(records)
    if df.empty:
        return pd.DataFrame()

    monthly = (
        df.groupby("year_month")
        .agg(
            precipitation_mm     =("precip",   "sum"),
            seasonal_baseline_mm =("baseline", "sum"),
            drought_risk_score   =("drought",  "mean"),
            flood_risk_score     =("flood",    "mean"),
            source               =("tier",     lambda x: "open_meteo_" + x.mode()[0]),
        )
        .reset_index()
    )
    for col in ["precipitation_mm", "seasonal_baseline_mm",
                "drought_risk_score", "flood_risk_score"]:
        monthly[col] = monthly[col].round(2)
    return monthly


# ══════════════════════════════════════════════════════════════════════════════
# Sheet updaters
# ══════════════════════════════════════════════════════════════════════════════

def load_xl(path: str) -> dict:
    xl     = pd.ExcelFile(path)
    sheets = {s: xl.parse(s) for s in xl.sheet_names}
    # Initialise USD_Index sheet with correct schema if the workbook predates this feature
    if "USD_Index" not in sheets:
        sheets["USD_Index"] = pd.DataFrame(columns=USD_INDEX_COLS)
        print("  USD_Index: sheet not found in workbook — initialising empty sheet")
    return sheets


# ── 1. FX Rates ───────────────────────────────────────────────────────────────

def update_fx(sheets: dict) -> dict:
    """Append missing monthly FX closes via yfinance."""
    import yfinance as yf
    fx       = sheets["FX_Rates"].copy()
    new_rows = []

    for ccy, ticker in FX_TICKERS.items():
        sub = fx[fx["currency_code"] == ccy].sort_values("observed_at")
        if sub.empty:
            continue
        latest = pd.to_datetime(sub["observed_at"].max())
        if pd.isna(latest):
            continue
        start = (latest + relativedelta(months=1)).replace(day=1).strftime("%Y-%m-%d")
        end   = (TODAY  + relativedelta(months=1)).replace(day=1).strftime("%Y-%m-%d")
        if start >= end:
            continue
        try:
            df = yf.download(ticker, start=start, end=end,
                             interval="1mo", progress=False, auto_adjust=True)
            if df.empty:
                continue
            df        = df.reset_index()
            close_col = "Close" if "Close" in df.columns else df.columns[-1]
            for _, row in df.iterrows():
                rate = float(row[close_col]) if not hasattr(row[close_col], "__len__") \
                       else float(row[close_col].iloc[0])
                mend = (pd.Timestamp(row["Date"]) + pd.offsets.MonthEnd(0)).strftime("%Y-%m-%d")
                new_rows.append({"currency_code": ccy, "rate_to_usd": round(rate, 4),
                                  "observed_at": mend, "ingested_at": INGEST_NOW,
                                  "source": "yahoo_finance", "is_interpolated": False})
        except Exception as e:
            print(f"  FX {ccy}: {e} — interpolating from trend")
            rates     = sub.tail(3)["rate_to_usd"].values.astype(float)
            next_rate = rates[-1] + np.mean(np.diff(rates))
            mend      = (latest + relativedelta(months=1) + pd.offsets.MonthEnd(0)).strftime("%Y-%m-%d")
            new_rows.append({"currency_code": ccy, "rate_to_usd": round(float(next_rate), 4),
                              "observed_at": mend, "ingested_at": INGEST_NOW,
                              "source": "yahoo_finance", "is_interpolated": True})

    if new_rows:
        sheets["FX_Rates"] = pd.concat([fx, pd.DataFrame(new_rows)], ignore_index=True)
        print(f"  FX_Rates: added {len(new_rows)} rows")
    return sheets


# ── 2. Crop Prices ────────────────────────────────────────────────────────────

def update_crop_prices(sheets: dict) -> dict:
    """Add or update annual crop price estimates for Maize, Wheat, Rice."""
    import yfinance as yf
    crop         = sheets["Crop_Prices"].copy()
    current_year = TODAY.year
    target_years = [y for y in range(int(crop["year"].max()) + 1, current_year + 1)]
    new_rows     = []

    for crop_name, meta in CROP_TICKERS.items():
        ticker       = meta["ticker"]
        conv         = meta["conv"]
        prior_prices = crop[crop["crop"] == crop_name].sort_values("year")["price"].values

        for yr in target_years:
            if not crop[(crop["crop"] == crop_name) & (crop["year"] == yr)].empty:
                continue
            try:
                df = yf.download(ticker, start=f"{yr}-01-01", end=f"{yr}-12-31",
                                 interval="1mo", progress=False, auto_adjust=True)
                if not df.empty:
                    close_col = "Close" if "Close" in df.columns else df.columns[-1]
                    avg_price = round(float(df[close_col].mean()) / 100 * conv, 1)
                    source    = f"Yahoo Finance/{ticker} — monthly avg {yr}"
                else:
                    raise ValueError("empty response")
            except Exception:
                if len(prior_prices) >= 2:
                    avg_price = round(float(prior_prices[-1]) + np.mean(np.diff(prior_prices[-3:])), 1)
                else:
                    avg_price = round(float(prior_prices[-1]) * 0.97, 1)
                source = f"Trend extrapolation from {yr - 1} data"

            basis_map = {
                "Maize": "US No.2 Yellow, Gulf ports",
                "Wheat": "US No.2 Hard Red Winter, Gulf",
                "Rice":  "Thai white milled 5%, Bangkok",
            }
            new_rows.append({"crop": crop_name, "year": yr, "price": avg_price,
                             "unit": "$/mt", "price_basis": basis_map[crop_name],
                             "source": source})

    if new_rows:
        sheets["Crop_Prices"] = pd.concat([crop, pd.DataFrame(new_rows)], ignore_index=True)
        print(f"  Crop_Prices: added {len(new_rows)} rows")
    return sheets


# ── 3. Weather Forecast  (SPI + API scoring) ─────────────────────────────────

def update_weather(sheets: dict, forecast_months_ahead: int = 9) -> dict:
    """
    a) Re-classify past open_meteo_forecast rows as open_meteo_archive.
    b) Fetch missing archive months (ERA5 via Open-Meteo) and score with SPI+API.
    c) Fetch next 2-month forecast and score with SPI+API.
    d) Extend ERA5 climatological baseline through forecast_months_ahead
       (drought=0, flood=50 — at-baseline months carry neutral signals).
    """
    wf     = sheets["Weather_Forecast"].copy()
    max_id = int(wf["forecast_id"].max())

    # a) Re-classify stale forecast rows
    stale_mask = (wf["source"] == "open_meteo_forecast") & (wf["year_month"] < TODAY_YM)
    wf.loc[stale_mask, "source"]     = "open_meteo_archive"
    wf.loc[stale_mask, "ingested_at"] = INGEST_NOW
    if stale_mask.sum():
        print(f"  Re-classified {stale_mask.sum()} forecast→archive rows")

    archive        = wf[wf["source"] == "open_meteo_archive"]
    latest_arch_ym = archive.groupby("region_code")["year_month"].max()
    new_rows       = []

    for region, (lat, lon) in REGION_COORDS.items():
        print(f"    [{region}]", end="  ", flush=True)

        # Build ERA5 distributions once per region (shared by archive + forecast scoring)
        try:
            spi_dists, api_dists, baseline_means = build_era5_distributions(lat, lon)
            time.sleep(0.4)
        except Exception as e:
            print(f"ERA5 baseline FAILED: {e}")
            continue

        # ── b) Archive backfill ───────────────────────────────────────────────
        last_ym    = latest_arch_ym.get(region, "2022-01")
        arch_start = (pd.to_datetime(last_ym + "-01") + relativedelta(months=1)).date()
        arch_end   = (pd.to_datetime(TODAY_YM + "-01") - timedelta(days=1)).date()

        if arch_start <= arch_end:
            try:
                data = _get(ARCHIVE_URL, {
                    "latitude":   lat, "longitude":  lon,
                    "start_date": arch_start.isoformat(),
                    "end_date":   arch_end.isoformat(),
                    "daily":      "precipitation_sum",
                    "timezone":   "UTC",
                })
                arch_df = pd.DataFrame(data["daily"])
                arch_df["time"]   = pd.to_datetime(arch_df["time"])
                arch_df["precip"] = arch_df["precipitation_sum"].fillna(0).clip(lower=0)
                arch_df["tier"]   = "archive"
                monthly = score_daily_df(arch_df[["time","precip","tier"]], spi_dists, api_dists)
                for _, row in monthly.iterrows():
                    if not wf[(wf["region_code"]==region) & (wf["year_month"]==row["year_month"])].empty:
                        continue
                    max_id += 1
                    new_rows.append({
                        "forecast_id": max_id, "region_code": region,
                        "year_month": row["year_month"], "ingested_at": INGEST_NOW,
                        "precipitation_mm": row["precipitation_mm"],
                        "drought_risk_score": row["drought_risk_score"],
                        "flood_risk_score": row["flood_risk_score"],
                        "seasonal_baseline_mm": row["seasonal_baseline_mm"],
                        "source": "open_meteo_archive",
                    })
                time.sleep(0.4)
            except Exception as e:
                print(f"\n      Archive backfill failed: {e}")

        # ── c) 16-day forecast → next 2 months ───────────────────────────────
        try:
            data = _get(FORECAST_URL, {
                "latitude":      lat, "longitude":     lon,
                "daily":         "precipitation_sum",
                "forecast_days": 16,
                "timezone":      "UTC",
            })
            fc_df = pd.DataFrame(data["daily"])
            fc_df["time"]   = pd.to_datetime(fc_df["time"])
            fc_df["precip"] = fc_df["precipitation_sum"].fillna(0).clip(lower=0)
            fc_df["tier"]   = "forecast"
            monthly_fc = score_daily_df(fc_df[["time","precip","tier"]], spi_dists, api_dists)

            for _, row in monthly_fc.iterrows():
                existing_row = wf[(wf["region_code"]==region) & (wf["year_month"]==row["year_month"])]
                if not existing_row.empty:
                    # Refresh scores on existing forecast row
                    wf.loc[existing_row.index, ["ingested_at","source",
                                                 "precipitation_mm","drought_risk_score",
                                                 "flood_risk_score","seasonal_baseline_mm"]] = [
                        INGEST_NOW, "open_meteo_forecast",
                        row["precipitation_mm"], row["drought_risk_score"],
                        row["flood_risk_score"], row["seasonal_baseline_mm"],
                    ]
                else:
                    max_id += 1
                    new_rows.append({
                        "forecast_id": max_id, "region_code": region,
                        "year_month": row["year_month"], "ingested_at": INGEST_NOW,
                        "precipitation_mm": row["precipitation_mm"],
                        "drought_risk_score": row["drought_risk_score"],
                        "flood_risk_score": row["flood_risk_score"],
                        "seasonal_baseline_mm": row["seasonal_baseline_mm"],
                        "source": "open_meteo_forecast",
                    })
            time.sleep(0.4)
        except Exception as e:
            print(f"\n      Forecast failed: {e}")

        print(f"ok")

    # ── d) ERA5 baseline extension (future months, neutral scores) ────────────
    target_end    = pd.to_datetime(TODAY_YM + "-01") + relativedelta(months=forecast_months_ahead)
    existing_keys = set(zip(wf["region_code"], wf["year_month"]))
    existing_keys |= {(r["region_code"], r["year_month"]) for r in new_rows}

    cur = pd.to_datetime(TODAY_YM + "-01") + relativedelta(months=3)
    baseline_rows = 0
    while cur <= target_end:
        ym = cur.strftime("%Y-%m")
        for region, (lat, lon) in REGION_COORDS.items():
            if (region, ym) in existing_keys:
                continue
            # Use stored era5 baselines if available from the last region loop.
            # Fallback: look up archived data for same month-of-year.
            arch_region = wf[(wf["region_code"] == region) & (wf["source"] == "open_meteo_archive")].copy()
            arch_region["mn"] = arch_region["year_month"].str.split("-").str[1].astype(int)
            bl_row = arch_region[arch_region["mn"] == cur.month]
            baseline = round(float(bl_row["precipitation_mm"].mean()), 2) if not bl_row.empty else 0.0
            max_id += 1
            new_rows.append({
                "forecast_id": max_id, "region_code": region, "year_month": ym,
                "ingested_at": INGEST_NOW, "precipitation_mm": baseline,
                "drought_risk_score": 0.0,    # at-baseline → no drought signal
                "flood_risk_score": 50.0,     # median API → neutral flood signal
                "seasonal_baseline_mm": baseline, "source": "era5_baseline",
            })
            existing_keys.add((region, ym))
            baseline_rows += 1
        cur += relativedelta(months=1)

    if baseline_rows:
        print(f"  ERA5 baseline: added {baseline_rows} future-month rows")

    if new_rows:
        sheets["Weather_Forecast"] = pd.concat(
            [wf, pd.DataFrame(new_rows)], ignore_index=True
        )
        print(f"  Weather_Forecast: added {len(new_rows)} rows total")
    else:
        sheets["Weather_Forecast"] = wf
    return sheets


# ── 4. Political Risk ─────────────────────────────────────────────────────────

def update_political_risk(sheets: dict, pol_risk_csv: str) -> dict:
    """Append latest month of political risk scores from CSV."""
    if not os.path.exists(pol_risk_csv):
        print(f"  Political_Risk: {pol_risk_csv} not found — skipping")
        return sheets

    pr     = sheets["Political_Risk"].copy()
    pr_csv = pd.read_csv(pol_risk_csv)

    latest_date = pd.to_datetime(pr["scoring_date"].max())
    target_date = (latest_date + relativedelta(months=1)).replace(day=1).strftime("%Y-%m-%d")

    if target_date in pr["scoring_date"].values:
        print(f"  Political_Risk: {target_date} already present — skipping")
        return sheets

    xl_countries = pr["country_code"].unique().tolist()
    may_rows     = pr[pr["scoring_date"] == pr["scoring_date"].max()].set_index("country_code")
    new_rows     = []

    for _, csv_row in pr_csv.iterrows():
        cc = csv_row["country_code"]
        if cc not in xl_countries:
            continue
        prior     = may_rows.loc[cc]
        csv_score = int(csv_row["score"])
        may_score = int(prior["score"])

        p4_may, p5_may = int(prior["pillar_agriculture_risk"]), int(prior["pillar_lending_risk"])
        p4_p5_new      = round((p4_may + p5_may) * csv_score / may_score)
        p4_new         = round(p4_may * csv_score / may_score)
        p5_new         = p4_p5_new - p4_new

        ps123_budget = csv_score - p4_p5_new
        csv_ps_total = (int(csv_row["pillar_political_stability"]) +
                        int(csv_row["pillar_security_environment"]) +
                        int(csv_row["pillar_economic_fragility"]))
        if csv_ps_total > 0:
            ps1 = round(csv_row["pillar_political_stability"] / csv_ps_total * ps123_budget)
            ps2 = round(csv_row["pillar_security_environment"] / csv_ps_total * ps123_budget)
            ps3 = ps123_budget - ps1 - ps2
        else:
            ps1 = ps2 = 0
            ps3 = ps123_budget

        def scale_subs(subs_may: list, new_total: int) -> list:
            s = sum(subs_may)
            if s == 0:
                return [new_total // len(subs_may)] * len(subs_may)
            scaled    = [round(v / s * new_total) for v in subs_may]
            scaled[-1] += new_total - sum(scaled)
            return scaled

        p4_subs = scale_subs(
            [int(prior["p4_land_rights"]), int(prior["p4_input_subsidy_disruption"]),
             int(prior["p4_trade_export_policy"]), int(prior["p4_conflict_farming_zones"])],
            p4_new)
        p5_subs = scale_subs(
            [int(prior["p5_fx_controls"]), int(prior["p5_govt_credit_interference"]),
             int(prior["p5_regulatory_risk"]), int(prior["p5_borrower_repayment_capacity"])],
            p5_new)

        new_rows.append({
            "scoring_date": target_date, "country_code": cc,
            "country_name": csv_row["country_name"], "score": csv_score,
            "tier": csv_row["tier"], "prior_score": may_score,
            "score_delta": csv_score - may_score,
            "score_vs_baseline": csv_row["score_vs_baseline"],
            "prior_score_change_justified": bool(csv_row["prior_score_change_justified"]),
            "pillar_political_stability": ps1, "pillar_security_environment": ps2,
            "pillar_economic_fragility": ps3,
            "pillar_agriculture_risk": p4_new, "pillar_lending_risk": p5_new,
            "p1_election_risk": int(csv_row["p1_election_risk"]),
            "p1_civil_unrest": int(csv_row["p1_civil_unrest"]),
            "p1_legitimacy_crisis": int(csv_row["p1_legitimacy_crisis"]),
            "p2_armed_conflict": int(csv_row["p2_armed_conflict"]),
            "p2_spillover": int(csv_row["p2_spillover"]),
            "p2_terrorism_crime": int(csv_row["p2_terrorism_crime"]),
            "p3_fx_depreciation": int(csv_row["p3_fx_depreciation"]),
            "p3_inflation": int(csv_row["p3_inflation"]),
            "p3_debt_stress": int(csv_row["p3_debt_stress"]),
            "p3_gdp_trajectory": int(csv_row["p3_gdp_trajectory"]),
            "p4_land_rights": p4_subs[0], "p4_input_subsidy_disruption": p4_subs[1],
            "p4_trade_export_policy": p4_subs[2], "p4_conflict_farming_zones": p4_subs[3],
            "p5_fx_controls": p5_subs[0], "p5_govt_credit_interference": p5_subs[1],
            "p5_regulatory_risk": p5_subs[2], "p5_borrower_repayment_capacity": p5_subs[3],
            "key_drivers": str(csv_row["key_drivers"]),
            "model": "historical_synthetic_v1",
            "sources_used": str(csv_row["sources_used"]),
        })

    if new_rows:
        sheets["Political_Risk"] = pd.concat([pr, pd.DataFrame(new_rows)], ignore_index=True)
        print(f"  Political_Risk: added {len(new_rows)} rows for {target_date}")
    return sheets



# ── 5. USD Index (DXY) ────────────────────────────────────────────────────────

def update_usd_index(sheets: dict) -> dict:
    """
    Append missing monthly DXY (ICE US Dollar Index) closes via yfinance.

    Schema written to USD_Index sheet:
      observed_at    — month-end date (YYYY-MM-DD)
      index_value    — DXY closing level (e.g. 103.42)
      pct_change_1m  — month-over-month % change relative to previous row
      ingested_at    — UTC timestamp of this run
      source         — 'yahoo_finance'
      is_interpolated — True when yfinance fails and trend extrapolation is used

    DXY interpretation:
      Rising index  → USD strengthening against the basket
      Falling index → USD weakening  (local currencies relatively stronger)
    A 1% rise in DXY historically correlates with ~0.5-0.8% depreciation
    pressure on the EM/African currencies in the portfolio.
    """
    import yfinance as yf
    ux       = sheets["USD_Index"].copy()
    new_rows = []

    if not ux.empty and "observed_at" in ux.columns and ux["observed_at"].notna().any():
        latest   = pd.to_datetime(ux["observed_at"].max())
        last_val = float(ux.sort_values("observed_at")["index_value"].iloc[-1])
    else:
        latest   = pd.Timestamp(DXY_SEED_DATE)
        last_val = None

    start = (latest + relativedelta(months=1)).replace(day=1).strftime("%Y-%m-%d")
    end   = (TODAY  + relativedelta(months=1)).replace(day=1).strftime("%Y-%m-%d")

    if start >= end:
        print("  USD_Index: already up to date — skipping")
        return sheets

    try:
        df = yf.download(DXY_TICKER, start=start, end=end,
                         interval="1mo", progress=False, auto_adjust=True)
        if df.empty:
            raise ValueError("yfinance returned empty DataFrame")

        df        = df.reset_index()
        close_col = "Close" if "Close" in df.columns else df.columns[-1]

        for _, row in df.iterrows():
            val  = float(row[close_col]) if not hasattr(row[close_col], "__len__") \
                   else float(row[close_col].iloc[0])
            mend = (pd.Timestamp(row["Date"]) + pd.offsets.MonthEnd(0)).strftime("%Y-%m-%d")
            pct  = round((val / last_val - 1) * 100, 4) if last_val is not None else None
            new_rows.append({
                "observed_at":    mend,
                "index_value":    round(val, 4),
                "pct_change_1m":  pct,
                "ingested_at":    INGEST_NOW,
                "source":         "yahoo_finance",
                "is_interpolated": False,
            })
            last_val = val

    except Exception as e:
        print(f"  USD_Index: {e} — interpolating from trend")
        if last_val is not None and not ux.empty and len(ux) >= 2:
            vals     = ux.sort_values("observed_at").tail(3)["index_value"].values.astype(float)
            next_val = round(float(vals[-1]) + float(np.mean(np.diff(vals))), 4)
            pct      = round((next_val / float(vals[-1]) - 1) * 100, 4)
            mend     = (latest + relativedelta(months=1) + pd.offsets.MonthEnd(0)).strftime("%Y-%m-%d")
            new_rows.append({
                "observed_at":    mend,
                "index_value":    next_val,
                "pct_change_1m":  pct,
                "ingested_at":    INGEST_NOW,
                "source":         "yahoo_finance",
                "is_interpolated": True,
            })
        else:
            print("  USD_Index: insufficient history for extrapolation — skipping")

    if new_rows:
        sheets["USD_Index"] = pd.concat(
            [ux, pd.DataFrame(new_rows)], ignore_index=True
        )
        print(f"  USD_Index: added {len(new_rows)} rows")
    return sheets

# ══════════════════════════════════════════════════════════════════════════════
# Main
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print(f"Loading {args.input}...")
    sheets = load_xl(args.input)

    print("Updating FX rates...")
    sheets = update_fx(sheets)

    print("Updating crop prices...")
    sheets = update_crop_prices(sheets)

    print("Updating weather forecasts (SPI + API scoring)...")
    sheets = update_weather(sheets)

    print("Updating political risk...")
    sheets = update_political_risk(sheets, args.pol_risk)

    print("Updating USD Index (DXY)...")
    sheets = update_usd_index(sheets)

    print(f"Writing {args.output}...")
    with pd.ExcelWriter(args.output, engine="openpyxl") as writer:
        for sheet_name, df in sheets.items():
            df.to_excel(writer, sheet_name=sheet_name, index=False)

    print("Done.")
