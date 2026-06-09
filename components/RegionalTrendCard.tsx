'use client'
import { useState } from 'react'
import RegionalCharts from './RegionalCharts'

const ALL_CODES = ['ET', 'NG', 'KE', 'UG', 'RW']
const CODE_LABELS: Record<string, string> = { ET: 'Ethiopia', NG: 'Nigeria', KE: 'Kenya', UG: 'Uganda', RW: 'Rwanda' }
const COLORS: Record<string, string> = { KE: '#3b82f6', NG: '#ef4444', ET: '#ff2d55', UG: '#8b5cf6', RW: '#10b981' }

export default function RegionalTrendCard({ type, data }: { type: string; data: any[] }) {
  const [visible, setVisible] = useState<string[]>(ALL_CODES)

  const toggle = (code: string) => {
    setVisible(prev =>
      prev.includes(code)
        ? prev.length > 1 ? prev.filter(c => c !== code) : prev
        : [...prev, code]
    )
  }

  return (
    <>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
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
      </div>
      <RegionalCharts type={type} data={data} visibleCodes={visible} />
    </>
  )
}
