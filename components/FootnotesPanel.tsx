'use client'
import { useState } from 'react'

export interface FootnoteMetric {
  label: string
  formula: string
  notes: string
}

export const COMMAND_CENTRE_METRICS: FootnoteMetric[] = [
  {
    label: 'Total Outstanding Debt',
    formula: 'Σ outstanding_usd across unique active facilities (deduplicated by facility ID)',
    notes: 'Sourced from the repayments sheet. Each facility is counted once — individual repayment rows for the same facility share the same outstanding_usd balance.',
  },
  {
    label: 'Portfolio Repayment Rate',
    formula: 'total_paid ÷ total_owed × 100',
    notes: 'total_owed is the sum of expected collections across all HT performance records matching the active filter. total_paid is the sum of actual collections recorded in the same records.',
  },
  {
    label: 'Active Tractors',
    formula: 'Count of unique tractor IDs in HT performance data',
    notes: 'Filtered by the current country / region / implement / funder / crop selection. A tractor appears at most once regardless of how many performance rows it has.',
  },
  {
    label: 'Wtd. Avg. Political Risk',
    formula: 'Σ(score_c × tractors_c) ÷ Σ(tractors_c) for each country c',
    notes: 'Country scores come from the political risk sheet (latest scoring date per country). Weights are tractor counts so countries with more deployed capital pull the average harder.',
  },
  {
    label: 'Country Exposure ($k)',
    formula: 'Per country: Σ toUSD(covenant_ha × rate_per_ha, currency) × remaining_months(origination_date, today)',
    notes: 'Forward-looking residual revenue exposure, not historical collections. A tractor with one month left on contract contributes proportionally less than one newly deployed. FX conversion uses the latest observed rate for each currency.',
  },
  {
    label: 'Utilisation (%)',
    formula: 'Σ worked_ha ÷ Σ covenant_ha × 100 across the selected date window',
    notes: 'Covenant ha is the contracted area target; worked ha is the area actually serviced. Months with no data are excluded from both numerator and denominator.',
  },
  {
    label: 'Implied $/ha',
    formula: 'Σ amount_paid ÷ Σ worked_ha across the selected date window',
    notes: 'Average revenue yield per worked hectare. High values reflect a favourable crop mix or premium contracts; low values may indicate collection shortfalls or low-rate regions dominating the window.',
  },
  {
    label: 'Repayment Rate (Collections Trend)',
    formula: 'Σ paid ÷ Σ owed × 100 across the selected date window',
    notes: 'owed here is expected_collection from HT performance records. Different from the portfolio-level repayment rate above because it is filtered to the selected month window and chart-level country / crop filters.',
  },
]

export const FX_METRICS: FootnoteMetric[] = [
  {
    label: 'KES / USD Facility Exposure',
    formula: 'Σ outstanding_usd for active facilities denominated in KES (deduplicated by facility ID)',
    notes: 'Outstanding balance is stored in USD-equivalent terms in the repayments sheet. KES and USD facilities are split to show the natural hedge position.',
  },
  {
    label: 'Wtd. Avg. Cost of Funding (WACF)',
    formula: 'Σ(rate_i × outstanding_i) ÷ Σ(outstanding_i) across all active facilities',
    notes: 'Interest rates are sourced from the repayments sheet. Facilities with a null rate are treated as 0% — a conservative assumption flagged in the sub-text.',
  },
  {
    label: 'Wtd. Portfolio FX Shift',
    formula: 'Σ(Δ%_c × exposure_c) ÷ Σ(exposure_c) across the 5 portfolio currencies',
    notes: 'Δ% is the cumulative change in each currency\'s rate_to_usd from the selected base date to latest observation. Positive = local currencies weakened vs USD (bad for USD-denominated liabilities). Weights are USD-equivalent tractor revenue exposure per currency.',
  },
  {
    label: 'DSCR',
    formula: 'EBITDA ÷ (Interest Expense + Principal Repayments)',
    notes: 'Sourced from the DSCR sheet. Periods where denominator = 0 return null. A ratio ≥ 1.25 is typically considered adequate; < 1.0 means cash flow does not cover debt service.',
  },
  {
    label: 'LLCR',
    formula: 'Σ[ CFADS_j ÷ (1 + r/12)^(j−i+1) ] ÷ total_debt_i  for j = i…n',
    notes: 'Rolling NPV of remaining cash flows available for debt service (CFADS = EBITDA × 0.85, a placeholder) discounted at the monthly equivalent of the annual discount rate, divided by outstanding debt at period i. Higher = more cushion over the loan life.',
  },
  {
    label: 'Interest Coverage',
    formula: 'EBIT ÷ Interest Expense',
    notes: 'Measures how many times operating profit covers interest obligations. EBIT and interest expense are sourced directly from the DSCR sheet. A ratio < 2× signals elevated refinancing risk.',
  },
  {
    label: 'D/E Ratio',
    formula: 'Net Debt ÷ Shareholders\' Equity',
    notes: 'Net Debt = total_debt − cash. A rising D/E indicates increasing financial leverage. Values above 2–3× are typically considered high for asset-heavy businesses.',
  },
  {
    label: 'Value at Risk — FX (95% VaR)',
    formula: 'exp(Z₀.₀₅ × σ_monthly) − 1, where σ is the std dev of monthly log-returns',
    notes: 'Parametric VaR assuming normally distributed log-returns. Z₀.₀₅ ≈ −1.645. Computed per currency from all available monthly observations. Represents the worst expected 1-month depreciation at 95% confidence.',
  },
  {
    label: 'ALM — Historical Inflows',
    formula: 'Σ actual collections per quarter from HT performance records, converted to USD',
    notes: 'FX conversion uses the exchange rate observed closest to each quarter-end. Grouped by repayment date quarter.',
  },
  {
    label: 'ALM — Projected Inflows',
    formula: 'covenant_ha × rate_per_ha × seasonality_index × (months remaining in quarter)',
    notes: 'Seasonality index is the average worked/covenant ratio for each calendar month across all countries. Missing months default to 1.0. Repayments are sourced from the active facility schedule.',
  },
]

export const REGIONAL_METRICS: FootnoteMetric[] = [
  {
    label: 'High Drought Regions',
    formula: 'Count of regions where drought_risk_score > 70 in the latest month',
    notes: 'Drought risk score is a composite index sourced from the weather sheet (ERA5 data excluded). One row per region per month; only the latest month is counted.',
  },
  {
    label: 'High Flood Regions',
    formula: 'Count of regions where flood_risk_score > 60 in the latest month',
    notes: 'Same source as drought risk. The lower threshold (60 vs 70) reflects the higher immediate crop damage potential of flooding.',
  },
  {
    label: 'Critical Risk Regions',
    formula: 'Count of regions where drought_risk_score > 80 OR flood_risk_score > 75',
    notes: 'A stricter combined threshold. A region only needs to breach one condition to be flagged as critical.',
  },
  {
    label: 'Wtd. Avg. Political Risk',
    formula: 'Σ(score_c × tractors_c) ÷ Σ(tractors_c) for each country c',
    notes: 'Latest political risk score per country weighted by tractor count. Countries with more deployed tractors have greater influence on the average.',
  },
  {
    label: 'Tractors at Risk (bubble size)',
    formula: 'Total tractors in country if (political > 70 OR any region drought > 70 OR any region flood > 60), else 0',
    notes: 'Binary per country — either all tractors are counted as at risk (because the country meets at least one threshold) or none are. Bubble is kept at minimum size 1 for visibility even when tractors at risk = 0.',
  },
  {
    label: 'Avg. Drought (bubble Y-axis)',
    formula: 'Mean drought_risk_score across all regions in the country — latest month',
    notes: 'Simple unweighted average across regions. Countries with fewer tracked regions may show a less representative average.',
  },
  {
    label: 'Political Risk Score',
    formula: 'Composite of 5 pillars: Political Stability, Security, Economic Fragility, Agriculture Risk, Lending Risk',
    notes: 'Each pillar is scored 1–10 and sub-components within each pillar are aggregated. The total score is the sum of all pillar scores scaled to 0–100. Higher = more risk.',
  },
]

export const COMMODITY_METRICS: FootnoteMetric[] = [
  {
    label: 'Brent Crude (latest)',
    formula: 'Most recent price_usd observation from the commodity price sheet',
    notes: 'Used as a proxy for input cost pressure — fuel and fertiliser costs correlate with crude price. YoY change compares to the observation closest to 12 months prior.',
  },
  {
    label: 'Brent Change since 2022',
    formula: '(latest_price − first_2022_price) ÷ first_2022_price × 100',
    notes: 'Baseline is the first Brent observation on or after 2022-01-01. Tracks the cumulative input cost shift since the portfolio\'s main origination period.',
  },
  {
    label: 'Top Implement Concentration',
    formula: 'Records for the most common implement type ÷ total PAYG records × 100',
    notes: 'A high concentration ratio means portfolio revenue is disproportionately exposed to a single crop or use-case. Sourced from PAYG tractor records using implement type as a crop proxy.',
  },
  {
    label: 'Crop Price Index',
    formula: 'price_t ÷ price_2022 × 100, indexed to 2022 = 100',
    notes: 'Tracks relative price change for Wheat, Rice, and Maize from the international commodity price sheet. Higher index = prices have risen above 2022 baseline, improving farmer revenue capacity.',
  },
]

export const ALERTS_METRICS: FootnoteMetric[] = [
  {
    label: 'Alert Severity',
    formula: 'Determined by rule threshold: critical if score ≥ 70 or rate ≤ threshold; warning if borderline; info otherwise',
    notes: 'Severity is assigned at rule evaluation time and stored with the alert. Critical alerts represent conditions that materially threaten repayment capacity or capital safety.',
  },
  {
    label: 'Repayment Rate Alerts',
    formula: 'Triggered when country-level repayment rate (paid ÷ owed × 100) falls below the rule threshold',
    notes: 'Compared against the latest available HT performance data for the country. Rate is computed across all active records — not just the most recent month.',
  },
  {
    label: 'Political Risk Alerts',
    formula: 'Triggered when a country\'s latest political risk score exceeds the rule threshold',
    notes: 'Uses the same score as the Regional page — composite of 5 pillars from the latest scoring date. Alerts fire once per scoring period when the threshold is newly breached.',
  },
  {
    label: 'Weather Risk Alerts',
    formula: 'Triggered when any region\'s drought or flood score exceeds the rule threshold in the latest month',
    notes: 'Region-level check — a single high-risk region in an otherwise moderate country will still fire the alert. Exposure context (tractors and $ owed in that country) is shown in the AI analysis.',
  },
]

export default function FootnotesPanel({ metrics }: { metrics: FootnoteMetric[] }) {
  const [open, setOpen] = useState(false)

  return (
    <div style={{ marginTop: '24px', borderTop: '0.5px solid var(--border)', paddingTop: '16px' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: '8px',
          color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace',
          fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.07em',
          padding: 0,
        }}
      >
        <span style={{
          display: 'inline-block', fontSize: '9px',
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 180ms ease',
          lineHeight: 1,
        }}>▶</span>
        Metric definitions &amp; methodology
      </button>

      {open && (
        <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '0' }}>
          {metrics.map((m, i) => (
            <div
              key={m.label}
              style={{
                display: 'grid', gridTemplateColumns: '220px 1fr',
                gap: '0 24px', padding: '12px 0',
                borderBottom: i < metrics.length - 1 ? '0.5px solid var(--border)' : 'none',
              }}
            >
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Syne, sans-serif', paddingTop: '1px' }}>
                {m.label}
              </div>
              <div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '11px', color: 'var(--accent)', marginBottom: '4px' }}>
                  {m.formula}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                  {m.notes}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
