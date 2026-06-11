'use client'
import React, { useState, useMemo } from 'react'
import { PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, ResponsiveContainer, CartesianGrid, Legend, ComposedChart, Line } from 'recharts'

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#f97316']
const TOOLTIP_STYLE: React.CSSProperties = { background: '#1a2434', border: '0.5px solid rgba(255,255,255,0.12)', borderRadius: '8px', padding: '10px 14px', minWidth: '210px' }
const TICK_STYLE = { fontSize: 10, fill: '#7a8a9e', fontFamily: 'DM Mono, monospace' }

function TooltipRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', fontSize: '12px' }}>
      <span style={{ color: color || 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 500 }}>{value}</span>
    </div>
  )
}

function TooltipDivider() {
  return <div style={{ borderTop: '0.5px solid rgba(255,255,255,0.1)', margin: '6px 0' }} />
}

function UtilisationTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const util = d.covenant > 0 ? ((d.worked / d.covenant) * 100).toFixed(1) : null
  const utilColor = util ? (parseFloat(util) >= 80 ? 'var(--green)' : parseFloat(util) >= 50 ? 'var(--amber)' : 'var(--red)') : undefined
  return (
    <div style={TOOLTIP_STYLE}>
      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <TooltipRow label="Booked (ha)" value={Number(d.booked).toLocaleString(undefined, { maximumFractionDigits: 2 })} color="#8b5cf6" />
        <TooltipRow label="Covenant Target (ha)" value={Number(d.covenant).toLocaleString(undefined, { maximumFractionDigits: 2 })} color="#3b82f6" />
        <TooltipRow label="Worked (ha)" value={Number(d.worked).toLocaleString(undefined, { maximumFractionDigits: 2 })} color="#10b981" />
        <TooltipDivider />
        <TooltipRow label="Utilisation" value={util ? `${util}%` : '—'} color={utilColor} />
      </div>
    </div>
  )
}

function CollectionsTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const repaymentRate = d.owed > 0 ? ((d.paid / d.owed) * 100).toFixed(1) : null
  const impliedPerHa = d.worked > 0 ? (d.paid / d.worked).toFixed(2) : null
  const rateColor = repaymentRate ? (parseFloat(repaymentRate) >= 70 ? 'var(--green)' : parseFloat(repaymentRate) >= 40 ? 'var(--amber)' : 'var(--red)') : undefined
  return (
    <div style={TOOLTIP_STYLE}>
      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <TooltipRow label="Amount Paid" value={impliedPerHa !== null ? `$${Number(d.paid).toLocaleString()}` : '—'} color="#f59e0b" />
        <TooltipRow label="Worked" value={`${Number(d.worked).toLocaleString(undefined, { maximumFractionDigits: 2 })} ha`} color="#10b981" />
        <TooltipDivider />
        <TooltipRow label="Repayment Rate" value={repaymentRate ? `${repaymentRate}%` : '—'} color={rateColor} />
        <TooltipRow label="Implied $/ha" value={impliedPerHa ? `$${impliedPerHa}` : '—'} color="var(--accent)" />
      </div>
    </div>
  )
}

const INPUT_STYLE: React.CSSProperties = {
  background: 'var(--bg-raised)', border: '0.5px solid var(--border)', borderRadius: '6px',
  color: 'var(--text-primary)', fontSize: '11px', fontFamily: 'DM Mono, monospace',
  padding: '4px 8px', colorScheme: 'dark' as any, outline: 'none',
}

function MonthRangeControls({ from, to, onFrom, onTo, onClear }: {
  from: string; to: string
  onFrom: (v: string) => void; onTo: (v: string) => void; onClear: () => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.05em' }}>From</span>
      <input type="month" value={from} onChange={e => onFrom(e.target.value)} style={INPUT_STYLE} />
      <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.05em' }}>To</span>
      <input type="month" value={to} onChange={e => onTo(e.target.value)} style={INPUT_STYLE} />
      {(from || to) && (
        <button onClick={onClear} style={{ background: 'transparent', border: '0.5px solid var(--border)', borderRadius: '6px', color: 'var(--text-muted)', fontSize: '10px', fontFamily: 'DM Mono, monospace', padding: '4px 8px', cursor: 'pointer' }}>✕</button>
      )}
    </div>
  )
}

interface Props {
  type: 'exposure-donut' | 'repayments' | 'utilisation-trend' | 'collections-trend'
  data: any[]
}

function HighlightMetric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: '2px',
      background: 'var(--bg-raised)', borderRadius: '8px',
      padding: '8px 12px', minWidth: '100px',
    }}>
      <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <span style={{ fontSize: '18px', fontWeight: 600, fontFamily: 'Syne, sans-serif', color: color || 'var(--text-primary)', letterSpacing: '-0.02em' }}>{value}</span>
    </div>
  )
}

// Parse DD/MM/YYYY or D/M/YYYY → sortable key YYYYMMDD
function parseDMY(d: string): string {
  const parts = d.split('/')
  if (parts.length !== 3) return d
  const [day, month, year] = parts
  return `${year}${month.padStart(2, '0')}${day.padStart(2, '0')}`
}

// Format DD/MM/YYYY → DD/MM/YYYY (normalise padding)
function normaliseDMY(d: string): string {
  const parts = d.split('/')
  if (parts.length !== 3) return d
  const [day, month, year] = parts
  return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`
}

function defaultLast12(data: any[]): { from: string; to: string } {
  const keys = data.map((d: any) => d.key as string).filter(Boolean).sort()
  if (!keys.length) return { from: '', to: '' }
  const to = keys[keys.length - 1]
  const toDate = new Date(to + '-01')
  toDate.setMonth(toDate.getMonth() - 11)
  const from = `${toDate.getFullYear()}-${String(toDate.getMonth() + 1).padStart(2, '0')}`
  return { from, to }
}

function UtilisationTrendChart({ data }: { data: any[] }) {
  const [from, setFrom] = useState(() => defaultLast12(data).from)
  const [to, setTo] = useState(() => defaultLast12(data).to)

  const filtered = useMemo(() =>
    data.filter((d: any) => (!from || d.key >= from) && (!to || d.key <= to)),
    [data, from, to]
  )

  const totalCovenant = filtered.reduce((s: number, d: any) => s + (d.covenant || 0), 0)
  const totalWorked = filtered.reduce((s: number, d: any) => s + (d.worked || 0), 0)
  const utilisationPct = totalCovenant > 0 ? ((totalWorked / totalCovenant) * 100).toFixed(1) : '—'
  const utilisationColor = parseFloat(utilisationPct) >= 80 ? 'var(--green)' : parseFloat(utilisationPct) >= 50 ? 'var(--amber)' : 'var(--red)'

  function handleClear() {
    const d = defaultLast12(data)
    setFrom(d.from)
    setTo(d.to)
  }

  const totalBooked = filtered.reduce((s: number, d: any) => s + (d.booked || 0), 0)

  function fmtHa(v: number) {
    return v >= 1000 ? `${(v / 1000).toFixed(1)}k ha` : `${v.toFixed(0)} ha`
  }

  return (
    <div>
      <MonthRangeControls from={from} to={to} onFrom={setFrom} onTo={setTo} onClear={handleClear} />
      <div style={{ display: 'flex', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <HighlightMetric
          label="% Utilisation"
          value={utilisationPct === '—' ? '—' : `${utilisationPct}%`}
          color={utilisationPct !== '—' ? utilisationColor : undefined}
        />
        <HighlightMetric label="Covenant Target" value={totalCovenant > 0 ? fmtHa(totalCovenant) : '—'} color="var(--text-secondary)" />
        <HighlightMetric label="Booked" value={totalBooked > 0 ? fmtHa(totalBooked) : '—'} color="#8b5cf6" />
        <HighlightMetric label="Worked" value={totalWorked > 0 ? fmtHa(totalWorked) : '—'} color="#10b981" />
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={filtered} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="20%" barGap={2}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="label" tick={TICK_STYLE} tickLine={false} axisLine={false} interval={0} angle={-30} textAnchor="end" height={40} />
          <YAxis tick={TICK_STYLE} tickLine={false} axisLine={false} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`} width={44} />
          <Tooltip content={<UtilisationTooltip />} />
          <Legend wrapperStyle={{ fontSize: '11px', fontFamily: 'DM Mono, monospace', paddingTop: '8px' }} formatter={(v: string) => ({ covenant: 'Covenant', booked: 'Booked', worked: 'Worked ha' }[v] || v)} />
          <Bar dataKey="covenant" fill="#3b82f6" radius={[2, 2, 0, 0]} name="covenant" />
          <Bar dataKey="booked" fill="#8b5cf6" radius={[2, 2, 0, 0]} name="booked" />
          <Bar dataKey="worked" fill="#10b981" radius={[2, 2, 0, 0]} name="worked" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function CollectionsTrendChart({ data }: { data: any[] }) {
  const [from, setFrom] = useState(() => defaultLast12(data).from)
  const [to, setTo] = useState(() => defaultLast12(data).to)

  const filtered = useMemo(() =>
    data.filter((d: any) => (!from || d.key >= from) && (!to || d.key <= to)),
    [data, from, to]
  )

  const totalWorked = filtered.reduce((s: number, d: any) => s + (d.worked || 0), 0)
  const totalPaid = filtered.reduce((s: number, d: any) => s + (d.paid || 0), 0)
  const totalOwed = filtered.reduce((s: number, d: any) => s + (d.owed || 0), 0)
  const impliedPerHa = totalWorked > 0 ? (totalPaid / totalWorked).toFixed(2) : '—'
  const repaymentRate = totalOwed > 0 ? ((totalPaid / totalOwed) * 100).toFixed(1) : '—'
  const rateColor = repaymentRate !== '—' ? (parseFloat(repaymentRate) >= 70 ? 'var(--green)' : parseFloat(repaymentRate) >= 40 ? 'var(--amber)' : 'var(--red)') : undefined

  function handleClear() {
    const d = defaultLast12(data)
    setFrom(d.from)
    setTo(d.to)
  }

  function fmtPaid(v: number) {
    return v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : v >= 1_000 ? `$${(v / 1_000).toFixed(1)}k` : `$${v.toFixed(0)}`
  }
  function fmtHa2(v: number) {
    return v >= 1000 ? `${(v / 1000).toFixed(1)}k ha` : `${v.toFixed(0)} ha`
  }

  return (
    <div>
      <MonthRangeControls from={from} to={to} onFrom={setFrom} onTo={setTo} onClear={handleClear} />
      <div style={{ display: 'flex', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <HighlightMetric label="Implied $/ha" value={impliedPerHa !== '—' ? `$${impliedPerHa}` : '—'} color="var(--accent)" />
        <HighlightMetric label="Repayment Rate" value={repaymentRate !== '—' ? `${repaymentRate}%` : '—'} color={rateColor} />
        <HighlightMetric label="Total Paid" value={totalPaid > 0 ? fmtPaid(totalPaid) : '—'} color="#f59e0b" />
        <HighlightMetric label="Worked" value={totalWorked > 0 ? fmtHa2(totalWorked) : '—'} color="#10b981" />
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={filtered} margin={{ top: 4, right: 50, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="label" tick={TICK_STYLE} tickLine={false} axisLine={false} interval={0} angle={-30} textAnchor="end" height={40} />
          <YAxis yAxisId="left" tick={TICK_STYLE} tickLine={false} axisLine={false} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`} width={44} label={{ value: 'ha', angle: -90, position: 'insideLeft', style: { fontSize: 9, fill: '#7a8a9e' } }} />
          <YAxis yAxisId="right" orientation="right" tick={TICK_STYLE} tickLine={false} axisLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} width={48} />
          <Tooltip content={<CollectionsTooltip />} />
          <Legend wrapperStyle={{ fontSize: '11px', fontFamily: 'DM Mono, monospace', paddingTop: '8px' }} formatter={(v: string) => ({ worked: 'Worked ha', paid: 'Amount Paid' }[v] || v)} />
          <Bar yAxisId="left" dataKey="worked" fill="#10b981" radius={[2, 2, 0, 0]} name="worked" />
          <Line yAxisId="right" type="monotone" dataKey="paid" stroke="#f59e0b" strokeWidth={2} dot={false} name="paid" />
        </ComposedChart>
      </ResponsiveContainer>
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', marginTop: '4px', paddingLeft: '4px' }}>
        Bars = worked ha (left axis) · Line = amount paid (right axis)
      </div>
    </div>
  )
}

export default function CommandCharts({ type, data }: Props) {
  if (type === 'exposure-donut') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
        <ResponsiveContainer width="50%" height={200}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} innerRadius={50} strokeWidth={0}>
              {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(v: any, name: any) => [`$${v}k`, name]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ flex: 1 }}>
          {data.map((d, i) => (
            <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: COLORS[i % COLORS.length], flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '12px', fontWeight: 500 }}>{d.name}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>${d.value.toLocaleString()}k · {d.tractors.toLocaleString()} tractors</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (type === 'repayments') {
    // Group by full date (keep DD/MM/YYYY), sort chronologically
    const grouped: Record<string, number> = {}
    data.forEach((d: any) => {
      const key = String(d.date)
      grouped[key] = (grouped[key] || 0) + d.amount
    })
    const chartData = Object.entries(grouped)
      .sort(([a], [b]) => parseDMY(a).localeCompare(parseDMY(b)))
      .map(([date, amount]) => ({ date: normaliseDMY(date), amount: Math.round(amount) }))

    return (
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 50 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="date" tick={TICK_STYLE} tickLine={false} axisLine={false} angle={-40} textAnchor="end" interval={0} height={60} />
          <YAxis tick={TICK_STYLE} tickLine={false} axisLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} width={52} />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => [`$${Number(v).toLocaleString()}`, 'Due']} />
          <Bar dataKey="amount" fill="#3b82f6" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    )
  }

  if (type === 'utilisation-trend') {
    return <UtilisationTrendChart data={data} />
  }

  if (type === 'collections-trend') {
    return <CollectionsTrendChart data={data} />
  }

  return null
}
