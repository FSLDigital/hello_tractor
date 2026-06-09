'use client'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend, Cell } from 'recharts'

const CROP_COLORS = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#f97316','#14b8a6','#ef4444','#6366f1']

export default function CommodityCharts({ type, data, color }: { type: string; data: any[]; color?: string }) {
  if (type === 'crop-bars') {
    return (
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 20, left: 80, bottom: 0 }}>
          <CartesianGrid horizontal={false} stroke="rgba(255,255,255,0.05)" />
          <XAxis type="number" tick={{ fontSize: 10, fill: '#7a8a9e', fontFamily: 'DM Mono, monospace' }} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="crop" tick={{ fontSize: 11, fill: '#e8edf5', fontFamily: 'DM Sans, sans-serif' }} tickLine={false} axisLine={false} width={80} />
          <Tooltip contentStyle={{ background: '#1a2434', border: '0.5px solid rgba(255,255,255,0.12)', borderRadius: '8px', fontSize: '12px' }} formatter={(v: any) => [v.toLocaleString(), 'Records']} />
          <Bar dataKey="count" radius={[0, 3, 3, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={CROP_COLORS[i % CROP_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    )
  }

  if (type === 'brent-line') {
    const sampled = data.filter((_, i) => i % 2 === 0)
    return (
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={sampled} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#7a8a9e', fontFamily: 'DM Mono, monospace' }} tickLine={false} axisLine={false} interval={6} />
          <YAxis tick={{ fontSize: 10, fill: '#7a8a9e', fontFamily: 'DM Mono, monospace' }} tickLine={false} axisLine={false} domain={['auto', 'auto']} width={40} tickFormatter={v => `$${v}`} />
          <Tooltip contentStyle={{ background: '#1a2434', border: '0.5px solid rgba(255,255,255,0.12)', borderRadius: '8px', fontSize: '12px' }} formatter={(v: any) => [`$${Number(v).toFixed(2)}`, 'Brent USD/bbl']} />
          <Line type="monotone" dataKey="price" stroke="#f97316" strokeWidth={2} dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    )
  }

  if (type === 'crop-prices') {
    const TOP_CROPS = ['Wheat', 'Rice', 'Maize']
    return (
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 4, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="year" tick={{ fontSize: 10, fill: '#7a8a9e', fontFamily: 'DM Mono, monospace' }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 10, fill: '#7a8a9e', fontFamily: 'DM Mono, monospace' }} tickLine={false} axisLine={false} width={50} tickFormatter={v => `$${v > 999 ? (v/1000).toFixed(1)+'k' : v}`} />
          <Tooltip contentStyle={{ background: '#1a2434', border: '0.5px solid rgba(255,255,255,0.12)', borderRadius: '8px', fontSize: '12px' }} formatter={(v: any, n: any) => [`$${Number(v).toFixed(2)}`, n]} />
          <Legend wrapperStyle={{ fontSize: '11px', fontFamily: 'DM Mono, monospace', paddingTop: '12px' }} />
          {TOP_CROPS.map((c, i) => (
            <Line key={c} type="monotone" dataKey={c} stroke={CROP_COLORS[i]} strokeWidth={1.5} dot={{ r: 3 }} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    )
  }

  if (type === 'sparkline') {
    return (
      <ResponsiveContainer width="100%" height={50}>
        <LineChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
          <Line type="monotone" dataKey="value" stroke={color || '#3b82f6'} strokeWidth={1.5} dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    )
  }

  return null
}
