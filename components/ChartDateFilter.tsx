'use client'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

interface Props {
  paramFrom: string
  paramTo: string
  currentFrom: string
  currentTo: string
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-raised)',
  border: '0.5px solid var(--border)',
  borderRadius: '6px',
  color: 'var(--text-primary)',
  fontSize: '11px',
  fontFamily: 'DM Mono, monospace',
  padding: '4px 8px',
  outline: 'none',
  colorScheme: 'dark',
}

export default function ChartDateFilter({ paramFrom, paramTo, currentFrom, currentTo }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const update = useCallback((key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    router.push(`${pathname}?${params.toString()}`)
  }, [router, pathname, searchParams])

  const clearBoth = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete(paramFrom)
    params.delete(paramTo)
    router.push(`${pathname}?${params.toString()}`)
  }, [router, pathname, searchParams, paramFrom, paramTo])

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
      <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.05em' }}>From</span>
      <input
        type="month"
        style={inputStyle}
        value={currentFrom}
        onChange={e => update(paramFrom, e.target.value)}
      />
      <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.05em' }}>To</span>
      <input
        type="month"
        style={inputStyle}
        value={currentTo}
        onChange={e => update(paramTo, e.target.value)}
      />
      {(currentFrom || currentTo) && (
        <button
          onClick={clearBoth}
          style={{
            background: 'transparent', border: '0.5px solid var(--border)',
            borderRadius: '6px', color: 'var(--text-muted)', fontSize: '10px',
            fontFamily: 'DM Mono, monospace', padding: '4px 8px', cursor: 'pointer',
          }}
        >✕</button>
      )}
    </div>
  )
}
