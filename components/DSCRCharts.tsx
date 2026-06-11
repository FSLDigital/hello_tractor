'use client'
import React, { useState, useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import type { DSCRRow } from '@/lib/types'

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

interface DSCRChartsProps {
  type: 'dscr-llcr' | 'leverage'
  rows: DSCRRow[]
}

function PeriodRangeControls({ periods, from, to, onFrom, onTo }: {
  periods: string[]; from: string; to: string
  onFrom: (v: string) => void; onTo: (v: string) => void
}) {
  return (
    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', justifyContent: 'flex-end', marginBottom: '10px', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>From</span>
      <select value={from} onChange={e => onFrom(e.target.value)} style={INPUT_STYLE}>
        {periods.map(p => <option key={p} value={p}>{p}</option>)}
      </select>
      <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>To</span>
      <select value={to} onChange={e => onTo(e.target.value)} style={INPUT_STYLE}>
        {periods.map(p => <option key={p} value={p}>{p}</option>)}
      </select>
      <button
        onClick={() => { onFrom(periods[0] ?? ''); onTo(periods[periods.length - 1] ?? '') }}
        style={{ ...INPUT_STYLE, color: 'var(--text-muted)', padding: '4px 10px' }}
      >Reset</button>
    </div>
  )
}

function DSCRLLCRChart({ rows }: { rows: DSCRRow[] }) {
  const periods = useMemo(() => rows.map(r => r.period), [rows])
  const [from, setFrom] = useState(periods[0] ?? '')
  const [to, setTo] = useState(periods[periods.length - 1] ?? '')

  const filtered = useMemo(() => {
    const fi = periods.indexOf(from)
    const ti = periods.indexOf(to)
    if (fi === -1 || ti === -1 || fi > ti) return rows
    return rows.slice(fi, ti + 1)
  }, [rows, periods, from, to])

  const chartData = useMemo(() => filtered.map(r => ({
    period: r.period,
    dscr: r.dscr != null ? Math.round(Number(r.dscr) * 100) / 100 : null,
    llcr: r.llcr != null ? Math.round(Number(r.llcr) * 100) / 100 : null,
  })), [filtered])

  return (
    <div>
      <PeriodRangeControls periods={periods} from={from} to={to} onFrom={setFrom} onTo={setTo} />
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={chartData} margin={{ top: 4, right: 36, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="period" tick={TICK_STYLE} tickLine={false} axisLine={false}
            interval={Math.max(1, Math.floor(chartData.length / 8))}
          />
          <YAxis tick={TICK_STYLE} tickLine={false} axisLine={false} width={36}
            tickFormatter={v => `${v}x`}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(v: any) => [`${Number(v).toFixed(2)}x`, 'DSCR']}
            labelStyle={{ color: '#7a8a9e', fontSize: '11px', fontFamily: 'DM Mono, monospace', marginBottom: '4px' }}
          />
          <Legend wrapperStyle={{ fontSize: '11px', fontFamily: 'DM Mono, monospace', paddingTop: '10px' }}
            formatter={() => 'DSCR'}
          />
          <Line type="monotone" dataKey="dscr" stroke="#10b981" strokeWidth={2} dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function LeverageChart({ rows }: { rows: DSCRRow[] }) {
  const periods = useMemo(() => rows.map(r => r.period), [rows])
  const [from, setFrom] = useState(periods[0] ?? '')
  const [to, setTo] = useState(periods[periods.length - 1] ?? '')

  const filtered = useMemo(() => {
    const fi = periods.indexOf(from)
    const ti = periods.indexOf(to)
    if (fi === -1 || ti === -1 || fi > ti) return rows
    return rows.slice(fi, ti + 1)
  }, [rows, periods, from, to])

  const chartData = useMemo(() => filtered.map(r => ({
    period: r.period,
    interest_coverage: r.interest_coverage != null ? Math.round(Number(r.interest_coverage) * 100) / 100 : null,
    debt_to_equity: r.debt_to_equity != null ? Math.round(Number(r.debt_to_equity) * 1000) / 1000 : null,
  })), [filtered])

  return (
    <div>
      <PeriodRangeControls periods={periods} from={from} to={to} onFrom={setFrom} onTo={setTo} />
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={chartData} margin={{ top: 4, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="period" tick={TICK_STYLE} tickLine={false} axisLine={false}
            interval={Math.max(1, Math.floor(chartData.length / 8))}
          />
          <YAxis yAxisId="ic" tick={TICK_STYLE} tickLine={false} axisLine={false} width={36}
            tickFormatter={v => `${v}x`}
          />
          <YAxis yAxisId="de" orientation="right" tick={TICK_STYLE} tickLine={false} axisLine={false} width={36}
            tickFormatter={v => v.toFixed(1)}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(v: any, name: any) => {
              if (name === 'interest_coverage') return [`${Number(v).toFixed(2)}x`, 'Interest Coverage']
              return [Number(v).toFixed(3), 'D/E Ratio']
            }}
            labelStyle={{ color: '#7a8a9e', fontSize: '11px', fontFamily: 'DM Mono, monospace', marginBottom: '4px' }}
          />
          <Legend wrapperStyle={{ fontSize: '11px', fontFamily: 'DM Mono, monospace', paddingTop: '10px' }}
            formatter={(v) => v === 'interest_coverage' ? 'Interest Coverage (left)' : 'D/E Ratio (right)'}
          />
          <Line yAxisId="ic" type="monotone" dataKey="interest_coverage" stroke="#f59e0b" strokeWidth={2} dot={false} connectNulls />
          <Line yAxisId="de" type="monotone" dataKey="debt_to_equity" stroke="#8b5cf6" strokeWidth={2} dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function DSCRCharts({ type, rows }: DSCRChartsProps) {
  if (type === 'dscr-llcr') return <DSCRLLCRChart rows={rows} />
  if (type === 'leverage') return <LeverageChart rows={rows} />
  return null
}
