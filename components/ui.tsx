import React from 'react'

export function PageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ marginBottom: '28px' }}>
      <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>{title}</h1>
      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'DM Mono, monospace' }}>{subtitle}</p>
    </div>
  )
}

export function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: 'var(--bg-card)', border: '0.5px solid var(--border)',
      borderRadius: '12px', padding: '20px',
      ...style,
    }}>
      {children}
    </div>
  )
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '14px', fontFamily: 'DM Mono, monospace' }}>
      {children}
    </div>
  )
}

export function KpiCard({ label, value, sub, color, trend }: { label: string; value: string; sub?: string; color?: string; trend?: string }) {
  return (
    <div style={{
      background: 'var(--bg-card)', border: '0.5px solid var(--border)',
      borderRadius: '12px', padding: '16px 18px',
    }}>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>{label}</div>
      <div style={{ fontSize: '24px', fontWeight: 600, fontFamily: 'Syne, sans-serif', color: color || 'var(--text-primary)', letterSpacing: '-0.02em' }}>{value}</div>
      {sub && <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>{sub}</div>}
      {trend && <div style={{ fontSize: '11px', color: trend.startsWith('+') ? 'var(--green)' : 'var(--red)', marginTop: '4px', fontFamily: 'DM Mono, monospace' }}>{trend}</div>}
    </div>
  )
}

export function AlertBadge({ severity }: { severity: 'critical' | 'warning' | 'info' }) {
  const config = {
    critical: { bg: 'var(--red-dim)', color: 'var(--red)', label: 'CRITICAL' },
    warning: { bg: 'var(--amber-dim)', color: 'var(--amber)', label: 'WARNING' },
    info: { bg: 'var(--accent-dim)', color: 'var(--accent)', label: 'INFO' },
  }[severity]
  return (
    <span style={{
      display: 'inline-block', padding: '2px 7px', borderRadius: '4px',
      background: config.bg, color: config.color,
      fontSize: '10px', fontWeight: 500, letterSpacing: '0.05em',
      fontFamily: 'DM Mono, monospace',
    }}>{config.label}</span>
  )
}

export function TierBadge({ tier }: { tier: string }) {
  const t = tier.toLowerCase().replace(' ', '-')
  const colors: Record<string, string> = {
    'stable': 'var(--green)', 'vulnerable': 'var(--amber)',
    'warning': 'var(--coral)', 'critical': 'var(--red)', 'red-watch': '#ff2d55',
  }
  return (
    <span style={{ fontSize: '11px', fontWeight: 500, color: colors[t] || 'var(--text-secondary)', fontFamily: 'DM Mono, monospace' }}>
      {tier}
    </span>
  )
}

export function SectionDivider({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '8px 0 20px' }}>
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'DM Mono, monospace', whiteSpace: 'nowrap' }}>{label}</div>
      <div style={{ flex: 1, height: '0.5px', background: 'var(--border)' }} />
    </div>
  )
}

export function Grid({ cols, children, gap }: { cols?: number; children: React.ReactNode; gap?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols || 2}, 1fr)`, gap: `${gap || 16}px` }}>
      {children}
    </div>
  )
}
