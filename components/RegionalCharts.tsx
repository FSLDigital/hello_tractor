'use client'
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend, ZAxis } from 'recharts'

const POL_COLORS: Record<string, string> = { KE: '#3b82f6', NG: '#ef4444', ET: '#f97316', UG: '#8b5cf6', RW: '#10b981' }
const COUNTRY_COLORS: Record<string, string> = { KE: '#3b82f6', NG: '#ef4444', ET: '#f97316', UG: '#8b5cf6', RW: '#10b981' }

function formatUSD(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}k`
  return `$${v.toFixed(0)}`
}

export default function RegionalCharts({ type, data, visibleCodes }: {
  type: string
  data: any[]
  visibleCodes?: string[]
}) {
  const CODES = visibleCodes || ['ET', 'NG', 'KE', 'UG', 'RW']

  if (type === 'bubble') {
    return (
      <ResponsiveContainer width="100%" height={260}>
        <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="political" name="Political Risk" type="number" domain={[20, 80]} tick={{ fontSize: 10, fill: '#7a8a9e', fontFamily: 'DM Mono, monospace' }} tickLine={false} axisLine={false} label={{ value: 'Political Risk Score', position: 'insideBottom', offset: -10, style: { fontSize: 10, fill: '#7a8a9e', fontFamily: 'DM Mono, monospace' } }} />
          <YAxis dataKey="drought" name="Drought Risk" type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: '#7a8a9e', fontFamily: 'DM Mono, monospace' }} tickLine={false} axisLine={false} width={30} label={{ value: 'Drought', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#7a8a9e', fontFamily: 'DM Mono, monospace' } }} />
          <ZAxis dataKey="size" range={[60, 400]} />
          <Tooltip
            content={({ payload }) => {
              if (!payload?.length) return null
              const d = payload[0]?.payload
              return (
                <div style={{ background: '#1a2434', border: '0.5px solid rgba(255,255,255,0.12)', borderRadius: '8px', padding: '10px 14px', fontSize: '12px' }}>
                  <div style={{ fontWeight: 500, marginBottom: '6px' }}>{d.country} · {d.tier}</div>
                  <div style={{ color: '#7a8a9e', fontFamily: 'DM Mono, monospace' }}>Political Risk: {d.political}</div>
                  <div style={{ color: '#7a8a9e', fontFamily: 'DM Mono, monospace' }}>Drought Risk: {d.drought}</div>
                  <div style={{ color: '#7a8a9e', fontFamily: 'DM Mono, monospace', marginTop: '4px', paddingTop: '4px', borderTop: '0.5px solid rgba(255,255,255,0.08)' }}>
                    Tractors at risk: {(d.tractorsAtRisk ?? d.size).toLocaleString()}
                  </div>
                  <div style={{ color: '#7a8a9e', fontFamily: 'DM Mono, monospace' }}>
                    Total tractors: {(d.totalTractors ?? d.size).toLocaleString()}
                  </div>
                  <div style={{ color: '#f97316', fontFamily: 'DM Mono, monospace' }}>
                    $ Exposure: {formatUSD(d.exposure)}
                  </div>
                </div>
              )
            }}
          />
          {data.map(d => (
            <Scatter key={d.code} name={d.country} data={[d]} fill={POL_COLORS[d.code] || '#666'} fillOpacity={0.8} />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    )
  }

  if (type === 'pol-trend') {
    const tickInterval = Math.max(1, Math.floor(data.length / 6))
    const allScores = data.flatMap(d => CODES.map(c => d[c]).filter((v): v is number => typeof v === 'number'))
    const minScore = allScores.length ? Math.floor(Math.min(...allScores) / 5) * 5 - 5 : 15
    const maxScore = allScores.length ? Math.ceil(Math.max(...allScores) / 5) * 5 + 5 : 85
    return (
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 4, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#7a8a9e', fontFamily: 'DM Mono, monospace' }} tickLine={false} axisLine={false} interval={tickInterval} />
          <YAxis tick={{ fontSize: 10, fill: '#7a8a9e', fontFamily: 'DM Mono, monospace' }} tickLine={false} axisLine={false} domain={[minScore, maxScore]} width={30} />
          <Tooltip contentStyle={{ background: '#1a2434', border: '0.5px solid rgba(255,255,255,0.12)', borderRadius: '8px', fontSize: '12px' }} />
          <Legend wrapperStyle={{ fontSize: '11px', fontFamily: 'DM Mono, monospace', paddingTop: '12px' }} />
          {CODES.map(c => (
            <Line key={c} type="monotone" dataKey={c} stroke={COUNTRY_COLORS[c]} strokeWidth={c === 'ET' ? 2 : 1.5} dot={false} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    )
  }

  if (type === 'weather-trend') {
    const sampled = data.filter((_, i) => i % 2 === 0)
    return (
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={sampled} margin={{ top: 4, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#7a8a9e', fontFamily: 'DM Mono, monospace' }} tickLine={false} axisLine={false} interval={5} />
          <YAxis tick={{ fontSize: 10, fill: '#7a8a9e', fontFamily: 'DM Mono, monospace' }} tickLine={false} axisLine={false} domain={[0, 100]} width={30} />
          <Tooltip contentStyle={{ background: '#1a2434', border: '0.5px solid rgba(255,255,255,0.12)', borderRadius: '8px', fontSize: '12px' }} />
          <Legend wrapperStyle={{ fontSize: '11px', fontFamily: 'DM Mono, monospace', paddingTop: '12px' }} />
          {CODES.map(c => (
            <Line key={c} type="monotone" dataKey={c} stroke={COUNTRY_COLORS[c]} strokeWidth={1.5} dot={false} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    )
  }

  return null
}
