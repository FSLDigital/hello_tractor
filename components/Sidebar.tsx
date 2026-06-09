'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const nav = [
  { href: '/', label: 'Command Centre', icon: '⬡', sub: 'Portfolio overview' },
  { href: '/fx', label: 'FX & Liabilities', icon: '◈', sub: 'Currency & debt' },
  { href: '/regional', label: 'Regional Risk', icon: '◎', sub: 'Weather & politics' },
  { href: '/commodity', label: 'Commodity', icon: '◇', sub: 'Crops & Brent' },
  { href: '/scenario', label: 'Scenario Modeller', icon: '◻', sub: 'Stress testing' },
  { href: '/alerts', label: 'Alerts', icon: '◉', sub: 'Thresholds & config' },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <aside style={{
      position: 'fixed', left: 0, top: 0, bottom: 0, width: '220px',
      background: 'var(--bg-surface)',
      borderRight: '0.5px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      zIndex: 50,
    }}>
      {/* Logo */}
      <div style={{ padding: '24px 20px 20px', borderBottom: '0.5px solid var(--border)' }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '13px', letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>
          Hello Tractor
        </div>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: '15px', color: 'var(--text-primary)', lineHeight: 1.3 }}>
          Treasury Risk<br />Intelligence Engine
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {nav.map(item => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
          return (
            <Link key={item.href} href={item.href} style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '9px 10px', borderRadius: '8px', textDecoration: 'none',
              background: active ? 'var(--accent-dim)' : 'transparent',
              border: `0.5px solid ${active ? 'rgba(59,130,246,0.25)' : 'transparent'}`,
              transition: 'all 0.15s',
            }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--bg-raised)' }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            >
              <span style={{ fontSize: '16px', color: active ? 'var(--accent)' : 'var(--text-muted)', width: '18px', textAlign: 'center' }}>{item.icon}</span>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 500, color: active ? 'var(--accent)' : 'var(--text-primary)', fontFamily: 'DM Sans, sans-serif' }}>{item.label}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>{item.sub}</div>
              </div>
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div style={{ padding: '14px 20px', borderTop: '0.5px solid var(--border)' }}>
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', lineHeight: 1.8 }}>
          Data: Jan 2022 — May 2026<br />
          5 countries · 21 regions<br />
          3 debt facilities
        </div>
      </div>
    </aside>
  )
}
