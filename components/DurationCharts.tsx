'use client'
import React from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, Cell, LabelList,
} from 'recharts'
import type { DurationMetrics, DurationByCountry } from '@/lib/data'

const TICK = { fontSize: 10, fill: '#7a8a9e', fontFamily: 'DM Mono, monospace' }
const TOOLTIP_STYLE: React.CSSProperties = {
  background: '#1a2434', border: '0.5px solid rgba(255,255,255,0.12)',
  borderRadius: '8px', padding: '10px 14px', fontSize: '12px',
}
const COUNTRY_COLORS: Record<string, string> = {
  Kenya: '#3b82f6', Nigeria: '#ef4444', Ethiopia: '#f97316', Uganda: '#8b5cf6', Rwanda: '#10b981',
}
function countryColor(c: string) { return COUNTRY_COLORS[c] || '#7a8a9e' }
function fmtM(v: number) { return v >= 1_000_000 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1_000 ? `$${(v / 1e3).toFixed(0)}k` : `$${Math.round(v)}` }

// ── Duration by country ──────────────────────────────────────────────────────
function DurationByCountryChart({ data }: { data: DurationByCountry[] }) {
  const chartData = [...data].sort((a, b) => b.duration - a.duration)
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 60, left: 60, bottom: 0 }}>
        <CartesianGrid horizontal={false} stroke="rgba(255,255,255,0.05)" />
        <XAxis type="number" tick={TICK} tickLine={false} axisLine={false}
          tickFormatter={v => `${v.toFixed(0)}m`} domain={[0, 'dataMax + 2']} />
        <YAxis type="category" dataKey="country" tick={TICK} tickLine={false} axisLine={false} width={56} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const d = payload[0].payload as DurationByCountry
            return (
              <div style={TOOLTIP_STYLE}>
                <div style={{ fontWeight: 600, marginBottom: '6px', color: countryColor(d.country) }}>{d.country}</div>
                <div style={{ color: '#7a8a9e' }}>Duration: <b style={{ color: '#fff' }}>{d.duration.toFixed(2)} months</b></div>
                <div style={{ color: '#7a8a9e' }}>PV of cashflows: <b style={{ color: '#fff' }}>{fmtM(d.pv)}</b></div>
                <div style={{ color: '#7a8a9e' }}>Agreements: <b style={{ color: '#fff' }}>{d.count}</b></div>
              </div>
            )
          }}
        />
        <Bar dataKey="duration" radius={[0, 4, 4, 0]}>
          {chartData.map(d => <Cell key={d.country} fill={countryColor(d.country)} />)}
          <LabelList dataKey="duration" position="right" style={{ ...TICK, fontSize: 11, fill: '#cbd5e1' }}
            formatter={(v: unknown) => typeof v === 'number' ? `${v.toFixed(1)}m` : ''} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Duration distribution histogram ─────────────────────────────────────────
function DurationHistogram({ data }: { data: { label: string; count: number; pv: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
        <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={false} interval={5} />
        <YAxis tick={TICK} tickLine={false} axisLine={false} width={32}
          label={{ value: '# agreements', angle: -90, position: 'insideLeft', style: { fontSize: 9, fill: '#7a8a9e' } }} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const d = payload[0].payload
            return (
              <div style={TOOLTIP_STYLE}>
                <div style={{ fontWeight: 600, marginBottom: '6px' }}>{d.label}</div>
                <div style={{ color: '#7a8a9e' }}>Agreements: <b style={{ color: '#fff' }}>{d.count}</b></div>
                <div style={{ color: '#7a8a9e' }}>PV: <b style={{ color: '#fff' }}>{fmtM(d.pv)}</b></div>
              </div>
            )
          }}
        />
        <Bar dataKey="count" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Cashflow profile ─────────────────────────────────────────────────────────
function CashflowProfileChart({ data }: { data: { month: number; pv: number }[] }) {
  // Group into quarters for a cleaner chart
  const quarterly: Record<number, number> = {}
  for (const d of data) {
    const q = Math.ceil(d.month / 3)
    quarterly[q] = (quarterly[q] || 0) + d.pv
  }
  const chartData = Object.entries(quarterly)
    .sort(([a], [b]) => parseInt(a) - parseInt(b))
    .map(([q, pv]) => ({ label: `Q${q}`, pv: Math.round(pv) }))

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="cfGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
        <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={false}
          interval={Math.max(0, Math.floor(chartData.length / 10) - 1)} />
        <YAxis tick={TICK} tickLine={false} axisLine={false} width={52}
          tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(v: any) => [`$${Number(v).toLocaleString()}`, 'PV of cashflows']}
        />
        <Area type="monotone" dataKey="pv" stroke="#10b981" strokeWidth={2}
          fill="url(#cfGrad)" dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// ── Main export ──────────────────────────────────────────────────────────────
export default function DurationCharts({
  type, metrics,
}: {
  type: 'by-country' | 'distribution' | 'cashflow-profile'
  metrics: DurationMetrics
}) {
  if (type === 'by-country') return <DurationByCountryChart data={metrics.byCountry} />
  if (type === 'distribution') return <DurationHistogram data={metrics.durationBuckets} />
  if (type === 'cashflow-profile') return <CashflowProfileChart data={metrics.cashflowProfile} />
  return null
}
