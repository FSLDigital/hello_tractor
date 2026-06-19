'use client'
import { useState, useMemo } from 'react'
import RegionalCharts from './RegionalCharts'

const ALL_CODES = ['ET', 'NG', 'KE', 'UG', 'RW']
const CODE_LABELS: Record<string, string> = { ET: 'Ethiopia', NG: 'Nigeria', KE: 'Kenya', UG: 'Uganda', RW: 'Rwanda' }
const COLORS: Record<string, string> = { KE: '#3b82f6', NG: '#ef4444', ET: '#f97316', UG: '#8b5cf6', RW: '#10b981' }

const INPUT_STYLE: React.CSSProperties = {
  background: 'var(--bg-raised)', border: '0.5px solid var(--border)', borderRadius: '6px',
  color: 'var(--text-primary)', fontSize: '11px', fontFamily: 'DM Mono, monospace',
  padding: '4px 8px', colorScheme: 'dark' as any, outline: 'none',
}

export default function RegionalTrendCard({ type, data }: { type: string; data: any[] }) {
  const [visible, setVisible] = useState<string[]>(ALL_CODES)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const toggle = (code: string) => {
    setVisible(prev =>
      prev.includes(code)
        ? prev.length > 1 ? prev.filter(c => c !== code) : prev
        : [...prev, code]
    )
  }

  const filtered = useMemo(() =>
    data.filter(d => (!from || d.date >= from) && (!to || d.date <= to)),
    [data, from, to]
  )

  const showDateFilter = type === 'pol-trend' || type === 'weather-trend'

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
        {ALL_CODES.map(code => {
          const active = visible.includes(code)
          return (
            <button
              key={code}
              onClick={() => toggle(code)}
              style={{
                padding: '3px 10px',
                borderRadius: '4px',
                border: `0.5px solid ${active ? COLORS[code] : 'var(--border)'}`,
                background: active ? `${COLORS[code]}22` : 'transparent',
                color: active ? COLORS[code] : 'var(--text-muted)',
                fontSize: '11px',
                fontFamily: 'DM Mono, monospace',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {CODE_LABELS[code]}
            </button>
          )
        })}

        {showDateFilter && (
          <>
            <div style={{ width: '0.5px', height: '16px', background: 'var(--border)', margin: '0 2px' }} />
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.05em' }}>From</span>
            <input type="month" value={from} onChange={e => setFrom(e.target.value)} style={INPUT_STYLE} />
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.05em' }}>To</span>
            <input type="month" value={to} onChange={e => setTo(e.target.value)} style={INPUT_STYLE} />
            {(from || to) && (
              <button
                onClick={() => { setFrom(''); setTo('') }}
                style={{ background: 'transparent', border: '0.5px solid var(--border)', borderRadius: '6px', color: 'var(--text-muted)', fontSize: '10px', fontFamily: 'DM Mono, monospace', padding: '4px 8px', cursor: 'pointer' }}
              >✕</button>
            )}
          </>
        )}
      </div>
      <RegionalCharts type={type} data={filtered} visibleCodes={visible} />
    </>
  )
}
