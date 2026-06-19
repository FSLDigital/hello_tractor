"""
fetch_monthly_crop_prices.py
----------------------------
Fetches monthly CBOT futures prices for Maize, Wheat, and Rice from Jan 2022
using yfinance, converts to $/mt, and outputs an Excel file matching the
column structure of the existing crop_prices.xlsx.

Requirements:
    pip install yfinance openpyxl pandas

Output:
    crop_prices_monthly.xlsx  (same directory as this script)
"""

import yfinance as yf
import pandas as pd
from datetime import datetime

# ── Configuration ────────────────────────────────────────────────────────────

CROPS = {
    "Maize": {
        "ticker": "ZC=F",              # CBOT Corn continuous front-month
        "unit": "$/mt",
        "price_basis": "US No.2 Yellow, Gulf ports",
        # CBOT corn quotes in US cents per bushel; 1 bushel corn = 25.4012 kg
        # → 1 mt = 39.368 bushels → price_usd_per_mt = (cents/bu) / 100 * 39.368
        "conversion": lambda p: p / 100 * 39.368,
    },
    "Wheat": {
        "ticker": "ZW=F",              # CBOT Wheat continuous front-month
        "unit": "$/mt",
        "price_basis": "US No.2 Hard Red Winter, Gulf",
        # CBOT wheat quotes in US cents per bushel; 1 bushel wheat = 27.2155 kg
        # → 1 mt = 36.744 bushels → price_usd_per_mt = (cents/bu) / 100 * 36.744
        "conversion": lambda p: p / 100 * 36.744,
    },
    "Rice": {
        "ticker": "ZR=F",              # CBOT Rough Rice continuous front-month
        "unit": "$/mt",
        "price_basis": "Thai white milled 5%, Bangkok",
        # CBOT rough rice quotes in USD per hundredweight (cwt); 1 cwt = 45.3592 kg
        # → 1 mt = 22.046 cwt → price_usd_per_mt = price_per_cwt * 22.046
        # Note: CBOT rough rice ≠ milled rice benchmark exactly, but is the
        # closest liquid monthly proxy available via yfinance.
        "conversion": lambda p: p * 22.046,
    },
}

START_DATE = "2022-01-01"
END_DATE   = datetime.today().strftime("%Y-%m-%d")
SOURCE     = "Yahoo Finance / CBOT continuous front-month futures"

# ── Fetch & transform ────────────────────────────────────────────────────────

rows = []

for crop_name, cfg in CROPS.items():
    print(f"Fetching {crop_name} ({cfg['ticker']}) ...")
    hist = yf.download(
        cfg["ticker"],
        start=START_DATE,
        end=END_DATE,
        interval="1mo",
        progress=False,
        auto_adjust=True,
    )

    if hist.empty:
        print(f"  WARNING: No data returned for {cfg['ticker']}")
        continue

    # Use monthly Close price
    close = hist["Close"].squeeze()

    for date, raw_price in close.items():
        if pd.isna(raw_price):
            continue
        price_mt = round(cfg["conversion"](float(raw_price)), 2)
        rows.append({
            "crop":        crop_name,
            "year":        date.year,
            "year_month":  date.strftime("%Y-%m"),
            "price":       price_mt,
            "unit":        cfg["unit"],
            "price_basis": cfg["price_basis"],
            "source":      SOURCE,
        })

df = pd.DataFrame(rows)
df = df.sort_values(["crop", "year_month"]).reset_index(drop=True)

# ── Write to Excel ───────────────────────────────────────────────────────────

out_path = "crop_prices_monthly.xlsx"
df.to_excel(out_path, index=False)
print(f"\nDone. {len(df)} rows written to {out_path}")
print(df.head(10).to_string(index=False))