# Treasury Risk Intelligence Engine — Hello Tractor

A 6-page Next.js dashboard for treasury risk monitoring powered by real data.

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Latest Alert Email

The Python email trigger sends the latest three active alerts to
`ola@hellotractor.com` by default, using Gmail SMTP and the same OpenAI pattern
as the dashboard alert summary.

```bash
python3 -m pip install -r requirements-email.txt
python3 send_last_alerts_email.py --dry-run
python3 send_last_alerts_email.py --to ola@hellotractor.com
```

Required environment variables:

```bash
OPENAI_API_KEY=...
SMTP_USER=your.gmail.address@gmail.com
SMTP_PASS=your_gmail_app_password
HT_ALERT_EMAIL_TO=ola@hellotractor.com
```

Optional online context providers:

```bash
HT_ALERT_SEARCH_PROVIDER=tavily # tavily, serper, or brave
TAVILY_API_KEY=...
# or SERPER_API_KEY=...
# or BRAVE_SEARCH_API_KEY=...
```

When the FastAPI digest service is running, trigger it with:

```bash
curl -X POST http://localhost:8000/portfolio-digest-email/run-now/last-alerts \
  -H "Authorization: Bearer <token>"
```

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
