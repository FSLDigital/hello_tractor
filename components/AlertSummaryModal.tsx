'use client'
import { useState } from 'react'
import { AlertBadge } from '@/components/ui'
import type { Alert } from '@/lib/data'
import type { AlertContext } from '@/lib/types'

interface Citation {
  url: string
  title: string
}

interface Props {
  alert: Alert
  context: AlertContext
  maxChars?: number
  /** 'default' = 540px modal (command centre); 'large' = 680px modal (alerts page) */
  size?: 'default' | 'large'
  hideAlertsLink?: boolean
  renderTrigger: (handleClick: () => void) => React.ReactNode
}

export default function AlertSummaryModal({
  alert: a,
  context,
  maxChars = 500,
  size = 'default',
  hideAlertsLink = false,
  renderTrigger,
}: Props) {
  const [open, setOpen] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const [citations, setCitations] = useState<Citation[]>([])
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    setOpen(true)
    if (summary) return
    setLoading(true)
    try {
      const res = await fetch('/api/alert-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alert: a, context, maxChars }),
      })
      const data = await res.json()
      setSummary(data.summary)
      setCitations(data.citations ?? [])
    } catch {
      setSummary('Unable to load summary.')
    }
    setLoading(false)
  }

  const isLarge = size === 'large'

  return (
    <>
      {renderTrigger(handleClick)}

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 50,
            background: 'rgba(0,0,0,0.55)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
              borderRadius: '14px',
              padding: isLarge ? '28px 32px' : '24px 28px',
              maxWidth: isLarge ? '680px' : '540px',
              width: '92%',
              display: 'flex', flexDirection: 'column', gap: '16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <AlertBadge severity={a.severity} />
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>
                {a.category} · {a.country}
              </span>
            </div>

            <div style={{ fontSize: isLarge ? '15px' : '14px', fontWeight: 500, lineHeight: 1.5 }}>
              {a.message}
            </div>

            <div style={{
              background: 'var(--bg-raised)', borderRadius: '8px',
              padding: '14px 16px',
              minHeight: isLarge ? '120px' : '72px',
              display: 'flex', flexDirection: 'column', gap: '12px',
              justifyContent: loading ? 'center' : 'flex-start',
            }}>
              {loading ? (
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  Searching for context…
                </span>
              ) : (
                <>
                  <span style={{
                    fontSize: isLarge ? '13px' : '12px',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.7,
                  }}>
                    {summary}
                  </span>

                  {citations.length > 0 && (
                    <div style={{ borderTop: '0.5px solid var(--border)', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>
                        Sources
                      </span>
                      {citations.map((c, i) => (
                        <a
                          key={i}
                          href={c.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'flex', alignItems: 'baseline', gap: '6px',
                            fontSize: '11px', color: 'var(--accent)',
                            textDecoration: 'none', lineHeight: 1.4,
                          }}
                          onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
                          onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
                        >
                          <span style={{ fontFamily: 'DM Mono, monospace', color: 'var(--text-muted)', flexShrink: 0 }}>{i + 1}.</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
                        </a>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>
                Score {a.metric.toFixed(0)} · Threshold {a.threshold} · {String(a.timestamp).slice(0, 7)}
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                {!hideAlertsLink && (
                  <a href="/alerts" style={{ fontSize: '12px', color: 'var(--accent)', textDecoration: 'none', fontFamily: 'DM Mono, monospace' }}>
                    Review all alerts →
                  </a>
                )}
                <button
                  onClick={() => setOpen(false)}
                  style={{
                    background: 'transparent', border: '0.5px solid var(--border)',
                    borderRadius: '6px', color: 'var(--text-muted)',
                    fontSize: '11px', fontFamily: 'DM Mono, monospace',
                    padding: '4px 10px', cursor: 'pointer',
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
