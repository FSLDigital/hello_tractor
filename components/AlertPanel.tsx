'use client'
import { AlertBadge } from '@/components/ui'
import AlertSummaryModal from '@/components/AlertSummaryModal'
import type { Alert } from '@/lib/data'
import type { AlertContext } from '@/lib/types'

export default function AlertPanel({ alert: a, context }: { alert: Alert; context: AlertContext }) {
  return (
    <AlertSummaryModal
      alert={a}
      context={context}
      maxChars={500}
      size="default"
      renderTrigger={handleClick => (
        <div
          role="button"
          onClick={handleClick}
          style={{
            display: 'flex', alignItems: 'center', gap: '12px',
            padding: '10px 14px', borderRadius: '8px', cursor: 'pointer',
            background: a.severity === 'critical' ? 'var(--red-dim)' : 'var(--amber-dim)',
            border: `0.5px solid ${a.severity === 'critical' ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`,
            transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
        >
          <AlertBadge severity={a.severity} />
          <span style={{ fontSize: '13px', flex: 1 }}>{a.message}</span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>{a.category}</span>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>▸ details</span>
        </div>
      )}
    />
  )
}
