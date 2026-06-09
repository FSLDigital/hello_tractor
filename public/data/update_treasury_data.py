"""
update_treasury_data.py
=======================
Extends treasury_data_YYYYMMDD.xlsx with the latest available data for:
  1. FX_Rates      — monthly close via Yahoo Finance (yfinance)
  2. Crop_Prices   — annual estimates for Maize, Wheat, Rice (yfinance/CBOT futures)
  3. Weather_Forecast — Open-Meteo archive + forecast + ERA5 baseline extension
  4. Political_Risk   — appends latest month using political_risk_scores CSV

Usage
-----
  pip install yfinance openpyxl openmeteo-requests requests-cache retry-requests
  python update_treasury_data.py \
      --input  treasury_data_20260609.xlsx \
      --output treasury_data_updated.xlsx \
      --pol_risk political_risk_scores_YYYYMMDD.csv

Run monthly (or on-demand) and push the output to the DB loader.
"""

import argparse
import os
from datetime import datetime, date
from dateutil.relativedelta import relativedelta
import numpy as np
import pandas as pd
import warnings
warnings.filterwarnings("ignore")

# ── CLI ──────────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser()
parser.add_argument("--input",    default="treasury_data_20260609.xlsx")
parser.add_argument("--output",   default="treasury_data_updated.xlsx")
parser.add_argument("--pol_risk", default="political_risk_scores_latest.csv")
args = parser.parse_args()

INGEST_NOW = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")

# ── Region coordinates for Open-Meteo ────────────────────────────────────────
REGION_COORDS = {
    "ET-BA": (7.0, 38.5), "ET-ES": (6.5, 38.7), "ET-SI": (6.5, 37.5), "ET-WA": (9.0, 38.0),
    "KE-CT": (-1.3, 36.8), "KE-NY": (0.3, 35.1), "KE-RV": (-0.5, 35.5), "KE-WR": (-0.1, 34.7),
    "NG-KD": (10.5, 7.4), "NG-KN": (12.0, 8.5), "NG-NC": (9.1, 7.4), "NG-NE": (12.3, 13.2),
    "NG-NW": (12.0, 5.0), "NG-SE": (5.5, 8.0), "NG-SW": (7.4, 3.9),
    "RW-EP": (-2.0, 30.3), "RW-KG": (-1.9, 30.1),
    "UG-CR": (0.3, 32.6), "UG-ER": (1.1, 33.5), "UG-NR": (2.8, 32.3), "UG-WR": (0.7, 30.3),
}

# ── FX tickers (Yahoo Finance) ────────────────────────────────────────────────
FX_TICKERS = {
    "ETB": "ETBUSD=X", "KES": "KESUSD=X", "NGN": "NGNUSD=X",
    "RWF": "RWFUSD=X", "UGX": "UGXUSD=X", "GHS": "GHSUSD=X",
}

# ── Crop tickers (Yahoo Finance — CBOT nearby futures, $/bushel → $/mt) ───────
CROP_TICKERS = {
    "Maize": {"ticker": "ZC=F", "conv": 39.368},   # ¢/bu → $/mt (÷100 * 39.368)
    "Wheat": {"ticker": "ZW=F", "conv": 36.744},   # ¢/bu → $/mt
    "Rice":  {"ticker": "ZR=F", "conv": 22.046},   # ¢/cwt → $/mt (rough proxy)
}


def load_xl(path):
    xl = pd.ExcelFile(path)
    return {s: xl.parse(s) for s in xl.sheet_names}


def update_fx(sheets):
    """Append missing monthly FX closes via yfinance."""
    import yfinance as yf
    fx = sheets["FX_Rates"].copy()
    new_rows = []
    for ccy, ticker in FX_TICKERS.items():
        sub = fx[fx["currency_code"] == ccy].sort_values("observed_at")
        if sub.empty:
            continue
        latest_date = pd.to_datetime(sub["observed_at"].max())
        if pd.isna(latest_date):
            continue
        start = (latest_date + relativedelta(months=1)).replace(day=1).strftime("%Y-%m-%d")
        end = (date.today() + relativedelta(months=1)).replace(day=1).strftime("%Y-%m-%d")
        if start >= end:
            continue
        try:
            df = yf.download(ticker, start=start, end=end, interval="1mo", progress=False, auto_adjust=True)
            if df.empty:
                continue
            df = df.reset_index()
            close_col = "Close" if "Close" in df.columns else df.columns[-1]
            for _, row in df.iterrows():
                rate_raw = float(row[close_col]) if not hasattr(row[close_col], "__len__") else float(row[close_col].iloc[0])
                # Yahoo gives CCYUSD=X as units per USD (same as rate_to_usd)
                month_end = (pd.Timestamp(row["Date"]) + pd.offsets.MonthEnd(0)).strftime("%Y-%m-%d")
                new_rows.append({
                    "currency_code": ccy, "rate_to_usd": round(rate_raw, 4),
                    "observed_at": month_end, "ingested_at": INGEST_NOW,
                    "source": "yahoo_finance", "is_interpolated": False,
                })
        except Exception as e:
            print(f"  FX {ccy}: {e} — interpolating from trend")
            rates = sub.tail(3)["rate_to_usd"].values.astype(float)
            next_rate = rates[-1] + np.mean(np.diff(rates))
            month_end = (latest_date + relativedelta(months=1) + pd.offsets.MonthEnd(0)).strftime("%Y-%m-%d")
            new_rows.append({
                "currency_code": ccy, "rate_to_usd": round(float(next_rate), 4),
                "observed_at": month_end, "ingested_at": INGEST_NOW,
                "source": "yahoo_finance", "is_interpolated": True,
            })
    if new_rows:
        sheets["FX_Rates"] = pd.concat([fx, pd.DataFrame(new_rows)], ignore_index=True)
        print(f"  FX_Rates: added {len(new_rows)} rows")
    return sheets


def update_crop_prices(sheets):
    """
    Add or update annual crop price estimates for Maize, Wheat, Rice.
    Tries yfinance first; falls back to trend extrapolation from existing data.
    """
    import yfinance as yf
    crop = sheets["Crop_Prices"].copy()
    current_year = date.today().year
    target_years = [y for y in range(crop["year"].max() + 1, current_year + 1)]
    
    new_rows = []
    for crop_name, meta in CROP_TICKERS.items():
        ticker = meta["ticker"]
        conv = meta["conv"]
        prior_prices = crop[crop["crop"] == crop_name].sort_values("year")["price"].values
        for yr in target_years:
            if not crop[(crop["crop"] == crop_name) & (crop["year"] == yr)].empty:
                continue
            try:
                df = yf.download(ticker, start=f"{yr}-01-01", end=f"{yr}-12-31",
                                 interval="1mo", progress=False, auto_adjust=True)
                if not df.empty:
                    close_col = "Close" if "Close" in df.columns else df.columns[-1]
                    # Convert from cents/bushel to $/mt
                    avg_price = round(float(df[close_col].mean()) / 100 * conv, 1)
                    source = f"Yahoo Finance/{ticker} — monthly avg {yr}"
                else:
                    raise ValueError("empty")
            except Exception:
                # Trend fallback: apply average annual change
                if len(prior_prices) >= 2:
                    annual_change = np.mean(np.diff(prior_prices[-3:]))
                    avg_price = round(float(prior_prices[-1]) + annual_change, 1)
                else:
                    avg_price = round(float(prior_prices[-1]) * 0.97, 1)
                source = f"Trend extrapolation from {yr-1} data"
            
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


def update_weather(sheets, forecast_months_ahead=9):
    """
    1. Re-classify past open_meteo_forecast months as open_meteo_archive.
    2. Fetch new archive data for missing months via Open-Meteo historical API.
    3. Fetch forecast data (next 2 months) via Open-Meteo forecast API.
    4. Extend ERA5 baseline through forecast_months_ahead from today.
    """
    import openmeteo_requests
    import requests_cache
    from retry_requests import retry
    
    cache_session = requests_cache.CachedSession(".cache", expire_after=3600)
    retry_session = retry(cache_session, retries=3, backoff_factor=0.2)
    om = openmeteo_requests.Client(session=retry_session)
    
    wf = sheets["Weather_Forecast"].copy()
    today_ym = date.today().strftime("%Y-%m")
    
    # a) Re-classify past forecast months
    mask = (wf["source"] == "open_meteo_forecast") & (wf["year_month"] < today_ym)
    wf.loc[mask, "source"] = "open_meteo_archive"
    wf.loc[mask, "ingested_at"] = INGEST_NOW
    
    # b) Fetch missing archive months (last complete month not yet archived)
    archive = wf[wf["source"] == "open_meteo_archive"]
    latest_archive_ym = archive.groupby("region_code")["year_month"].max()
    
    new_rows = []
    max_id = int(wf["forecast_id"].max())
    
    for region, coords in REGION_COORDS.items():
        lat, lon = coords
        last_ym = latest_archive_ym.get(region, "2022-01")
        last_date = pd.to_datetime(last_ym + "-01")
        start = (last_date + relativedelta(months=1)).strftime("%Y-%m-%d")
        end_archive = (pd.to_datetime(today_ym + "-01") - relativedelta(days=1)).strftime("%Y-%m-%d")
        
        if start <= end_archive:
            try:
                url = "https://archive-api.open-meteo.com/v1/archive"
                params = {"latitude": lat, "longitude": lon, "start_date": start,
                          "end_date": end_archive, "daily": "precipitation_sum",
                          "timezone": "UTC"}
                responses = om.weather_api(url, params=params)
                daily = responses[0].Daily()
                dates = pd.date_range(start=pd.to_datetime(daily.Time(), unit="s"),
                                      end=pd.to_datetime(daily.TimeEnd(), unit="s"),
                                      freq=pd.Timedelta(seconds=daily.Interval()),
                                      inclusive="left")
                precip = daily.Variables(0).ValuesAsNumpy()
                df_arch = pd.DataFrame({"date": dates, "precip": precip})
                df_arch["ym"] = df_arch["date"].dt.strftime("%Y-%m")
                monthly = df_arch.groupby("ym")["precip"].sum().reset_index()
                
                # Compute baseline from historical same-month averages
                arch_hist = archive[archive["region_code"] == region].copy()
                arch_hist["month_num"] = arch_hist["year_month"].str.split("-").str[1].astype(int)
                baseline_map = arch_hist.groupby("month_num")["precipitation_mm"].mean().to_dict()
                
                for _, row in monthly.iterrows():
                    mn = int(row["ym"].split("-")[1])
                    baseline = round(float(baseline_map.get(mn, row["precip"])), 2)
                    precip_val = round(float(row["precip"]), 2)
                    deficit = max(0, (baseline - precip_val) / baseline) if baseline > 0 else 0
                    drought = round(10 + 70 * np.sqrt(deficit), 2)
                    excess = max(0, (precip_val - baseline) / baseline) if baseline > 0 else 0
                    flood = round(min(100, 5 + 50 * np.sqrt(excess)), 2)
                    max_id += 1
                    new_rows.append({"forecast_id": max_id, "region_code": region,
                        "year_month": row["ym"], "ingested_at": INGEST_NOW,
                        "precipitation_mm": precip_val, "drought_risk_score": drought,
                        "flood_risk_score": flood, "seasonal_baseline_mm": baseline,
                        "source": "open_meteo_archive"})
            except Exception as e:
                print(f"    Weather archive {region}: {e}")
        
        # c) Forecast next 2 months
        try:
            url_fc = "https://api.open-meteo.com/v1/forecast"
            fc_start = pd.to_datetime(today_ym + "-01").strftime("%Y-%m-%d")
            fc_end = (pd.to_datetime(today_ym + "-01") + relativedelta(months=2, days=-1)).strftime("%Y-%m-%d")
            params_fc = {"latitude": lat, "longitude": lon, "daily": "precipitation_sum",
                         "start_date": fc_start, "end_date": fc_end, "timezone": "UTC"}
            fc_resp = om.weather_api(url_fc, params=params_fc)
            fc_daily = fc_resp[0].Daily()
            fc_dates = pd.date_range(start=pd.to_datetime(fc_daily.Time(), unit="s"),
                                     end=pd.to_datetime(fc_daily.TimeEnd(), unit="s"),
                                     freq=pd.Timedelta(seconds=fc_daily.Interval()),
                                     inclusive="left")
            fc_precip = fc_daily.Variables(0).ValuesAsNumpy()
            df_fc = pd.DataFrame({"date": fc_dates, "precip": fc_precip})
            df_fc["ym"] = df_fc["date"].dt.strftime("%Y-%m")
            fc_monthly = df_fc.groupby("ym")["precip"].sum().reset_index()
            
            arch_hist = archive[archive["region_code"] == region].copy()
            arch_hist["month_num"] = arch_hist["year_month"].str.split("-").str[1].astype(int)
            baseline_map = arch_hist.groupby("month_num")["precipitation_mm"].mean().to_dict()
            
            for _, row in fc_monthly.iterrows():
                # Skip if already archived
                if not wf[(wf["region_code"]==region) & (wf["year_month"]==row["ym"])].empty:
                    wf.loc[(wf["region_code"]==region) & (wf["year_month"]==row["ym"]),
                           ["ingested_at","source"]] = [INGEST_NOW, "open_meteo_forecast"]
                    continue
                mn = int(row["ym"].split("-")[1])
                baseline = round(float(baseline_map.get(mn, row["precip"])), 2)
                precip_val = round(float(row["precip"]), 2)
                deficit = max(0, (baseline - precip_val) / baseline) if baseline > 0 else 0
                drought = round(10 + 70 * np.sqrt(deficit), 2)
                excess = max(0, (precip_val - baseline) / baseline) if baseline > 0 else 0
                flood = round(min(100, 5 + 50 * np.sqrt(excess)), 2)
                max_id += 1
                new_rows.append({"forecast_id": max_id, "region_code": region,
                    "year_month": row["ym"], "ingested_at": INGEST_NOW,
                    "precipitation_mm": precip_val, "drought_risk_score": drought,
                    "flood_risk_score": flood, "seasonal_baseline_mm": baseline,
                    "source": "open_meteo_forecast"})
        except Exception as e:
            print(f"    Weather forecast {region}: {e}")
    
    # d) ERA5 baseline extension
    target_end = pd.to_datetime(today_ym + "-01") + relativedelta(months=forecast_months_ahead)
    arch_all = wf[wf["source"] == "open_meteo_archive"].copy()
    arch_all["month_num"] = arch_all["year_month"].str.split("-").str[1].astype(int)
    baseline_regional = arch_all.groupby(["region_code","month_num"])["precipitation_mm"].mean().reset_index()
    
    existing_yms = set(zip(wf["region_code"], wf["year_month"]))
    existing_yms |= set(zip([r["region_code"] for r in new_rows], [r["year_month"] for r in new_rows]))
    
    cur = pd.to_datetime(today_ym + "-01") + relativedelta(months=3)
    while cur <= target_end:
        ym = cur.strftime("%Y-%m")
        for region in REGION_COORDS:
            if (region, ym) in existing_yms:
                cur += relativedelta(months=1)
                continue
            mn = cur.month
            bl_row = baseline_regional[(baseline_regional["region_code"]==region) & (baseline_regional["month_num"]==mn)]
            baseline = round(float(bl_row["precipitation_mm"].values[0]), 2) if len(bl_row) > 0 else 0.0
            max_id += 1
            new_rows.append({"forecast_id": max_id, "region_code": region, "year_month": ym,
                "ingested_at": INGEST_NOW, "precipitation_mm": baseline, "drought_risk_score": 0.0,
                "flood_risk_score": 0.0, "seasonal_baseline_mm": baseline, "source": "era5_baseline"})
        cur += relativedelta(months=1)
    
    if new_rows:
        sheets["Weather_Forecast"] = pd.concat([wf, pd.DataFrame(new_rows)], ignore_index=True)
        print(f"  Weather_Forecast: added {len(new_rows)} rows")
    return sheets


def update_political_risk(sheets, pol_risk_csv):
    """Append latest month of political risk scores from CSV."""
    if not os.path.exists(pol_risk_csv):
        print(f"  Political_Risk: CSV not found at {pol_risk_csv} — skipping")
        return sheets
    
    pr = sheets["Political_Risk"].copy()
    pr_csv = pd.read_csv(pol_risk_csv)
    
    # Determine target scoring month (first of next month after latest in XL)
    latest_date = pd.to_datetime(pr["scoring_date"].max())
    target_date = (latest_date + relativedelta(months=1)).replace(day=1).strftime("%Y-%m-%d")
    
    # Skip if already present
    if target_date in pr["scoring_date"].values:
        print(f"  Political_Risk: {target_date} already present — skipping")
        return sheets
    
    xl_countries = pr["country_code"].unique().tolist()
    may_rows = pr[pr["scoring_date"] == pr["scoring_date"].max()].set_index("country_code")
    
    new_rows = []
    for _, csv_row in pr_csv.iterrows():
        cc = csv_row["country_code"]
        if cc not in xl_countries:
            continue
        prior = may_rows.loc[cc]
        csv_score = int(csv_row["score"])
        may_score = int(prior["score"])
        
        p4_may, p5_may = int(prior["pillar_agriculture_risk"]), int(prior["pillar_lending_risk"])
        p4_p5_new = round((p4_may + p5_may) * csv_score / may_score)
        p4_new = round(p4_may * csv_score / may_score)
        p5_new = p4_p5_new - p4_new
        
        ps123_budget = csv_score - p4_p5_new
        csv_ps_total = (int(csv_row["pillar_political_stability"]) +
                        int(csv_row["pillar_security_environment"]) +
                        int(csv_row["pillar_economic_fragility"]))
        if csv_ps_total > 0:
            ps1 = round(csv_row["pillar_political_stability"] / csv_ps_total * ps123_budget)
            ps2 = round(csv_row["pillar_security_environment"] / csv_ps_total * ps123_budget)
            ps3 = ps123_budget - ps1 - ps2
        else:
            ps1 = ps2 = 0; ps3 = ps123_budget
        
        def scale_subs(subs_may, new_total):
            s = sum(subs_may)
            if s == 0:
                return [new_total // len(subs_may)] * len(subs_may)
            scaled = [round(v / s * new_total) for v in subs_may]
            scaled[-1] += new_total - sum(scaled)
            return scaled
        
        p4_subs = scale_subs([int(prior["p4_land_rights"]), int(prior["p4_input_subsidy_disruption"]),
                               int(prior["p4_trade_export_policy"]), int(prior["p4_conflict_farming_zones"])], p4_new)
        p5_subs = scale_subs([int(prior["p5_fx_controls"]), int(prior["p5_govt_credit_interference"]),
                               int(prior["p5_regulatory_risk"]), int(prior["p5_borrower_repayment_capacity"])], p5_new)
        
        new_rows.append({
            "scoring_date": target_date, "country_code": cc,
            "country_name": csv_row["country_name"], "score": csv_score,
            "tier": csv_row["tier"], "prior_score": may_score,
            "score_delta": csv_score - may_score,
            "score_vs_baseline": csv_row["score_vs_baseline"],
            "prior_score_change_justified": bool(csv_row["prior_score_change_justified"]),
            "pillar_political_stability": ps1, "pillar_security_environment": ps2,
            "pillar_economic_fragility": ps3, "pillar_agriculture_risk": p4_new,
            "pillar_lending_risk": p5_new,
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


# ── Main ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print(f"Loading {args.input}...")
    sheets = load_xl(args.input)
    
    print("Updating FX rates...")
    sheets = update_fx(sheets)
    
    print("Updating crop prices...")
    sheets = update_crop_prices(sheets)
    
    print("Updating weather forecasts...")
    sheets = update_weather(sheets)
    
    print("Updating political risk...")
    sheets = update_political_risk(sheets, args.pol_risk)
    
    print(f"Writing {args.output}...")
    with pd.ExcelWriter(args.output, engine="openpyxl") as writer:
        for sheet_name, df in sheets.items():
            df.to_excel(writer, sheet_name=sheet_name, index=False)
    
    print("Done.")
