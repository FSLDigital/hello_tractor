'use client'
import { useState } from 'react'

const METRICS = [
  { id: 'pol_score', label: 'Political risk score', category: 'Political', defaultThreshold: 65, unit: '/100' },
  { id: 'drought', label: 'Drought risk score', category: 'Weather', defaultThreshold: 75, unit: '/100' },
  { id: 'flood', label: 'Flood risk score', category: 'Weather', defaultThreshold: 70, unit: '/100' },
  { id: 'fx_change', label: 'FX monthly change', category: 'FX', defaultThreshold: -10, unit: '%' },
  { id: 'brent_12m', label: 'Brent crude 12m change', category: 'Commodity', defaultThreshold: 40, unit: '%' },
  { id: 'repayment_rate', label: 'Repayment rate drop', category: 'Portfolio', defaultThreshold: 60, unit: '%' },
  { id: 'exposure', label: 'Country exposure', category: 'Portfolio', defaultThreshold: 1000000, unit: 'USD' },
]

interface AlertRule {
  id: string
  metric: string
  operator: string
  threshold: number
  severity: 'critical' | 'warning'
  notify: string[]
  channel: 'email' | 'sms' | 'both'
}

export default function AlertsConfig() {
  const [rules, setRules] = useState<AlertRule[]>([
    { id: '1', metric: 'pol_score', operator: '>', threshold: 65, severity: 'warning', notify: ['irene@hellotractor.com'], channel: 'email' },
    { id: '2', metric: 'pol_score', operator: '>', threshold: 74, severity: 'critical', notify: ['tobe@hellotractor.com', 'irene@hellotractor.com'], channel: 'sms' },
    { id: '3', metric: 'drought', operator: '>', threshold: 75, severity: 'warning', notify: ['irene@hellotractor.com'], channel: 'email' },
  ])
  const [adding, setAdding] = useState(false)
  const [newRule, setNewRule] = useState<Partial<AlertRule>>({ operator: '>', severity: 'warning', channel: 'email', notify: [] })
  const [newEmail, setNewEmail] = useState('')

  const inputStyle = { padding: '7px 10px', background: 'var(--bg-raised)', border: '0.5px solid var(--border-accent)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', fontFamily: 'DM Mono, monospace' }
  const selectStyle = { ...inputStyle, cursor: 'pointer' }

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
        {rules.map(r => {
          const m = METRICS.find(m => m.id === r.metric)
          return (
            <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 100px 80px 1fr 80px 36px', alignItems: 'center', gap: '10px', padding: '12px 14px', borderRadius: '8px', background: 'var(--bg-raised)', border: '0.5px solid var(--border)' }}>
              <span style={{ fontSize: '13px' }}>{m?.label}</span>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '12px', color: 'var(--text-secondary)' }}>{r.operator}</span>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '13px', color: 'var(--amber)' }}>{r.threshold.toLocaleString()}{m?.unit}</span>
              <span style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '4px', background: r.severity === 'critical' ? 'var(--red-dim)' : 'var(--amber-dim)', color: r.severity === 'critical' ? 'var(--red)' : 'var(--amber)', fontFamily: 'DM Mono, monospace' }}>{r.severity}</span>
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {r.notify.map(e => <span key={e} style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: 'var(--bg-card)', border: '0.5px solid var(--border)', fontFamily: 'DM Mono, monospace', color: 'var(--text-secondary)' }}>{e}</span>)}
              </div>
              <span style={{ fontSize: '11px', color: r.channel === 'sms' ? 'var(--green)' : 'var(--accent)', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{r.channel}</span>
              <button onClick={() => setRules(rules.filter(x => x.id !== r.id))}
                style={{ width: '28px', height: '28px', borderRadius: '6px', border: '0.5px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
            </div>
          )
        })}
      </div>

      {!adding ? (
        <button onClick={() => setAdding(true)} style={{ padding: '8px 16px', borderRadius: '6px', border: '0.5px solid var(--border-accent)', background: 'var(--bg-raised)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '13px', fontFamily: 'DM Mono, monospace' }}>
          + Add alert rule
        </button>
      ) : (
        <div style={{ padding: '16px', background: 'var(--bg-raised)', borderRadius: '10px', border: '0.5px solid var(--border-accent)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 120px 100px', gap: '12px', marginBottom: '12px' }}>
            <div>
              <p style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', marginBottom: '6px' }}>Metric</p>
              <select value={newRule.metric || ''} onChange={e => setNewRule({ ...newRule, metric: e.target.value })} style={{ ...selectStyle, width: '100%' }}>
                <option value="">Select metric</option>
                {METRICS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <p style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', marginBottom: '6px' }}>Operator</p>
              <select value={newRule.operator} onChange={e => setNewRule({ ...newRule, operator: e.target.value })} style={{ ...selectStyle, width: '100%' }}>
                <option value=">">{'>'}</option>
                <option value="<">{'<'}</option>
                <option value="change by">change by</option>
              </select>
            </div>
            <div>
              <p style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', marginBottom: '6px' }}>Threshold</p>
              <input type="number" value={newRule.threshold || ''} onChange={e => setNewRule({ ...newRule, threshold: Number(e.target.value) })} style={{ ...inputStyle, width: '100%' }} placeholder="e.g. 65" />
            </div>
            <div>
              <p style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', marginBottom: '6px' }}>Severity</p>
              <select value={newRule.severity} onChange={e => setNewRule({ ...newRule, severity: e.target.value as any })} style={{ ...selectStyle, width: '100%' }}>
                <option value="warning">Warning → email</option>
                <option value="critical">Critical → SMS</option>
              </select>
            </div>
          </div>
          <div style={{ marginBottom: '12px' }}>
            <p style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', marginBottom: '6px' }}>Notify (email)</p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} style={{ ...inputStyle, flex: 1 }} placeholder="email@hellotractor.com" />
              <button onClick={() => { if (newEmail) { setNewRule({ ...newRule, notify: [...(newRule.notify || []), newEmail] }); setNewEmail('') } }} style={{ padding: '7px 14px', borderRadius: '6px', border: '0.5px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--accent)', cursor: 'pointer', fontSize: '12px', fontFamily: 'DM Mono, monospace' }}>Add</button>
            </div>
            <div style={{ display: 'flex', gap: '4px', marginTop: '6px', flexWrap: 'wrap' }}>
              {(newRule.notify || []).map(e => <span key={e} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: 'var(--bg-card)', border: '0.5px solid var(--border)', fontFamily: 'DM Mono, monospace', color: 'var(--text-secondary)' }}>{e}</span>)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => {
              if (newRule.metric && newRule.threshold && newRule.severity) {
                setRules([...rules, { id: Date.now().toString(), metric: newRule.metric!, operator: newRule.operator || '>', threshold: newRule.threshold!, severity: newRule.severity!, notify: newRule.notify || [], channel: newRule.severity === 'critical' ? 'sms' : 'email' }])
                setAdding(false)
                setNewRule({ operator: '>', severity: 'warning', channel: 'email', notify: [] })
              }
            }} style={{ padding: '8px 18px', borderRadius: '6px', border: '0.5px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--accent)', cursor: 'pointer', fontSize: '13px', fontFamily: 'DM Mono, monospace' }}>Save rule</button>
            <button onClick={() => setAdding(false)} style={{ padding: '8px 14px', borderRadius: '6px', border: '0.5px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '13px', fontFamily: 'DM Mono, monospace' }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ marginTop: '24px', padding: '14px', background: 'var(--bg-raised)', borderRadius: '8px', border: '0.5px solid var(--border)' }}>
        <p style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', marginBottom: '6px' }}>HOW ALERTS WORK</p>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          Warning-level alerts trigger an email with a 3-bullet context digest including the metric value, 3-month trend, and risk narrative. Critical alerts additionally send SMS to designated recipients. All alerts are logged here with timestamp and metric value.
        </p>
      </div>
    </div>
  )
}
