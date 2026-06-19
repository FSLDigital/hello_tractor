'use client'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useCallback, useRef, useState, useEffect } from 'react'

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

// Multi-select dropdown for country
function CountryMultiSelect({
  options,
  selected,
  onChange,
}: {
  options: string[]
  selected: string[]
  onChange: (values: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function toggle(country: string) {
    onChange(
      selected.includes(country)
        ? selected.filter(c => c !== country)
        : [...selected, country]
    )
  }

  const label =
    selected.length === 0
      ? 'All countries'
      : selected.length === options.length
      ? 'All countries'
      : selected.length === 1
      ? selected[0]
      : `${selected.length} markets`

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          ...selectStyle,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '6px',
          minWidth: '140px',
          background: selected.length > 0 && selected.length < options.length ? 'rgba(59,130,246,0.08)' : 'var(--bg-raised)',
          border: selected.length > 0 && selected.length < options.length ? '0.5px solid rgba(59,130,246,0.4)' : '0.5px solid var(--border)',
        }}
      >
        <span>{label}</span>
        <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 4px)',
          left: 0,
          zIndex: 100,
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          borderRadius: '8px',
          padding: '6px',
          minWidth: '160px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
        }}>
          {options.map(c => (
            <label
              key={c}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '6px 8px', borderRadius: '5px', cursor: 'pointer',
                fontSize: '12px', color: 'var(--text-primary)',
                background: selected.includes(c) ? 'rgba(59,130,246,0.1)' : 'transparent',
              }}
              onMouseEnter={e => { if (!selected.includes(c)) (e.currentTarget as HTMLElement).style.background = 'var(--bg-raised)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = selected.includes(c) ? 'rgba(59,130,246,0.1)' : 'transparent' }}
            >
              <input
                type="checkbox"
                checked={selected.includes(c)}
                onChange={() => toggle(c)}
                style={{ accentColor: '#3b82f6', width: '13px', height: '13px', cursor: 'pointer' }}
              />
              {c}
            </label>
          ))}
          {selected.length > 0 && (
            <>
              <div style={{ borderTop: '0.5px solid var(--border)', margin: '4px 0' }} />
              <button
                onClick={() => { onChange([]); setOpen(false) }}
                style={{
                  width: '100%', textAlign: 'left', padding: '5px 8px',
                  background: 'transparent', border: 'none',
                  color: 'var(--text-muted)', fontSize: '11px',
                  fontFamily: 'DM Mono, monospace', cursor: 'pointer', borderRadius: '5px',
                }}
              >
                Clear
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
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

  const selectedCountries = current.country
    ? current.country.split(',').map(s => s.trim()).filter(Boolean)
    : []

  function handleCountryChange(values: string[]) {
    updateFilter('country', values.join(','))
  }

  const activeCount = [
    selectedCountries.length > 0 ? current.country : '',
    current.region,
    current.implement,
    current.funder,
    current.crop ?? '',
  ].filter(Boolean).length

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

      <CountryMultiSelect
        options={options.countries}
        selected={selectedCountries}
        onChange={handleCountryChange}
      />

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
          Clear all
        </button>
      )}
    </div>
  )
}
