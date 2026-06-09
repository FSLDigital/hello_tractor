'use client'
import AlertSummaryModal from '@/components/AlertSummaryModal'
import { AlertBadge } from '@/components/ui'
import type { Alert } from '@/lib/data'
import type { AlertContext } from '@/lib/types'

interface Props {
  alerts: Alert[]
  contexts: AlertContext[]
}

export default function AlertsLog({ alerts, contexts }: Props) {
  if (alerts.length === 0) {
    return <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No alerts currently active.</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {alerts.map((a, i) => (
        <AlertSummaryModal
          key={a.id}
          alert={a}
          context={contexts[i] || {}}
          maxChars={750}
          size="large"
          hideAlertsLink
          renderTrigger={handleClick => (
            <div
              role="button"
              onClick={handleClick}
              style={{
                display: 'grid', gridTemplateColumns: '90px 80px 1fr 80px 110px 60px',
                alignItems: 'center', gap: '12px', padding: '10px 14px',
                borderRadius: '8px', background: 'var(--bg-raised)',
                border: '0.5px solid var(--border)',
                cursor: 'pointer', transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.8')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
            >
              <AlertBadge severity={a.severity} />
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>{a.category}</span>
              <span style={{ fontSize: '13px' }}>{a.message}</span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>{String(a.timestamp).slice(0, 7)}</span>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'DM Mono, monospace' }}>
                {a.metric.toFixed(0)} / {a.threshold}
              </span>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>▸ analyse</span>
            </div>
          )}
        />
      ))}
    </div>
  )
}
