import { loadData, getPortfolioStats, getLatestPoliticalRisk } from '@/lib/data'
import { PageHeader, Card, CardTitle } from '@/components/ui'
import ScenarioModeller from '@/components/ScenarioModeller'

export default function ScenarioPage() {
  const data = loadData()
  const stats = getPortfolioStats(data)
  const latestPol = getLatestPoliticalRisk(data)

  const baselineData = {
    repaymentRate: stats.repaymentRate,
    totalOwed: stats.totalOwed,
    totalPaid: stats.totalPaid,
    byCountry: stats.byCountry.map(c => ({
      country: c.country,
      owed: c.owed,
      paid: c.paid,
      tractorCount: c.tractorCount,
      repaymentRate: c.repaymentRate,
    })),
    politicalRisk: latestPol.map(p => ({ country: p.country_name, score: p.score, tier: p.tier })),
    activeRepayments: data.repayments.filter(r => r.status === 'ACTIVE').reduce((s, r) => s + r.repayment_amount_usd, 0),
  }

  return (
    <div style={{ padding: '32px 36px', maxWidth: '1400px' }}>
      <PageHeader title="Scenario Modeller" subtitle="What does a combined shock — weak rainfall + currency depreciation + crop downturn — do to cash flow?" />
      <Card>
        <CardTitle>Configure stress scenario</CardTitle>
        <ScenarioModeller baseline={baselineData} />
      </Card>
    </div>
  )
}
