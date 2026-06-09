'use client'
import { useState, useMemo } from 'react'

const Z_95 = 1.6449  // one-tail 95th percentile, standard normal
const CURRENCIES = ['KES', 'NGN', 'ETB', 'UGX', 'RWF']
const NAMES: Record<string, string> = { KES: 'Kenya', NGN: 'Nigeria', ETB: 'Ethiopia', UGX: 'Uganda', RWF: 'Rwanda' }
const COLORS: Record<string, string> = { KES: '#3b82f6', NGN: '#ef4444', ETB: '#f59e0b', UGX: '#8b5cf6', RWF: '#10b981' }

function formatUSD(v: number): string {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}k`
  return `$${v.toFixed(0)}`
}

const MONO: React.CSSProperties = { fontFamily: 'DM Mono, monospace' }
const LABEL: React.CSSProperties = { fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.06em' }

export default function FXVaR({
  fxMonthlyRates,
  exposureUSD,
}: {
  fxMonthlyRates: Record<string, number[]>
  exposureUSD: Record<string, number>
}) {
  const [months, setMonths] = useState(3)

  const results = useMemo(() => {
    return CURRENCIES.map(c => {
      const rates = fxMonthlyRates[c] || []

      // Log returns of rate_to_usd (increase = local currency weakening)
      const logReturns: number[] = []
      for (let i = 1; i < rates.length; i++) {
        if (rates[i - 1] > 0 && rates[i] > 0) {
          logReturns.push(Math.log(rates[i] / rates[i - 1]))
        }
      }

      if (logReturns.length < 2) {
        return { c, monthlyVol: 0, xMonthVol: 0, worstDepPct: 0, varUSD: 0, exposure: exposureUSD[c] || 0, hasData: false }
      }

      // Monthly volatility — std dev of log returns (ddof=1)
      const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length
      const variance = logReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (logReturns.length - 1)
      const monthlyVol = Math.sqrt(variance)

      // Scale to x-month horizon (square-root-of-time rule)
      const xMonthVol = monthlyVol * Math.sqrt(months)

      // Worst-case rate at 95% CI: R0 × exp(Z_95 × σ_x)
      // Depreciation of local currency vs USD = exp(Z_95 × σ_x) − 1
      const worstDepFrac = Math.exp(Z_95 * xMonthVol) - 1

      // VaR: how much USD value is lost if local currency depreciates that much
      const exposure = exposureUSD[c] || 0
      const varUSD = exposure * worstDepFrac

      return {
        c,
        monthlyVol: monthlyVol * 100,
        xMonthVol: xMonthVol * 100,
        worstDepPct: worstDepFrac * 100,
        varUSD,
        exposure,
        hasData: true,
      }
    })
  }, [months, fxMonthlyRates, exposureUSD])

  const totalVaR = results.reduce((s, r) => s + r.varUSD, 0)
  const totalExposure = results.reduce((s, r) => s + r.exposure, 0)

  return (
    <div>
      {/* Horizon selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '24px' }}>
        <span style={{ ...LABEL, fontSize: '11px', whiteSpace: 'nowrap' }}>Horizon</span>
        <input
          type="range" min={1} max={24} step={1} value={months}
          onChange={e => setMonths(Number(e.target.value))}
          style={{ width: '180px', accentColor: 'var(--accent)' }}
        />
        <span style={{ fontSize: '20px', fontWeight: 600, fontFamily: 'Syne, sans-serif', color: 'var(--accent)', letterSpacing: '-0.02em', minWidth: '120px' }}>
          {months} month{months !== 1 ? 's' : ''}
        </span>
        <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto' }}>
          {[1, 3, 6, 12].map(m => (
            <button key={m} onClick={() => setMonths(m)} style={{
              padding: '3px 10px', borderRadius: '4px', fontSize: '11px', ...MONO,
              border: `0.5px solid ${months === m ? 'var(--accent)' : 'var(--border)'}`,
              background: months === m ? 'rgba(var(--accent-rgb, 56,189,248), 0.1)' : 'transparent',
              color: months === m ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer',
            }}>{m}mo</button>
          ))}
        </div>
      </div>

      {/* VaR headline + currency cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '210px 1fr', gap: '16px', alignItems: 'start' }}>

        {/* Total VaR metric */}
        <div style={{
          background: 'var(--red-dim)', border: '0.5px solid rgba(239,68,68,0.3)',
          borderRadius: '12px', padding: '20px',
        }}>
          <div style={{ ...LABEL, marginBottom: '6px' }}>Portfolio FX VaR</div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', ...MONO, marginBottom: '10px' }}>
            95% CI · {months}mo · normal dist.
          </div>
          <div style={{ fontSize: '32px', fontWeight: 600, fontFamily: 'Syne, sans-serif', color: 'var(--red)', letterSpacing: '-0.02em' }}>
            {formatUSD(totalVaR)}
          </div>
          <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '0.5px solid rgba(239,68,68,0.2)' }}>
            <div style={{ ...LABEL, marginBottom: '3px' }}>Total FX exposure</div>
            <div style={{ fontSize: '13px', ...MONO, color: 'var(--text-secondary)' }}>{formatUSD(totalExposure)}</div>
          </div>
          <div style={{ marginTop: '8px' }}>
            <div style={{ ...LABEL, marginBottom: '3px' }}>As % of exposure</div>
            <div style={{ fontSize: '13px', ...MONO, color: totalExposure > 0 ? 'var(--red)' : 'var(--text-muted)' }}>
              {totalExposure > 0 ? `${((totalVaR / totalExposure) * 100).toFixed(1)}%` : '—'}
            </div>
          </div>
        </div>

        {/* Per-currency volatility cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px' }}>
          {results.map(r => (
            <div key={r.c} style={{
              background: 'var(--bg-card)', border: '0.5px solid var(--border)',
              borderRadius: '10px', padding: '14px 16px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '12px' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, ...MONO, color: COLORS[r.c] }}>{r.c}</span>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', ...MONO }}>{NAMES[r.c]}</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
                <div>
                  <div style={LABEL}>{months}mo volatility</div>
                  <div style={{ fontSize: '20px', fontWeight: 600, fontFamily: 'Syne, sans-serif', color: 'var(--text-primary)', letterSpacing: '-0.02em', marginTop: '2px' }}>
                    {r.hasData ? `${r.xMonthVol.toFixed(1)}%` : '—'}
                  </div>
                </div>

                <div style={{ height: '0.5px', background: 'var(--border)' }} />

                <div>
                  <div style={LABEL}>95% worst depreciation</div>
                  <div style={{ fontSize: '13px', ...MONO, color: r.worstDepPct > 20 ? 'var(--red)' : r.worstDepPct > 10 ? 'var(--amber)' : 'var(--text-secondary)', marginTop: '2px' }}>
                    {r.hasData ? `−${r.worstDepPct.toFixed(1)}%` : '—'}
                  </div>
                </div>

                <div>
                  <div style={LABEL}>VaR ({months}mo)</div>
                  <div style={{ fontSize: '13px', ...MONO, color: r.varUSD > 0 ? 'var(--amber)' : 'var(--text-muted)', marginTop: '2px' }}>
                    {r.varUSD > 0 ? formatUSD(r.varUSD) : r.exposure === 0 ? 'no exposure' : '—'}
                  </div>
                </div>

                <div>
                  <div style={LABEL}>Exposure</div>
                  <div style={{ fontSize: '11px', ...MONO, color: 'var(--text-muted)', marginTop: '2px' }}>
                    {r.exposure > 0 ? formatUSD(r.exposure) : '—'}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
