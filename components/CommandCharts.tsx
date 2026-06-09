'use client'
import React from 'react'
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
    // Compute highlight: % utilisation for the visible period
    const totalCovenant = data.reduce((s: number, d: any) => s + (d.covenant || 0), 0)
    const totalWorked = data.reduce((s: number, d: any) => s + (d.worked || 0), 0)
    const utilisationPct = totalCovenant > 0 ? ((totalWorked / totalCovenant) * 100).toFixed(1) : '—'
    const utilisationColor = parseFloat(utilisationPct) >= 80 ? 'var(--green)' : parseFloat(utilisationPct) >= 50 ? 'var(--amber)' : 'var(--red)'

    return (
      <div>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
          <HighlightMetric
            label="% Utilisation"
            value={utilisationPct === '—' ? '—' : `${utilisationPct}%`}
            color={utilisationPct !== '—' ? utilisationColor : undefined}
          />
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="20%" barGap={2}>
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

  if (type === 'collections-trend') {
    // Compute highlight metrics across the 12-month window
    const totalWorked = data.reduce((s: number, d: any) => s + (d.worked || 0), 0)
    const totalPaid = data.reduce((s: number, d: any) => s + (d.paid || 0), 0)
    const totalOwed = data.reduce((s: number, d: any) => s + (d.owed || 0), 0)
    const impliedPerHa = totalWorked > 0 ? (totalPaid / totalWorked).toFixed(2) : '—'
    const repaymentRate = totalOwed > 0 ? ((totalPaid / totalOwed) * 100).toFixed(1) : '—'
    const rateColor = repaymentRate !== '—' ? (parseFloat(repaymentRate) >= 70 ? 'var(--green)' : parseFloat(repaymentRate) >= 40 ? 'var(--amber)' : 'var(--red)') : undefined

    return (
      <div>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
          <HighlightMetric
            label="Implied $/ha"
            value={impliedPerHa !== '—' ? `$${impliedPerHa}` : '—'}
            color="var(--accent)"
          />
          <HighlightMetric
            label="Repayment Rate"
            value={repaymentRate !== '—' ? `${repaymentRate}%` : '—'}
            color={rateColor}
          />
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={data} margin={{ top: 4, right: 50, left: 0, bottom: 0 }}>
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

  return null
}
