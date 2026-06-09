"""
backfill_commodity_prices.py
============================
Backfills MONTHLY wheat, rice, and maize price data into the Crop_Prices sheet
of a treasury data workbook, from January 2022 through the most recent available
month.

Adds a `month` column alongside `year` to distinguish monthly rows from the
existing annual rows. Existing rows are left untouched.

Usage
-----
  pip install yfinance openpyxl pandas
  python backfill_commodity_prices.py \
      --input  treasury_data_20260609.xlsx \
      --output treasury_data_backfilled.xlsx
"""

import argparse
import warnings
from datetime import date

import numpy as np
import pandas as pd
import yfinance as yf
from dateutil.relativedelta import relativedelta

warnings.filterwarnings("ignore")

# ── CLI ───────────────────────────────────────────────────────────────────────

parser = argparse.ArgumentParser()
parser.add_argument("--input",  default="treasury_data_20260609.xlsx")
parser.add_argument("--output", default="treasury_data_backfilled.xlsx")
args = parser.parse_args()

INGEST_NOW   = pd.Timestamp.utcnow().strftime("%Y-%m-%d %H:%M:%S")
TODAY        = date.today()
BACKFILL_START = "2022-01-01"

# ── Commodity tickers (same as update script) ─────────────────────────────────

CROP_TICKERS = {
    "Maize": {"ticker": "ZC=F", "conv": 39.368, "basis": "US No.2 Yellow, Gulf ports"},
    "Wheat": {"ticker": "ZW=F", "conv": 36.744, "basis": "US No.2 Hard Red Winter, Gulf"},
    "Rice":  {"ticker": "ZR=F", "conv": 22.046, "basis": "Thai white milled 5%, Bangkok"},
}

# Futures prices are quoted in cents/bushel (ZC, ZW) or cents/cwt (ZR).
# Dividing by 100 and multiplying by the conversion factor gives $/mt.

# ── Load workbook ─────────────────────────────────────────────────────────────

print(f"Loading {args.input}...")
xl     = pd.ExcelFile(args.input)
sheets = {s: xl.parse(s) for s in xl.sheet_names}
crop   = sheets["Crop_Prices"].copy()

# Add month column if not present (NaN for existing annual rows)
if "month" not in crop.columns:
    crop.insert(crop.columns.get_loc("year") + 1, "month", pd.NA)

# ── Fetch and build monthly rows ──────────────────────────────────────────────

end_date = (TODAY + relativedelta(months=1)).replace(day=1).strftime("%Y-%m-%d")
new_rows = []

for crop_name, meta in CROP_TICKERS.items():
    ticker = meta["ticker"]
    conv   = meta["conv"]
    basis  = meta["basis"]

    print(f"  Fetching {crop_name} ({ticker})...", end=" ")

    try:
        df = yf.download(
            ticker,
            start=BACKFILL_START,
            end=end_date,
            interval="1mo",
            progress=False,
            auto_adjust=True,
        )
        if df.empty:
            raise ValueError("empty response from yfinance")

        df        = df.reset_index()
        close_col = "Close" if "Close" in df.columns else df.columns[-1]

        fetched = 0
        for _, row in df.iterrows():
            dt    = pd.Timestamp(row["Date"])
            yr    = dt.year
            mo    = dt.month
            price = float(row[close_col]) if not hasattr(row[close_col], "__len__") \
                    else float(row[close_col].iloc[0])
            price_mt = round(price / 100 * conv, 1)

            # Skip if this crop/year/month already exists as a monthly row
            mask = (
                (crop["crop"] == crop_name) &
                (crop["year"] == yr) &
                (crop["month"].notna()) &
                (crop["month"].astype("Int64") == mo)
            )
            if mask.any():
                continue

            new_rows.append({
                "crop":        crop_name,
                "year":        yr,
                "month":       mo,
                "price":       price_mt,
                "unit":        "$/mt",
                "price_basis": basis,
                "source":      f"Yahoo Finance/{ticker} — monthly close",
            })
            fetched += 1

        print(f"{fetched} rows")

    except Exception as e:
        print(f"FAILED ({e}) — skipping {crop_name}")

# ── Write back ────────────────────────────────────────────────────────────────

if new_rows:
    new_df           = pd.DataFrame(new_rows)
    sheets["Crop_Prices"] = pd.concat([crop, new_df], ignore_index=True)
    print(f"\nCrop_Prices: added {len(new_rows)} monthly rows total")
else:
    sheets["Crop_Prices"] = crop
    print("\nCrop_Prices: nothing new to add")

print(f"Writing {args.output}...")
with pd.ExcelWriter(args.output, engine="openpyxl") as writer:
    for sheet_name, df in sheets.items():
        df.to_excel(writer, sheet_name=sheet_name, index=False)

print("Done.")
