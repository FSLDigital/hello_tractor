'use client'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

const CURRENCY_MAP: Record<string, string> = { Kenya: 'KES', Nigeria: 'NGN', Ethiopia: 'ETB', Uganda: 'UGX', Rwanda: 'RWF' }

function fmtUSD(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}M`
  if (v >= 1_000) return `$${(v / 1_000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k`
  return `$${Math.round(v).toLocaleString()}`
}

const INPUT_STYLE: React.CSSProperties = {
  background: 'var(--bg-raised)', border: '0.5px solid var(--border)', borderRadius: '6px',
  color: 'var(--text-primary)', fontSize: '11px', fontFamily: 'DM Mono, monospace',
  padding: '4px 8px', colorScheme: 'dark' as any, outline: 'none',
}

interface Row {
  country: string
  owed: number
  paid: number
  tractorCount: number
  repaymentRate: number
}

interface Props {
  rows: Row[]
  bdFrom: string
  bdTo: string
}

export default function BreakdownTable({ rows, bdFrom, bdTo }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const setParam = useCallback((key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [router, pathname, searchParams])

  const periodLabel = bdFrom || bdTo
    ? `${bdFrom ? bdFrom.slice(0, 7) : '—'} to ${bdTo ? bdTo.slice(0, 7) : '—'}`
    : 'all time'

  return (
    <div>
      {/* Date filter controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Collections period:
        </span>
        <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.05em' }}>From</span>
        <input type="month" value={bdFrom} onChange={e => setParam('bdFrom', e.target.value)} style={INPUT_STYLE} />
        <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.05em' }}>To</span>
        <input type="month" value={bdTo} onChange={e => setParam('bdTo', e.target.value)} style={INPUT_STYLE} />
        {(bdFrom || bdTo) && (
          <button
            onClick={() => { setParam('bdFrom', ''); setParam('bdTo', '') }}
            style={{ background: 'transparent', border: '0.5px solid var(--border)', borderRadius: '6px', color: 'var(--text-muted)', fontSize: '10px', fontFamily: 'DM Mono, monospace', padding: '4px 8px', cursor: 'pointer' }}
          >
            ✕ Clear
          </button>
        )}
        <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', marginLeft: '4px' }}>
          · Showing collections for {periodLabel}
        </span>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
        <thead>
          <tr>
            {['Country', 'Currency', 'Covenant Due (USD)', `Collected (USD)${bdFrom || bdTo ? ' *' : ''}`, `Repayment Rate${bdFrom || bdTo ? ' *' : ''}`, 'Active Tractors'].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', fontSize: '10px', fontWeight: 400, borderBottom: '0.5px solid var(--border)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((c, i) => (
            <tr key={c.country} style={{ borderBottom: i < rows.length - 1 ? '0.5px solid var(--border)' : 'none' }}>
              <td style={{ padding: '10px 10px', fontWeight: 500 }}>{c.country}</td>
              <td style={{ padding: '10px 10px', fontFamily: 'DM Mono, monospace', color: 'var(--text-secondary)' }}>{CURRENCY_MAP[c.country] || 'USD'}</td>
              <td style={{ padding: '10px 10px', fontFamily: 'DM Mono, monospace' }}>{fmtUSD(c.owed)}</td>
              <td style={{ padding: '10px 10px', fontFamily: 'DM Mono, monospace', color: 'var(--green)' }}>{fmtUSD(c.paid)}</td>
              <td style={{ padding: '10px 10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ flex: 1, height: '4px', background: 'var(--bg-raised)', borderRadius: '2px', maxWidth: '80px' }}>
                    <div style={{ width: `${Math.min(c.repaymentRate, 100)}%`, height: '100%', background: c.repaymentRate > 70 ? 'var(--green)' : c.repaymentRate > 40 ? 'var(--amber)' : 'var(--red)', borderRadius: '2px' }} />
                  </div>
                  <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '11px', color: 'var(--text-secondary)' }}>{c.repaymentRate.toFixed(1)}%</span>
                </div>
              </td>
              <td style={{ padding: '10px 10px', fontFamily: 'DM Mono, monospace', color: 'var(--text-secondary)' }}>{c.tractorCount.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(bdFrom || bdTo) && (
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', marginTop: '8px', paddingLeft: '4px' }}>
          * Collected and repayment rate reflect the selected period ({periodLabel}). Covenant Due also filters to the same period.
        </div>
      )}
    </div>
  )
}
