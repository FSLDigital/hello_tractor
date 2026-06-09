'use client'
import { useState, useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

interface Baseline {
  repaymentRate: number
  totalOwed: number
  totalPaid: number
  byCountry: { country: string; owed: number; paid: number; tractorCount: number; repaymentRate: number }[]
  politicalRisk: { country: string; score: number; tier: string }[]
  activeRepayments: number
}

const PRESETS = [
  { label: 'Drought year',         fx: 0,   weather: -40, crop: -15, political: 0,  brent: 20  },
  { label: 'NGN crisis',           fx: -20, weather: 0,   crop: 0,   political: 5,  brent: 0   },
  { label: 'Ethiopia escalation',  fx: -10, weather: -20, crop: -10, political: 15, brent: 0   },
  { label: 'Combined stress',      fx: -20, weather: -35, crop: -20, political: 10, brent: 30  },
]

export default function ScenarioModeller({ baseline }: { baseline: Baseline }) {
  const [country, setCountry]       = useState('All countries')
  const [fxShock, setFxShock]       = useState(0)
  const [weatherShock, setWeather]  = useState(0)
  const [cropShock, setCrop]        = useState(0)
  const [polShock, setPol]          = useState(0)
  const [brentShock, setBrent]      = useState(0)

  const countries = ['All countries', ...baseline.byCountry.map(c => c.country)]

  const results = useMemo(() => {
    const weatherFactor = 1 + (weatherShock / 100) * 0.6
    const cropFactor    = 1 + (cropShock   / 100) * 0.4
    const fxFactor      = 1 + (fxShock     / 100) * 0.5
    const polFactor     = 1 - Math.max(0, polShock  / 100) * 0.3
    const brentFactor   = 1 - (brentShock  / 100) * 0.2
    const combinedFactor = weatherFactor * cropFactor * fxFactor * polFactor * brentFactor

    const targetCountries  = country === 'All countries' ? baseline.byCountry : baseline.byCountry.filter(c => c.country === country)
    const stressedCountries = targetCountries.map(c => ({
      ...c,
      stressedPaid: c.paid * Math.max(0.1, combinedFactor),
      stressedRate: Math.max(0, Math.min(100, c.repaymentRate * Math.max(0.1, combinedFactor))),
    }))

    const totalBaseline = targetCountries.reduce((s, c) => s + c.owed, 0)
    const totalStressed = stressedCountries.reduce((s, c) => s + c.stressedPaid, 0)
    const baselineRate  = targetCountries.reduce((s, c) => s + c.repaymentRate, 0) / Math.max(1, targetCountries.length)
    const stressedRate  = stressedCountries.reduce((s, c) => s + c.stressedRate, 0) / Math.max(1, stressedCountries.length)
    const revenueAtRisk = totalBaseline - totalStressed
    const nplImpact     = stressedRate < 70 ? (70 - stressedRate) * 0.15 : 0

    return { stressedCountries, baselineRate, stressedRate, revenueAtRisk, nplImpact, combinedFactor, totalBaseline, totalStressed }
  }, [country, fxShock, weatherShock, cropShock, polShock, brentShock, baseline])

  const chartData = results.stressedCountries.map(c => ({
    country:  c.country.slice(0, 3),
    baseline: Math.round(c.repaymentRate * 10) / 10,
    stressed: Math.round(c.stressedRate  * 10) / 10,
  }))

  const sliderStyle = { width: '100%', accentColor: 'var(--accent)' }
  const labelStyle  = { fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }
  const valueStyle  = { fontSize: '16px', fontFamily: 'DM Mono, monospace', fontWeight: 500 }

  const SLIDERS = [
    { label: 'FX depreciation (%)',      val: fxShock,     set: setFxShock,  color: '#ef4444', unit: '%'  },
    { label: 'Precipitation change (%)', val: weatherShock, set: setWeather, color: '#3b82f6', unit: '%'  },
    { label: 'Crop price change (%)',    val: cropShock,    set: setCrop,     color: '#10b981', unit: '%'  },
    { label: 'Political risk shift',     val: polShock,     set: setPol,      color: '#8b5cf6', unit: ' pts' },
    { label: 'Brent oil price (%)',      val: brentShock,   set: setBrent,    color: '#f97316', unit: '%'  },
  ]

  const reset = () => { setFxShock(0); setWeather(0); setCrop(0); setPol(0); setBrent(0) }

  return (
    <div>
      {/* Presets */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', flexWrap: 'wrap' }}>
        {PRESETS.map(p => (
          <button key={p.label}
            onClick={() => { setFxShock(p.fx); setWeather(p.weather); setCrop(p.crop); setPol(p.political); setBrent(p.brent) }}
            style={{ padding: '6px 14px', borderRadius: '6px', border: '0.5px solid var(--border-accent)', background: 'var(--bg-raised)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '12px', fontFamily: 'DM Mono, monospace' }}>
            {p.label}
          </button>
        ))}
        <button onClick={reset}
          style={{ padding: '6px 14px', borderRadius: '6px', border: '0.5px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '12px', fontFamily: 'DM Mono, monospace' }}>
          Reset
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: '28px' }}>
        {/* Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
          <div>
            <p style={labelStyle}>Country scope</p>
            <select value={country} onChange={e => setCountry(e.target.value)}
              style={{ width: '100%', marginTop: '6px', padding: '8px 10px', background: 'var(--bg-raised)', border: '0.5px solid var(--border-accent)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', fontFamily: 'DM Mono, monospace' }}>
              {countries.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>

          {SLIDERS.map(s => (
            <div key={s.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
                <p style={labelStyle}>{s.label}</p>
                <span style={{ ...valueStyle, color: s.val !== 0 ? s.color : 'var(--text-secondary)', fontSize: '15px' }}>
                  {s.val > 0 ? '+' : ''}{s.val}{s.unit}
                </span>
              </div>
              <input type="range" min={-100} max={100} value={s.val} step={1}
                onChange={e => s.set(Number(e.target.value))} style={sliderStyle} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', marginTop: '2px' }}>
                <span>-100{s.unit === ' pts' ? '' : '%'}</span>
                <span>0</span>
                <span>+100{s.unit === ' pts' ? '' : '%'}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Results */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
            {[
              { label: 'Baseline repayment rate', value: `${results.baselineRate.toFixed(1)}%`,                       color: 'var(--text-primary)' },
              { label: 'Stressed repayment rate', value: `${results.stressedRate.toFixed(1)}%`,                       color: results.stressedRate < results.baselineRate ? 'var(--red)' : 'var(--green)' },
              { label: 'Revenue at risk',          value: `$${(results.revenueAtRisk / 1000).toFixed(0)}k`,            color: results.revenueAtRisk > 0 ? 'var(--amber)' : 'var(--green)' },
            ].map(m => (
              <div key={m.label} style={{ padding: '14px', background: 'var(--bg-raised)', borderRadius: '8px', border: '0.5px solid var(--border)' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>{m.label}</div>
                <div style={{ fontSize: '20px', fontWeight: 600, fontFamily: 'Syne, sans-serif', color: m.color }}>{m.value}</div>
              </div>
            ))}
          </div>

          <div style={{ background: 'var(--bg-raised)', borderRadius: '8px', border: '0.5px solid var(--border)', padding: '14px' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>Repayment rate: baseline vs stressed by country</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="country" tick={{ fontSize: 11, fill: '#7a8a9e', fontFamily: 'DM Mono, monospace' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#7a8a9e', fontFamily: 'DM Mono, monospace' }} tickLine={false} axisLine={false} domain={[0, 100]} tickFormatter={v => `${v}%`} width={38} />
                <Tooltip contentStyle={{ background: '#1a2434', border: '0.5px solid rgba(255,255,255,0.12)', borderRadius: '8px', fontSize: '12px' }} formatter={(v: any, n: any) => [`${Number(v).toFixed(1)}%`, n]} />
                <Bar dataKey="baseline" fill="#3b82f6" radius={[2, 2, 0, 0]} name="Baseline" />
                <Bar dataKey="stressed" fill="#ef4444" radius={[2, 2, 0, 0]} name="Stressed" fillOpacity={0.85} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ padding: '14px', background: results.revenueAtRisk > 100000 ? 'var(--red-dim)' : 'var(--bg-raised)', borderRadius: '8px', border: `0.5px solid ${results.revenueAtRisk > 100000 ? 'rgba(239,68,68,0.3)' : 'var(--border)'}` }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Scenario summary</div>
            <p style={{ fontSize: '13px', lineHeight: 1.7 }}>
              Combined shock factor: <strong style={{ fontFamily: 'DM Mono, monospace', color: 'var(--amber)' }}>{(results.combinedFactor * 100).toFixed(1)}%</strong> of baseline collections.
              {results.revenueAtRisk > 0 ? ' Estimated revenue at risk: ' : ' No revenue reduction estimated. '}
              {results.revenueAtRisk > 0 && <strong style={{ fontFamily: 'DM Mono, monospace', color: 'var(--red)' }}>${(results.revenueAtRisk / 1000).toFixed(0)}k</strong>}
              {results.revenueAtRisk > 0 ? '. Consider triggering liquidity review.' : ''}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
