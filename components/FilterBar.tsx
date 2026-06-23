'use client'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useCallback, useRef, useState, useEffect } from 'react'

export interface FilterOptions {
  countries: string[]
  regions: string[]
  regionLabels: Record<string, string>
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

function MultiSelect({
  placeholder,
  options,
  selected,
  labels,
  onChange,
}: {
  placeholder: string
  options: string[]
  selected: string[]
  labels?: Record<string, string>
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

  const allSelected = selected.length === options.length && options.length > 0
  const someSelected = selected.length > 0 && !allSelected

  function toggle(val: string) {
    onChange(selected.includes(val) ? selected.filter(v => v !== val) : [...selected, val])
  }

  function selectAll() { onChange([...options]) }
  function clearAll() { onChange([]) }

  const label = allSelected
    ? `All ${placeholder.toLowerCase()}`
    : selected.length === 0
    ? `All ${placeholder.toLowerCase()}`
    : selected.length === 1
    ? (labels?.[selected[0]] ?? selected[0])
    : `${selected.length} ${placeholder.toLowerCase()}`

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          ...selectStyle,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px',
          minWidth: '140px',
          background: someSelected ? 'rgba(59,130,246,0.08)' : 'var(--bg-raised)',
          border: someSelected ? '0.5px solid rgba(59,130,246,0.4)' : '0.5px solid var(--border)',
        }}
      >
        <span>{label}</span>
        <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 100,
          background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: '8px',
          padding: '6px', minWidth: '180px', maxHeight: '260px', overflowY: 'auto',
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
        }}>
          {/* Select all / Clear all row */}
          <div style={{ display: 'flex', gap: '4px', padding: '2px 4px 6px', borderBottom: '0.5px solid var(--border)', marginBottom: '4px' }}>
            <button onClick={selectAll} style={{ flex: 1, fontSize: '10px', fontFamily: 'DM Mono, monospace', color: 'var(--accent)', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '2px 4px' }}>
              All
            </button>
            <button onClick={clearAll} style={{ flex: 1, fontSize: '10px', fontFamily: 'DM Mono, monospace', color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '2px 4px' }}>
              None
            </button>
          </div>

          {options.map(opt => (
            <label
              key={opt}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '6px 8px', borderRadius: '5px', cursor: 'pointer',
                fontSize: '12px', color: 'var(--text-primary)',
                background: selected.includes(opt) ? 'rgba(59,130,246,0.1)' : 'transparent',
              }}
              onMouseEnter={e => { if (!selected.includes(opt)) (e.currentTarget as HTMLElement).style.background = 'var(--bg-raised)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = selected.includes(opt) ? 'rgba(59,130,246,0.1)' : 'transparent' }}
            >
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={() => toggle(opt)}
                style={{ accentColor: '#3b82f6', width: '13px', height: '13px', cursor: 'pointer' }}
              />
              {labels?.[opt] ?? opt}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function splitParam(val: string): string[] {
  return val ? val.split(',').map(s => s.trim()).filter(Boolean) : []
}

export default function FilterBar({ options, current }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const updateFilter = useCallback((key: string, values: string[]) => {
    const params = new URLSearchParams(searchParams.toString())
    const joined = values.join(',')
    if (joined) params.set(key, joined); else params.delete(key)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [router, pathname, searchParams])

  const selCountry = splitParam(current.country)
  const selRegion = splitParam(current.region)
  const selImplement = splitParam(current.implement)
  const selFunder = splitParam(current.funder)
  const selCrop = splitParam(current.crop ?? '')

  const activeCount = [selCountry, selRegion, selImplement, selFunder, selCrop]
    .filter(arr => arr.length > 0 && arr.length < (
      arr === selCountry ? options.countries.length
      : arr === selRegion ? options.regions.length
      : arr === selImplement ? options.implements.length
      : arr === selFunder ? options.funders.length
      : (options.crops?.length ?? 0)
    )).length

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
      marginBottom: '20px', padding: '10px 14px',
      background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: '10px',
    }}>
      <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: '4px' }}>
        Filters{activeCount > 0 ? ` (${activeCount} active)` : ''}
      </span>

      <MultiSelect placeholder="Countries" options={options.countries} selected={selCountry} onChange={v => updateFilter('country', v)} />
      <MultiSelect placeholder="Regions" options={options.regions} selected={selRegion} labels={options.regionLabels} onChange={v => updateFilter('region', v)} />
      <MultiSelect placeholder="Implements" options={options.implements} selected={selImplement} onChange={v => updateFilter('implement', v)} />
      <MultiSelect placeholder="Funders" options={options.funders} selected={selFunder} onChange={v => updateFilter('funder', v)} />
      {options.crops && options.crops.length > 0 && (
        <MultiSelect placeholder="Crops" options={options.crops} selected={selCrop} onChange={v => updateFilter('crop', v)} />
      )}

      {activeCount > 0 && (
        <button
          onClick={() => router.replace(pathname, { scroll: false })}
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
