'use client'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

const INPUT_STYLE: React.CSSProperties = {
  background: 'var(--bg-raised)',
  border: '0.5px solid var(--border)',
  borderRadius: '6px',
  color: 'var(--text-primary)',
  fontSize: '11px',
  fontFamily: 'DM Mono, monospace',
  padding: '4px 8px',
  cursor: 'pointer',
  colorScheme: 'dark',
}

interface Props { current: string }

export default function FXBaseDatePicker({ current }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const handleChange = useCallback((value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value) {
      params.set('fx_from', value)
    } else {
      params.delete('fx_from')
    }
    router.push(`${pathname}?${params.toString()}`)
  }, [router, pathname, searchParams])

  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>Change from:</span>
      <input
        type="date"
        value={current}
        onChange={e => handleChange(e.target.value)}
        style={INPUT_STYLE}
      />
      {current && (
        <button
          onClick={() => handleChange('')}
          style={{ ...INPUT_STYLE, color: 'var(--text-muted)', padding: '4px 10px' }}
        >
          Reset
        </button>
      )}
    </div>
  )
}
