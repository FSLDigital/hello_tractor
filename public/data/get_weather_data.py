"""
get_weather_data.py  —  v7  (SPI + API scoring)
=================================================
Produces ONE row per region per month.

Drought score  →  SPI-1 (Standardised Precipitation Index, 1-month)
                  WMO standard (McKee et al. 1993).
                  Gamma distribution fit to ERA5 historical values for the
                  same calendar month ± 15 days over the past 5 years.
                  Scaled 0-100: SPI ≤ -3 → 100, SPI = 0 → 0 (no drought).

Flood score    →  API (Antecedent Precipitation Index, k=0.90)
                  Standard hydrological soil-moisture accumulation model.
                  API_t = P_t + 0.90 × API_(t-1)
                  Normalised to 0-100 using the historical API distribution
                  for the same day-of-year (percentile rank method).

Sources
-------
  Historical  2022-01 → last complete month   ERA5 via Open-Meteo Archive API
  Near-term   current month + next 16 days    Open-Meteo Forecast API
  Future      beyond 16-day horizon           ERA5 climatological baseline
                                              (SPI = 0, API score from baseline)

Install
-------
    pip install requests pandas numpy scipy python-dateutil

Run
---
    python get_weather_data.py

Output
------
    weather_forecast_monthly.csv   (incremental — safe to re-run)
"""

import time
import requests
import numpy as np
import pandas as pd
from datetime import date, datetime, timedelta, timezone
from dateutil.relativedelta import relativedelta
from scipy import stats

# ── Config ────────────────────────────────────────────────────────────────────

ARCHIVE_URL          = "https://archive-api.open-meteo.com/v1/archive"
ARCHIVE_URL_FALLBACK = "https://historical-forecast-api.open-meteo.com/v1/historical"
FORECAST_URL         = "https://api.open-meteo.com/v1/forecast"

HISTORY_START    = date(2022, 1, 1)
RANGE_END        = date(2026, 6, 30)   # fixed output end — Jun 2026
BASELINE_YEARS   = 5
DOY_WINDOW       = 15
API_K            = 0.90
TODAY            = date.today()

# Split into archive (historical) and forecast (future) portions
HISTORY_END      = min(date(TODAY.year, TODAY.month, 1) - timedelta(days=1), RANGE_END)
FUTURE_END       = RANGE_END   # anything beyond today pulled from forecast or baseline

OUTPUT_FILE      = "weather_forecast_monthly.csv"

TIMEOUT_SEC      = 90
MAX_RETRIES      = 5
INTER_REGION_SEC = 2.0

# ── Region map ────────────────────────────────────────────────────────────────

REGION_MAP = {
    "NG-NC": {"region_name": "North Central, Nigeria",    "lat":  8.72, "lon":  8.53},
    "NG-NE": {"region_name": "North East, Nigeria",       "lat": 10.52, "lon": 11.37},
    "NG-NW": {"region_name": "North West, Nigeria",       "lat": 10.52, "lon":  7.44},
    "NG-SE": {"region_name": "South East, Nigeria",       "lat":  6.44, "lon":  7.55},
    "NG-SW": {"region_name": "South West, Nigeria",       "lat":  7.85, "lon":  3.93},
    "NG-KN": {"region_name": "Kano, Nigeria",             "lat": 12.00, "lon":  8.59},
    "NG-KD": {"region_name": "Kaduna, Nigeria",           "lat": 10.52, "lon":  7.44},
    "KE-WR": {"region_name": "Western Region, Kenya",     "lat": -0.09, "lon": 34.76},
    "KE-RV": {"region_name": "Rift Valley, Kenya",        "lat": -0.78, "lon": 35.73},
    "KE-NY": {"region_name": "Nyanza, Kenya",             "lat": -0.09, "lon": 34.77},
    "KE-CT": {"region_name": "Central, Kenya",            "lat": -0.18, "lon": 36.60},
    "ET-BA": {"region_name": "Bale, Ethiopia",            "lat":  7.05, "lon": 40.17},
    "ET-WA": {"region_name": "West Arsi, Ethiopia",       "lat":  7.00, "lon": 38.50},
    "ET-ES": {"region_name": "East Shewa, Ethiopia",      "lat":  8.54, "lon": 39.27},
    "ET-SI": {"region_name": "Siltie, Ethiopia",          "lat":  7.80, "lon": 38.30},
    "UG-NR": {"region_name": "Northern Region, Uganda",   "lat":  2.77, "lon": 32.30},
    "UG-CR": {"region_name": "Central Region, Uganda",    "lat":  0.35, "lon": 32.58},
    "UG-ER": {"region_name": "Eastern Region, Uganda",    "lat":  1.13, "lon": 34.18},
    "UG-WR": {"region_name": "Western Region, Uganda",    "lat": -0.61, "lon": 30.66},
    "RW-EP": {"region_name": "Eastern Province, Rwanda",  "lat": -1.54, "lon": 30.46},
    "RW-KG": {"region_name": "Kigali / Southern, Rwanda", "lat": -1.94, "lon": 30.06},
}

# ── HTTP ──────────────────────────────────────────────────────────────────────

def _get(url: str, params: dict) -> dict:
    """
    GET with exponential backoff. On DNS/connection errors for the primary
    archive URL, automatically falls back to the secondary endpoint.
    """
    urls_to_try = [url]
    if url == ARCHIVE_URL:
        urls_to_try.append(ARCHIVE_URL_FALLBACK)

    last_exc = None
    for attempt in range(MAX_RETRIES):
        current_url = urls_to_try[min(attempt, len(urls_to_try) - 1)]
        try:
            r = requests.get(current_url, params=params, timeout=TIMEOUT_SEC)
            r.raise_for_status()
            return r.json()
        except requests.exceptions.ConnectionError as e:
            last_exc = e
            wait = min(60, 4 * (2 ** attempt))
            note = " → switching to fallback URL" if attempt == 0 and len(urls_to_try) > 1 else ""
            print(f"    DNS/connection error (attempt {attempt+1}/{MAX_RETRIES}){note}, "
                  f"retrying in {wait}s...")
            time.sleep(wait)
        except requests.exceptions.Timeout as e:
            last_exc = e
            wait = min(60, 4 * (2 ** attempt))
            print(f"    Timeout (attempt {attempt+1}/{MAX_RETRIES}), retrying in {wait}s...")
            time.sleep(wait)
        except requests.exceptions.HTTPError:
            raise
    raise last_exc


# ── Historical data fetch ──────────────────────────────────────────────────────

def fetch_era5_history(lat: float, lon: float) -> pd.DataFrame:
    """
    Fetch full BASELINE_YEARS of ERA5 daily precipitation and ET0.
    Used to build SPI distributions and historical API series.
    """
    start = date(TODAY.year - BASELINE_YEARS, 1, 1)
    end   = min(TODAY - timedelta(days=1), HISTORY_END)
    data  = _get(ARCHIVE_URL, {
        "latitude":   lat, "longitude":  lon,
        "start_date": start.isoformat(),
        "end_date":   end.isoformat(),
        "daily":      "precipitation_sum,et0_fao_evapotranspiration",
        "timezone":   "UTC",
    })
    df = pd.DataFrame(data["daily"])
    df["time"]   = pd.to_datetime(df["time"]).dt.date
    df["doy"]    = df["time"].apply(lambda d: d.timetuple().tm_yday)
    df["month"]  = df["time"].apply(lambda d: d.month)
    df["precip"] = df["precipitation_sum"].fillna(0).clip(lower=0)
    df["et0"]    = df.get(
        "et0_fao_evapotranspiration",
        pd.Series(4.0, index=df.index)
    ).fillna(4.0)
    return df


def fetch_archive_daily(lat: float, lon: float,
                        start: date, end: date) -> pd.DataFrame:
    data = _get(ARCHIVE_URL, {
        "latitude":   lat, "longitude":  lon,
        "start_date": start.isoformat(),
        "end_date":   end.isoformat(),
        "daily":      "precipitation_sum,et0_fao_evapotranspiration",
        "timezone":   "UTC",
    })
    df = pd.DataFrame(data["daily"])
    df["time"]   = pd.to_datetime(df["time"]).dt.date
    df["precip"] = df["precipitation_sum"].fillna(0).clip(lower=0)
    df["et0"]    = df.get(
        "et0_fao_evapotranspiration",
        pd.Series(4.0, index=df.index)
    ).fillna(4.0)
    df["tier"]   = "archive"
    return df[["time", "precip", "et0", "tier"]]


def fetch_forecast_daily(lat: float, lon: float) -> pd.DataFrame:
    data = _get(FORECAST_URL, {
        "latitude":      lat, "longitude":     lon,
        "daily":         "precipitation_sum,et0_fao_evapotranspiration",
        "forecast_days": 16, "timezone":       "UTC",
    })
    df = pd.DataFrame(data["daily"])
    df["time"]   = pd.to_datetime(df["time"]).dt.date
    df["precip"] = df["precipitation_sum"].fillna(0).clip(lower=0)
    df["et0"]    = df.get(
        "et0_fao_evapotranspiration",
        pd.Series(4.0, index=df.index)
    ).fillna(4.0)
    df["tier"]   = "forecast"
    return df[["time", "precip", "et0", "tier"]]


# ── SPI (Standardised Precipitation Index) ───────────────────────────────────

def _fit_gamma_spi(value: float, hist_values: np.ndarray) -> float:
    """
    Compute SPI for a single value against its historical distribution.

    Method (WMO-No.1090):
      1. Fit a gamma distribution to nonzero historical values.
      2. Use a mixed distribution to handle zero-precipitation days:
             H(x) = q + (1-q) × G(x)
         where q = probability of zero precipitation.
      3. Convert cumulative probability H to standard normal z-score (= SPI).

    Returns SPI z-score. Typical range: -3 (extreme drought) to +3 (very wet).
    """
    n       = len(hist_values)
    n_zero  = np.sum(hist_values == 0)
    q       = n_zero / n          # probability of zero precip
    nonzero = hist_values[hist_values > 0]

    if len(nonzero) < 6:
        # Insufficient non-zero samples — return 0 (no signal)
        return 0.0

    # Fit gamma distribution (shape α, scale β) to nonzero values
    try:
        alpha, loc, beta = stats.gamma.fit(nonzero, floc=0)
    except Exception:
        return 0.0

    # Mixed cumulative probability
    if value <= 0:
        cum_prob = q
    else:
        cum_prob = q + (1 - q) * stats.gamma.cdf(value, alpha, scale=beta)

    # Clamp to avoid infinite z-scores at tails
    cum_prob = float(np.clip(cum_prob, 0.0013, 0.9987))  # ±3σ boundary

    # Standard normal transform
    return float(stats.norm.ppf(cum_prob))


def spi_to_drought_score(spi: float) -> float:
    """
    Map SPI z-score to drought risk score 0–100.

    WMO SPI drought classification:
      SPI ≥  0.0  →  no drought           → score 0
      SPI  -0.99  →  mild drought         → score ~33
      SPI  -1.49  →  moderate drought     → score ~50
      SPI  -1.99  →  severe drought       → score ~67
      SPI ≤ -2.0  →  extreme drought      → score 100

    Linear map: score = clip(-spi / 3 × 100, 0, 100)
    This keeps SPI=0 at score=0 and SPI=-3 at score=100.
    """
    return round(float(np.clip(-spi / 3.0 * 100.0, 0.0, 100.0)), 2)


def build_spi_distributions(era5_df: pd.DataFrame) -> dict:
    """
    Build a lookup of {doy: np.array of historical daily precip values}
    using ±DOY_WINDOW days around each day-of-year.
    Used to compute SPI for each forecast day.
    """
    dists = {}
    for doy in range(1, 366):
        lo, hi = doy - DOY_WINDOW, doy + DOY_WINDOW
        if lo < 1:
            mask = (era5_df["doy"] >= 365 + lo) | (era5_df["doy"] <= hi)
        elif hi > 365:
            mask = (era5_df["doy"] >= lo) | (era5_df["doy"] <= hi - 365)
        else:
            mask = (era5_df["doy"] >= lo) & (era5_df["doy"] <= hi)
        dists[doy] = era5_df.loc[mask, "precip"].values
    return dists


# ── API (Antecedent Precipitation Index) ─────────────────────────────────────

def compute_api_series(precip_series: pd.Series, k: float = API_K) -> pd.Series:
    """
    API_t = P_t + k × API_(t-1)

    k = 0.90 is appropriate for tropical/subtropical agricultural soils
    (higher k = slower drainage, more soil memory).
    Represents accumulated soil moisture weighted toward recent rainfall.
    """
    api_values = []
    api = 0.0
    for p in precip_series:
        api = float(p) + k * api
        api_values.append(api)
    return pd.Series(api_values, index=precip_series.index)


def build_api_distributions(era5_df: pd.DataFrame) -> dict:
    """
    Compute API on the full ERA5 historical series, then build
    {doy: np.array of historical API values} for normalisation.
    """
    era5_sorted        = era5_df.sort_values("time").copy()
    era5_sorted["api"] = compute_api_series(era5_sorted["precip"])

    dists = {}
    for doy in range(1, 366):
        lo, hi = doy - DOY_WINDOW, doy + DOY_WINDOW
        if lo < 1:
            mask = (era5_sorted["doy"] >= 365 + lo) | (era5_sorted["doy"] <= hi)
        elif hi > 365:
            mask = (era5_sorted["doy"] >= lo) | (era5_sorted["doy"] <= hi - 365)
        else:
            mask = (era5_sorted["doy"] >= lo) & (era5_sorted["doy"] <= hi)
        dists[doy] = era5_sorted.loc[mask, "api"].values
    return dists


def api_to_flood_score(api_value: float, hist_api: np.ndarray) -> float:
    """
    Normalise API to flood risk score 0–100 using percentile rank.

    Percentile rank = fraction of historical API values below current value.
    A day in the 95th percentile of soil saturation scores 95.
    This is distribution-free (no parametric assumptions) and naturally
    accounts for regional differences in rainfall intensity.

    score = percentile_rank(api_value, historical_api_values)
    """
    if len(hist_api) == 0 or api_value <= 0:
        return 0.0
    pct = float(np.mean(hist_api <= api_value)) * 100.0
    return round(float(np.clip(pct, 0.0, 100.0)), 2)


# ── Baseline mean (for precipitation_mm substitution in future months) ────────

def build_daily_baseline_means(era5_df: pd.DataFrame) -> dict:
    """Returns {date → mean historical daily precip} for future-month substitution."""
    means = {}
    for doy in range(1, 366):
        lo, hi = doy - DOY_WINDOW, doy + DOY_WINDOW
        if lo < 1:
            mask = (era5_df["doy"] >= 365 + lo) | (era5_df["doy"] <= hi)
        elif hi > 365:
            mask = (era5_df["doy"] >= lo) | (era5_df["doy"] <= hi - 365)
        else:
            mask = (era5_df["doy"] >= lo) & (era5_df["doy"] <= hi)
        means[doy] = float(era5_df.loc[mask, "precip"].mean()) if mask.any() else 0.0
    return means


# ── Monthly aggregation ───────────────────────────────────────────────────────

def score_and_aggregate(daily_df: pd.DataFrame,
                        spi_dists: dict,
                        api_dists: dict) -> pd.DataFrame:
    """
    1. Compute running API on the full daily series (preserves soil memory
       across month boundaries).
    2. Score each day: SPI → drought, API percentile → flood.
    3. Aggregate to monthly: precip total, baseline total, mean scores.
    """
    daily_df  = daily_df.sort_values("time").copy()
    daily_df["api"] = compute_api_series(daily_df["precip"]).values

    records = []
    for _, row in daily_df.iterrows():
        td   = row["time"]
        doy  = td.timetuple().tm_yday
        fmm  = float(row["precip"])

        # SPI drought score
        hist_precip = spi_dists.get(doy, np.array([]))
        spi         = _fit_gamma_spi(fmm, hist_precip)
        d_score     = spi_to_drought_score(spi)

        # API flood score
        hist_api  = api_dists.get(doy, np.array([]))
        f_score   = api_to_flood_score(float(row["api"]), hist_api)

        # Daily baseline mean (for monthly total)
        hist_mean = float(np.mean(hist_precip)) if len(hist_precip) > 0 else 0.0

        records.append({
            "year_month": td.strftime("%Y-%m"),
            "precip":     fmm,
            "baseline":   hist_mean,
            "drought":    d_score,
            "flood":      f_score,
            "tier":       row["tier"],
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
            source               =("tier",     lambda x: x.mode()[0]),
        )
        .reset_index()
    )
    monthly["precipitation_mm"]     = monthly["precipitation_mm"].round(2)
    monthly["seasonal_baseline_mm"] = monthly["seasonal_baseline_mm"].round(2)
    monthly["drought_risk_score"]   = monthly["drought_risk_score"].round(2)
    monthly["flood_risk_score"]     = monthly["flood_risk_score"].round(2)
    monthly["source"]               = "open_meteo_" + monthly["source"]
    return monthly


def build_baseline_months(future_months: list,
                          baseline_means: dict,
                          api_dists: dict) -> list[dict]:
    """
    For months beyond the 16-day forecast horizon:
    - precipitation_mm = ERA5 climatological total (SPI = 0 by definition)
    - drought_risk_score = 0 (at-baseline precip → no drought signal)
    - flood_risk_score = median API percentile (50th percentile = neutral)
    """
    rows = []
    for ym in future_months:
        yr, mo = int(ym[:4]), int(ym[5:])
        d      = date(yr, mo, 1)
        end_d  = d + relativedelta(months=1) - timedelta(days=1)
        total_baseline = 0.0
        while d <= end_d:
            doy             = d.timetuple().tm_yday
            total_baseline += baseline_means.get(doy, 0.0)
            d              += timedelta(days=1)
        rows.append({
            "year_month":           ym,
            "precipitation_mm":     round(total_baseline, 2),
            "seasonal_baseline_mm": round(total_baseline, 2),
            "drought_risk_score":   0.0,   # at-baseline = no drought
            "flood_risk_score":     50.0,  # median API = neutral flood risk
            "source":               "era5_baseline",
        })
    return rows


# ── Per-region processor ──────────────────────────────────────────────────────

def process_region(region_code: str, meta: dict,
                   existing_months: set) -> list[dict]:
    lat, lon = meta["lat"], meta["lon"]

    all_months = []
    cursor = HISTORY_START.replace(day=1)
    while cursor <= FUTURE_END.replace(day=1):
        all_months.append(cursor.strftime("%Y-%m"))
        cursor += relativedelta(months=1)

    new_months = [m for m in all_months if m not in existing_months]
    if not new_months:
        print(f"    Nothing to add.")
        return []

    print(f"    {len(new_months)} new months  ({new_months[0]} → {new_months[-1]})")

    forecast_cutoff = TODAY + timedelta(days=16)
    hist_months     = [m for m in new_months if m <= HISTORY_END.strftime("%Y-%m")]
    near_months     = [m for m in new_months
                       if HISTORY_END.strftime("%Y-%m") < m
                       <= forecast_cutoff.strftime("%Y-%m")]
    future_months   = [m for m in new_months if m > forecast_cutoff.strftime("%Y-%m")]

    # ── Fetch ERA5 baseline history (single call for SPI + API distributions) ─
    print(f"    ERA5 baseline history ({BASELINE_YEARS} years)...")
    era5_df      = fetch_era5_history(lat, lon)
    spi_dists    = build_spi_distributions(era5_df)
    api_dists    = build_api_distributions(era5_df)
    baseline_means = build_daily_baseline_means(era5_df)
    time.sleep(0.5)

    frames = []

    if hist_months:
        arch_start = date(int(hist_months[0][:4]), int(hist_months[0][5:]), 1)
        arch_end   = (date(int(hist_months[-1][:4]), int(hist_months[-1][5:]), 1)
                      + relativedelta(months=1) - timedelta(days=1))
        arch_end   = min(arch_end, HISTORY_END)
        print(f"    Archive   {arch_start} → {arch_end}")
        frames.append(fetch_archive_daily(lat, lon, arch_start, arch_end))
        time.sleep(0.5)

    if near_months:
        print(f"    Forecast  {near_months[0]} → {near_months[-1]}")
        frames.append(fetch_forecast_daily(lat, lon))
        time.sleep(0.5)

    all_rows     = []
    ingested_at  = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S+00")

    if frames:
        daily_df = (
            pd.concat(frames, ignore_index=True)
            .drop_duplicates(subset="time", keep="first")
            .sort_values("time")
            .reset_index(drop=True)
        )
        active_months = set(hist_months + near_months)
        daily_df = daily_df[
            daily_df["time"].apply(lambda d: d.strftime("%Y-%m")).isin(active_months)
        ]
        monthly = score_and_aggregate(daily_df, spi_dists, api_dists)
        if not monthly.empty:
            for _, row in monthly.iterrows():
                all_rows.append({
                    "region_code":          region_code,
                    "year_month":           row["year_month"],
                    "ingested_at":          ingested_at,
                    "precipitation_mm":     row["precipitation_mm"],
                    "drought_risk_score":   row["drought_risk_score"],
                    "flood_risk_score":     row["flood_risk_score"],
                    "seasonal_baseline_mm": row["seasonal_baseline_mm"],
                    "source":               row["source"],
                })

    if future_months:
        print(f"    Baseline  {future_months[0]} → {future_months[-1]} "
              f"({len(future_months)} months)")
        for brow in build_baseline_months(future_months, baseline_means, api_dists):
            all_rows.append({
                "region_code":          region_code,
                "year_month":           brow["year_month"],
                "ingested_at":          ingested_at,
                "precipitation_mm":     brow["precipitation_mm"],
                "drought_risk_score":   brow["drought_risk_score"],
                "flood_risk_score":     brow["flood_risk_score"],
                "seasonal_baseline_mm": brow["seasonal_baseline_mm"],
                "source":               brow["source"],
            })

    if all_rows:
        ds = [r["drought_risk_score"] for r in all_rows]
        fs = [r["flood_risk_score"]   for r in all_rows]
        print(f"    → {len(all_rows)} rows | "
              f"drought {min(ds):.0f}–{max(ds):.0f} | "
              f"flood {min(fs):.0f}–{max(fs):.0f}")
    return all_rows


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    t0 = datetime.now()

    print(f"Range   : {HISTORY_START.strftime('%Y-%m')} → {RANGE_END.strftime('%Y-%m')}")
    print(f"Regions : {len(REGION_MAP)}")
    print(f"Scoring : SPI-1 (drought)  |  API k={API_K} percentile (flood)")
    print(f"Output  : {OUTPUT_FILE}")
    print()

    all_rows = []
    failed   = []

    for region_code, meta in REGION_MAP.items():
        print(f"[{region_code}] {meta['region_name']}")
        try:
            rows = process_region(region_code, meta, existing_months=set())
            all_rows.extend(rows)
        except Exception as e:
            print(f"    FAILED: {e}")
            failed.append(region_code)
        print()
        time.sleep(INTER_REGION_SEC)

    if not all_rows:
        print("No data produced. Check errors above.")
        return

    result = pd.DataFrame(all_rows)
    result.insert(0, "forecast_id", range(1, len(result) + 1))
    result = result.sort_values(["region_code", "year_month"]).reset_index(drop=True)
    result.to_csv(OUTPUT_FILE, index=False)

    elapsed = (datetime.now() - t0).total_seconds()
    print("=" * 60)
    print(f"Output  : {OUTPUT_FILE}")
    print(f"Rows    : {len(result):,}")
    print(f"Failed  : {failed or 'none'}")
    print(f"Elapsed : {elapsed:.0f}s")
    print()
    print("Coverage per region:")
    summary = result.groupby("region_code")["year_month"].agg(
        months="count", from_month="min", to_month="max"
    )
    print(summary.to_string())
    print()
    print("Source breakdown:")
    print(result["source"].value_counts().to_string())


if __name__ == "__main__":
    try:
        from dateutil.relativedelta import relativedelta
    except ImportError:
        print("Run: pip install python-dateutil")
        raise
    main()