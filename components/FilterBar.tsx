'use client'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

interface FilterOptions {
  countries: string[]
  regions: string[]
  implements: string[]
  funders: string[]
  crops?: string[]
}

interface Props {
  options: FilterOptions
  current: {
    country: string
    region: string
    implement: string
    funder: string
    crop?: string
  }
}

const selectStyle: React.CSSProperties = {
  background: 'var(--bg-raised)',
  border: '0.5px solid var(--border)',
  borderRadius: '6px',
  color: 'var(--text-primary)',
  fontSize: '11px',
  fontFamily: 'DM Mono, monospace',
  padding: '5px 8px',
  cursor: 'pointer',
  outline: 'none',
  minWidth: '130px',
}

export default function FilterBar({ options, current }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const updateFilter = useCallback((key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value) {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    router.push(`${pathname}?${params.toString()}`)
  }, [router, pathname, searchParams])

  const activeCount = [current.country, current.region, current.implement, current.funder, current.crop ?? ''].filter(Boolean).length

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
      marginBottom: '20px', padding: '10px 14px',
      background: 'var(--bg-card)', border: '0.5px solid var(--border)',
      borderRadius: '10px',
    }}>
      <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: '4px' }}>
        Filters{activeCount > 0 ? ` (${activeCount} active)` : ''}
      </span>

      <select style={selectStyle} value={current.country} onChange={e => updateFilter('country', e.target.value)}>
        <option value="">All countries</option>
        {options.countries.map(c => <option key={c} value={c}>{c}</option>)}
      </select>

      <select style={selectStyle} value={current.region} onChange={e => updateFilter('region', e.target.value)}>
        <option value="">All regions</option>
        {options.regions.map(r => <option key={r} value={r}>{r}</option>)}
      </select>

      <select style={selectStyle} value={current.implement} onChange={e => updateFilter('implement', e.target.value)}>
        <option value="">All implements</option>
        {options.implements.map(i => <option key={i} value={i}>{i}</option>)}
      </select>

      <select style={selectStyle} value={current.funder} onChange={e => updateFilter('funder', e.target.value)}>
        <option value="">All funders</option>
        {options.funders.map(t => <option key={t} value={t}>{t}</option>)}
      </select>

      {options.crops && options.crops.length > 0 && (
        <select style={selectStyle} value={current.crop ?? ''} onChange={e => updateFilter('crop', e.target.value)}>
          <option value="">All crops</option>
          {options.crops.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      )}

      {activeCount > 0 && (
        <button
          onClick={() => router.push(pathname)}
          style={{
            background: 'transparent', border: '0.5px solid var(--border)',
            borderRadius: '6px', color: 'var(--text-muted)', fontSize: '11px',
            fontFamily: 'DM Mono, monospace', padding: '5px 10px', cursor: 'pointer',
          }}
        >
          Clear
        </button>
      )}
    </div>
  )
}
