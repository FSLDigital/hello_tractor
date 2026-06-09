'use client'
import React, { useState, useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from 'recharts'

const CURRENCIES = ['KES', 'NGN', 'ETB', 'UGX', 'RWF']
const CURRENCY_NAMES: Record<string, string> = { KES: 'Kenya', NGN: 'Nigeria', ETB: 'Ethiopia', UGX: 'Uganda', RWF: 'Rwanda' }
const COLORS: Record<string, string> = { KES: '#3b82f6', NGN: '#ef4444', ETB: '#f59e0b', UGX: '#8b5cf6', RWF: '#10b981' }
const TOOLTIP_STYLE = { background: '#1a2434', border: '0.5px solid rgba(255,255,255,0.12)', borderRadius: '8px', fontSize: '12px' }
const TICK_STYLE = { fontSize: 10, fill: '#7a8a9e', fontFamily: 'DM Mono, monospace' }
const INPUT_STYLE: React.CSSProperties = {
  background: 'var(--bg-raised)',
  border: '0.5px solid var(--border)',
  borderRadius: '6px',
  color: 'var(--text-primary)',
  fontSize: '11px',
  fontFamily: 'DM Mono, monospace',
  padding: '4px 8px',
  cursor: 'pointer',
}

interface FXChartsProps {
  type: 'indexed-lines' | 'alm-waterfall' | 'alm-historical' | 'alm-forecast' | 'fx-trends-heatmap'
  data: any[]
  minDate?: string
  maxDate?: string
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length
  if (n < 2) return 0
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0)
  const den = Math.sqrt(
    xs.reduce((s, x) => s + (x - mx) ** 2, 0) *
    ys.reduce((s, y) => s + (y - my) ** 2, 0)
  )
  return den === 0 ? 0 : num / den
}

function heatColor(r: number, isDiag: boolean): string {
  if (isDiag) return 'rgba(255,255,255,0.04)'
  if (r >= 0.8) return 'rgba(220,38,38,0.60)'
  if (r >= 0.6) return 'rgba(239,68,68,0.40)'
  if (r >= 0.3) return 'rgba(239,68,68,0.20)'
  if (r >= -0.3) return 'rgba(255,255,255,0.04)'
  if (r >= -0.6) return 'rgba(34,197,94,0.22)'
  return 'rgba(34,197,94,0.45)'
}

function DateRangeControls({ from, to, min, max, onFrom, onTo, onReset }: {
  from: string; to: string; min: string; max: string
  onFrom: (v: string) => void; onTo: (v: string) => void; onReset: () => void
}) {
  return (
    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', justifyContent: 'flex-end', marginBottom: '10px', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>From</span>
      <input type="date" value={from} min={min} max={to || max} onChange={e => onFrom(e.target.value)} style={INPUT_STYLE} />
      <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>To</span>
      <input type="date" value={to} min={from || min} max={max} onChange={e => onTo(e.target.value)} style={INPUT_STYLE} />
      <button onClick={onReset} style={{ ...INPUT_STYLE, color: 'var(--text-muted)', padding: '4px 10px' }}>Reset</button>
    </div>
  )
}

function QuarterRangeControls({ quarters, fromQ, toQ, onFrom, onTo }: {
  quarters: string[]; fromQ: string; toQ: string
  onFrom: (v: string) => void; onTo: (v: string) => void
}) {
  return (
    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', justifyContent: 'flex-end', marginBottom: '10px', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>From</span>
      <select value={fromQ} onChange={e => onFrom(e.target.value)} style={INPUT_STYLE}>
        {quarters.map((q: string) => <option key={q} value={q}>{q}</option>)}
      </select>
      <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>To</span>
      <select value={toQ} onChange={e => onTo(e.target.value)} style={INPUT_STYLE}>
        {quarters.map((q: string) => <option key={q} value={q}>{q}</option>)}
      </select>
      <button onClick={() => { onFrom(quarters[0] || ''); onTo(quarters[quarters.length - 1] || '') }} style={{ ...INPUT_STYLE, color: 'var(--text-muted)', padding: '4px 10px' }}>Reset</button>
    </div>
  )
}

function IndexedLinesChart({ data, minDate, maxDate }: { data: any[]; minDate?: string; maxDate?: string }) {
  const [from, setFrom] = useState<string>(minDate || '')
  const [to, setTo] = useState<string>(maxDate || '')

  const filtered = useMemo(() => {
    let d = data
    if (from) d = d.filter((r: any) => r.date >= from)
    if (to) d = d.filter((r: any) => r.date <= to)
    return d.filter((_: any, i: number) => i % 2 === 0)
  }, [data, from, to])

  return (
    <div>
      <DateRangeControls
        from={from} to={to} min={minDate || ''} max={maxDate || ''}
        onFrom={setFrom} onTo={setTo}
        onReset={() => { setFrom(minDate || ''); setTo(maxDate || '') }}
      />
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={filtered} margin={{ top: 4, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="date" tick={TICK_STYLE} tickLine={false} axisLine={false}
            interval={Math.max(1, Math.floor(filtered.length / 8))}
            tickFormatter={d => String(d).slice(0, 7)} />
          <YAxis tick={TICK_STYLE} tickLine={false} axisLine={false} width={40} />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any, name: any) => [`${Number(v).toFixed(1)}`, name]} />
          <Legend wrapperStyle={{ fontSize: '11px', fontFamily: 'DM Mono, monospace', paddingTop: '12px' }} />
          {CURRENCIES.map(c => (
            <Line key={c} type="monotone" dataKey={c} stroke={COLORS[c]} strokeWidth={1.5} dot={false} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function ALMWaterfallChart({ data }: { data: any[] }) {
  const quarters = useMemo(() => data.map((d: any) => d.q), [data])
  const [fromQ, setFromQ] = useState<string>(() => quarters[0] || '')
  const [toQ, setToQ] = useState<string>(() => quarters[quarters.length - 1] || '')

  const filtered = useMemo(() => {
    const fi = quarters.indexOf(fromQ)
    const ti = quarters.indexOf(toQ)
    if (fi === -1 || ti === -1 || fi > ti) return data
    return data.slice(fi, ti + 1)
  }, [data, fromQ, toQ, quarters])

  return (
    <div>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', justifyContent: 'flex-end', marginBottom: '10px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>From</span>
        <select value={fromQ} onChange={e => setFromQ(e.target.value)} style={INPUT_STYLE}>
          {quarters.map((q: string) => <option key={q} value={q}>{q}</option>)}
        </select>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>To</span>
        <select value={toQ} onChange={e => setToQ(e.target.value)} style={INPUT_STYLE}>
          {quarters.map((q: string) => <option key={q} value={q}>{q}</option>)}
        </select>
        <button onClick={() => { setFromQ(quarters[0] || ''); setToQ(quarters[quarters.length - 1] || '') }} style={{ ...INPUT_STYLE, color: 'var(--text-muted)', padding: '4px 10px' }}>Reset</button>
      </div>
      <div style={{ display: 'flex', gap: '20px', marginBottom: '10px', paddingLeft: '4px' }}>
        {[['#10b981', 'Expected inflows (covenant × repay rate × seasonality)'], ['#ef4444', 'Funding repayments (outflows)']].map(([color, label]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: color }} />
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>{label}</span>
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={filtered} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="25%" barGap={2}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="q" tick={TICK_STYLE} tickLine={false} axisLine={false} />
          <YAxis tick={TICK_STYLE} tickLine={false} axisLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} width={56} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(v: any, name: any) => [`$${Number(v).toLocaleString()}`, name === 'inflows' ? 'Expected inflows' : 'Funding repayments']}
          />
          <Bar dataKey="inflows" name="inflows" fill="#10b981" radius={[3, 3, 0, 0]} />
          <Bar dataKey="outflows" name="outflows" fill="#ef4444" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function ALMHistoricalChart({ data }: { data: any[] }) {
  const quarters = useMemo(() => data.map((d: any) => d.q), [data])
  const [fromQ, setFromQ] = useState<string>(() => quarters[0] || '')
  const [toQ, setToQ] = useState<string>(() => quarters[quarters.length - 1] || '')

  const filtered = useMemo(() => {
    const fi = quarters.indexOf(fromQ)
    const ti = quarters.indexOf(toQ)
    if (fi === -1 || ti === -1 || fi > ti) return data
    return data.slice(fi, ti + 1)
  }, [data, fromQ, toQ, quarters])

  return (
    <div>
      <QuarterRangeControls
        quarters={quarters}
        fromQ={fromQ}
        toQ={toQ}
        onFrom={setFromQ}
        onTo={setToQ}
      />
      <div style={{ display: 'flex', gap: '20px', marginBottom: '10px', paddingLeft: '4px' }}>
        {[['#10b981', 'Actual collections (USD)'], ['#ef4444', 'Funding repayments (USD)']].map(([color, label]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: color }} />
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>{label}</span>
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={filtered} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="25%" barGap={2}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="q" tick={TICK_STYLE} tickLine={false} axisLine={false} />
          <YAxis tick={TICK_STYLE} tickLine={false} axisLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} width={56} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(v: any, name: any) => [`$${Number(v).toLocaleString()}`, name === 'inflows' ? 'Actual collections (USD)' : 'Funding repayments (USD)']}
          />
          <Bar dataKey="inflows" name="inflows" fill="#10b981" radius={[3, 3, 0, 0]} />
          <Bar dataKey="outflows" name="outflows" fill="#ef4444" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function ALMForecastChart({ data }: { data: any[] }) {
  const [repaymentRate, setRepaymentRate] = useState(70)
  const quarters = useMemo(() => data.map((d: any) => d.q), [data])
  const [fromQ, setFromQ] = useState<string>(() => quarters[0] || '')
  const [toQ, setToQ] = useState<string>(() => quarters[quarters.length - 1] || '')

  const filtered = useMemo(() => {
    const fi = quarters.indexOf(fromQ)
    const ti = quarters.indexOf(toQ)
    if (fi === -1 || ti === -1 || fi > ti) return data
    return data.slice(fi, ti + 1)
  }, [data, fromQ, toQ, quarters])

  const chartData = useMemo(() => filtered.map((d: any) => ({
    q: d.q,
    inflows: Math.round(d.baseInflows * repaymentRate / 100),
    outflows: d.outflows,
  })), [filtered, repaymentRate])

  return (
    <div>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, fontFamily: 'DM Mono, monospace', color: 'var(--text-primary)', minWidth: '48px' }}>{repaymentRate}%</span>
        <input
          type="range"
          min={0}
          max={100}
          value={repaymentRate}
          onChange={e => setRepaymentRate(Number(e.target.value))}
          style={{ accentColor: '#8b5cf6', flex: 1, maxWidth: '160px' }}
        />
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>repayment rate</span>
      </div>
      <QuarterRangeControls
        quarters={quarters}
        fromQ={fromQ}
        toQ={toQ}
        onFrom={setFromQ}
        onTo={setToQ}
      />
      <div style={{ display: 'flex', gap: '20px', marginBottom: '10px', paddingLeft: '4px' }}>
        {[['#10b981', 'Projected inflows (covenant × seasonality × rate)'], ['#ef4444', 'Scheduled repayments (USD)']].map(([color, label]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: color }} />
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>{label}</span>
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="25%" barGap={2}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="q" tick={TICK_STYLE} tickLine={false} axisLine={false} />
          <YAxis tick={TICK_STYLE} tickLine={false} axisLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} width={56} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(v: any, name: any) => [`$${Number(v).toLocaleString()}`, name === 'inflows' ? 'Projected inflows (covenant × seasonality × rate)' : 'Scheduled repayments (USD)']}
          />
          <Bar dataKey="inflows" name="inflows" fill="#10b981" radius={[3, 3, 0, 0]} />
          <Bar dataKey="outflows" name="outflows" fill="#ef4444" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function FXTrendsHeatmap({ data }: { data: any[] }) {
  const [from, setFrom] = useState<string>(data[0]?.date || '')
  const [to, setTo] = useState<string>(data[data.length - 1]?.date || '')

  const filteredData = useMemo(() => {
    let d = data
    if (from) d = d.filter((r: any) => r.date >= from)
    if (to) d = d.filter((r: any) => r.date <= to)
    return d
  }, [data, from, to])

  const { corrMatrix, sparkData, latestValues } = useMemo(() => {
    const changes: Record<string, number[]> = {}
    CURRENCIES.forEach(c => { changes[c] = [] })
    for (let i = 1; i < filteredData.length; i++) {
      CURRENCIES.forEach(c => {
        const prev = filteredData[i - 1]?.[c], curr = filteredData[i]?.[c]
        if (prev != null && curr != null && prev !== 0) changes[c].push((curr - prev) / prev)
      })
    }

    const corrMatrix = CURRENCIES.map((c1, i) =>
      CURRENCIES.map((c2, j) => {
        if (i === j) return 1
        const len = Math.min(changes[c1].length, changes[c2].length)
        if (len < 2) return 0
        return pearson(changes[c1].slice(0, len), changes[c2].slice(0, len))
      })
    )

    const sparkData: Record<string, any[]> = {}
    CURRENCIES.forEach(c => {
      sparkData[c] = filteredData.filter((d: any) => d[c] != null)
    })

    const last = filteredData[filteredData.length - 1] || {}
    const first = filteredData[0] || {}
    const latestValues: Record<string, { val: number; totalChange: number }> = {}
    CURRENCIES.forEach(c => {
      const v = last[c] ?? 0
      const f = first[c] ?? 0
      latestValues[c] = { val: v, totalChange: f !== 0 ? ((v - f) / f) * 100 : 0 }
    })

    return { corrMatrix, sparkData, latestValues }
  }, [filteredData])

  const minDate = data[0]?.date || ''
  const maxDate = data[data.length - 1]?.date || ''

  return (
    <div>
      <DateRangeControls
        from={from} to={to} min={minDate} max={maxDate}
        onFrom={setFrom} onTo={setTo}
        onReset={() => { setFrom(minDate); setTo(maxDate) }}
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px', marginBottom: '20px' }}>
        {CURRENCIES.map(c => {
          const { val, totalChange } = latestValues[c]
          return (
            <div key={c} style={{ background: 'var(--bg-raised)', border: '0.5px solid var(--border)', borderRadius: '8px', padding: '10px 12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
                <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 600, fontSize: '13px', color: COLORS[c] }}>{c} / USD</span>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '10px', color: 'var(--text-muted)' }}>{CURRENCY_NAMES[c]}</span>
              </div>
              <ResponsiveContainer width="100%" height={60}>
                <LineChart data={sparkData[c]} margin={{ top: 2, right: 2, left: 0, bottom: 0 }}>
                  <Line type="monotone" dataKey={c} stroke={COLORS[c]} strokeWidth={1.5} dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '6px' }}>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '10px', color: 'var(--text-muted)' }}>idx {val.toFixed(1)} / USD</span>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '11px', fontWeight: 500, color: totalChange >= 0 ? 'var(--red)' : 'var(--green)' }}>
                  {totalChange >= 0 ? '+' : ''}{totalChange.toFixed(1)}%
                </span>
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        FX correlation vs USD (period-over-period changes) — red = co-movement · green = divergence
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '72px repeat(5, 1fr)', gap: '4px' }}>
        <div />
        {CURRENCIES.map(c => (
          <div key={c} style={{ textAlign: 'center', fontSize: '11px', fontFamily: 'DM Mono, monospace', color: COLORS[c], padding: '4px 0', fontWeight: 600 }}>{c} / USD</div>
        ))}
        {CURRENCIES.map((c1, i) => (
          <React.Fragment key={c1}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: '8px', fontSize: '11px', fontFamily: 'DM Mono, monospace', color: COLORS[c1], fontWeight: 600 }}>{c1} / USD</div>
            {CURRENCIES.map((c2, j) => {
              const r = corrMatrix[i][j]
              const isDiag = i === j
              return (
                <div key={c2} title={isDiag ? c1 : `${c1}/USD vs ${c2}/USD: ${Math.round(r * 100)}%`} style={{
                  background: heatColor(r, isDiag),
                  borderRadius: '4px',
                  padding: '8px 4px',
                  textAlign: 'center',
                  fontSize: '10px',
                  fontFamily: 'DM Mono, monospace',
                  color: isDiag ? 'var(--text-muted)' : 'var(--text-primary)',
                  border: '0.5px solid rgba(255,255,255,0.04)',
                  cursor: 'default',
                }}>
                  {isDiag ? '—' : `${Math.round(r * 100)}%`}
                </div>
              )
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

export default function FXCharts({ type, data, minDate, maxDate }: FXChartsProps) {
  if (type === 'indexed-lines') return <IndexedLinesChart data={data} minDate={minDate} maxDate={maxDate} />
  if (type === 'alm-waterfall') return <ALMWaterfallChart data={data} />
  if (type === 'alm-historical') return <ALMHistoricalChart data={data} />
  if (type === 'alm-forecast') return <ALMForecastChart data={data} />
  if (type === 'fx-trends-heatmap') return <FXTrendsHeatmap data={data} />
  return null
}
