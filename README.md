# Treasury Risk Intelligence Engine — Hello Tractor

A 6-page Next.js dashboard for treasury risk monitoring powered by real data.

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Pages

| Page | Route | Purpose |
|------|-------|---------|
| Command Centre | `/` | Portfolio overview, alert strip, risk matrix |
| FX & Liabilities | `/fx` | Currency depreciation, debt facilities, ALM |
| Regional Risk | `/regional` | Weather & political risk by country/region |
| Commodity | `/commodity` | Crop price trends, implement concentration |
| Scenario Modeller | `/scenario` | Interactive stress testing with sliders |
| Alerts | `/alerts` | Active alerts log + rule builder |

## Data

All source data is in `public/data/treasury_data.xlsx` with 9 sheets:

| Sheet | Source | Rows |
|-------|--------|------|
| FX_Rates | fx_rates_monthly.csv | 265 |
| Repayment_Schedule | repayment_schedule.csv | 35 |
| Brent_Crude | brent_monthly.csv | 53 |
| Crop_Prices | crop_prices_2022_2025.csv | 68 |
| Political_Risk | political_risk_history_2022_2026.csv | 265 |
| Weather_Forecast | weather_forecast_monthly.csv | 1,218 |
| Seasonality_Index | seasonality_index.csv | 60 |
| Crop_Country_Mapping | crop_country_mapping.csv | 270 |
| HT_Performance | HT_Combined_Performance_Data.xlsx | 8,162 |

## Tech Stack

- Next.js 16 (App Router, Server Components)
- Recharts for all charts
- xlsx for Excel parsing
- DM Sans + Syne + DM Mono fonts
- Dark theme design system
