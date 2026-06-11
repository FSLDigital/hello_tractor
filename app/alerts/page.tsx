import { loadData, getAlerts, buildAlertContext } from '@/lib/data'
import { PageHeader, Card, CardTitle } from '@/components/ui'
import AlertsConfig from '@/components/AlertsConfig'
import AlertsLog from '@/components/AlertsLog'
import FootnotesPanel, { ALERTS_METRICS } from '@/components/FootnotesPanel'

export default function AlertsPage() {
  const data = loadData()
  const alerts = getAlerts(data)
  const contexts = alerts.map(a => buildAlertContext(a, data))

  return (
    <div style={{ padding: '32px 36px', maxWidth: '1400px' }}>
      <PageHeader title="Alert Configuration" subtitle="Set thresholds, configure recipients, and manage live risk alerts" />

      <Card style={{ marginBottom: '16px' }}>
        <CardTitle>Active alerts — {alerts.length} triggered · click any row for AI analysis</CardTitle>
        <AlertsLog alerts={alerts} contexts={contexts} />
      </Card>

      <Card>
        <CardTitle>Alert rule builder</CardTitle>
        <AlertsConfig />
      </Card>

      <FootnotesPanel metrics={ALERTS_METRICS} />
    </div>
  )
}
