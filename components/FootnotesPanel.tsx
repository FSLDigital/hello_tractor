'use client'
import { useState } from 'react'

const METRICS = [
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
    notes: 'This is forward-looking residual revenue exposure, not historical collections. A tractor with one month left on contract contributes proportionally less than one newly deployed. FX conversion uses the latest observed rate for each currency.',
  },
  {
    label: 'Utilisation (%)',
    formula: 'Σ worked_ha ÷ Σ covenant_ha × 100 across the selected date window',
    notes: 'Covenant ha is the contracted area target; worked ha is the area actually serviced. Months with no data are excluded from both numerator and denominator.',
  },
  {
    label: 'Implied $/ha',
    formula: 'Σ amount_paid ÷ Σ worked_ha across the selected date window',
    notes: 'Average revenue yield per worked hectare. High values can reflect a favourable crop mix or premium contracts; low values may indicate collection shortfalls or low-rate regions dominating the window.',
  },
  {
    label: 'Repayment Rate (Collections Trend)',
    formula: 'Σ paid ÷ Σ owed × 100 across the selected date window',
    notes: 'owed here is expected_collection from HT performance records. Different from the portfolio-level repayment rate above because it is filtered to the selected month window and chart-level country / crop filters.',
  },
]

export default function FootnotesPanel() {
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
          {METRICS.map((m, i) => (
            <div
              key={m.label}
              style={{
                display: 'grid', gridTemplateColumns: '220px 1fr',
                gap: '0 24px', padding: '12px 0',
                borderBottom: i < METRICS.length - 1 ? '0.5px solid var(--border)' : 'none',
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
