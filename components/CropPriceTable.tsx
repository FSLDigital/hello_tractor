'use client'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

interface CropRow { crop: string; fromPrice: number; toPrice: number; change: number; unit: string; fromMonth: string; toMonth: string }
interface BrentRow { fromPrice: number; toPrice: number; change: number; fromMonth: string; toMonth: string }

interface Props {
  rows: CropRow[]
  brent: BrentRow
  cpFrom: string
  cpTo: string
}

const INPUT_STYLE: React.CSSProperties = {
  background: 'var(--bg-raised)', border: '0.5px solid var(--border)', borderRadius: '6px',
  color: 'var(--text-primary)', fontSize: '11px', fontFamily: 'DM Mono, monospace',
  padding: '4px 8px', colorScheme: 'dark' as any, outline: 'none',
}
const MUTED: React.CSSProperties = { fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.05em' }

export default function CropPriceTable({ rows, brent, cpFrom, cpTo }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const setParam = useCallback((key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value); else params.delete(key)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [router, pathname, searchParams])

  const allRows = [
    ...rows,
    {
      crop: 'Brent Crude',
      fromPrice: brent.fromPrice,
      toPrice: brent.toPrice,
      change: brent.change,
      unit: '$/bbl',
      fromMonth: brent.fromMonth,
      toMonth: brent.toMonth,
    },
  ]

  const rangeLabel = `${(cpFrom || rows[0]?.fromMonth || '2022-01')} → ${(cpTo || rows[0]?.toMonth || 'latest')}`

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <span style={MUTED}>Price change period:</span>
        <span style={MUTED}>From</span>
        <input type="month" value={cpFrom} onChange={e => setParam('cpFrom', e.target.value)} style={INPUT_STYLE} />
        <span style={MUTED}>To</span>
        <input type="month" value={cpTo} onChange={e => setParam('cpTo', e.target.value)} style={INPUT_STYLE} />
        {(cpFrom || cpTo) && (
          <button onClick={() => { setParam('cpFrom', ''); setParam('cpTo', '') }}
            style={{ background: 'transparent', border: '0.5px solid var(--border)', borderRadius: '6px', color: 'var(--text-muted)', fontSize: '10px', fontFamily: 'DM Mono, monospace', padding: '4px 8px', cursor: 'pointer' }}>
            ✕ Clear
          </button>
        )}
        <span style={{ ...MUTED, marginLeft: '4px' }}>· {rangeLabel}</span>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
        <thead>
          <tr>
            {['Commodity', 'From price', 'To price', 'Unit', 'From month', 'To month', '% change'].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', fontSize: '10px', fontWeight: 400, borderBottom: '0.5px solid var(--border)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {allRows.map((c, i) => (
            <tr key={c.crop} style={{ borderBottom: i < allRows.length - 1 ? '0.5px solid var(--border)' : 'none' }}>
              <td style={{ padding: '10px', fontWeight: 500 }}>{c.crop}</td>
              <td style={{ padding: '10px', fontFamily: 'DM Mono, monospace', color: 'var(--text-secondary)' }}>{c.fromPrice.toFixed(2)}</td>
              <td style={{ padding: '10px', fontFamily: 'DM Mono, monospace' }}>{c.toPrice.toFixed(2)}</td>
              <td style={{ padding: '10px', fontFamily: 'DM Mono, monospace', color: 'var(--text-secondary)', fontSize: '11px' }}>{c.unit}</td>
              <td style={{ padding: '10px', fontFamily: 'DM Mono, monospace', color: 'var(--text-secondary)', fontSize: '11px' }}>{c.fromMonth}</td>
              <td style={{ padding: '10px', fontFamily: 'DM Mono, monospace', color: 'var(--text-secondary)', fontSize: '11px' }}>{c.toMonth}</td>
              <td style={{ padding: '10px' }}>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '11px', color: c.change > 20 ? 'var(--green)' : c.change < -20 ? 'var(--red)' : 'var(--amber)' }}>
                  {c.change > 0 ? '+' : ''}{c.change.toFixed(1)}%
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
