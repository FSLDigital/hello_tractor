import { Suspense } from 'react'
import { loadData, getPortfolioStats, getLatestPoliticalRisk, getAlerts, getLatestWeather, getFilterOptions, getUtilisationTrendAll, getCollectionsTrendAll, getCropFilterOptions, buildAlertContext } from '@/lib/data'
import { PageHeader, KpiCard, Card, CardTitle, TierBadge, Grid } from '@/components/ui'
import CommandCharts from '@/components/CommandCharts'
import FilterBar from '@/components/FilterBar'
import AlertPanel from '@/components/AlertPanel'
import FootnotesPanel from '@/components/FootnotesPanel'

function fmtUSD(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}M`
  if (v >= 1_000) return `$${(v / 1_000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k`
  return `$${Math.round(v).toLocaleString()}`
}

const CURRENCY_MAP: Record<string, string> = { Kenya: 'KES', Nigeria: 'NGN', Ethiopia: 'ETB', Uganda: 'UGX', Rwanda: 'RWF' }

export default async function CommandCentre({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams
  const filters = {
    country: sp.country || '',
    region: sp.region || '',
    implement: sp.implement || '',
    funder: sp.funder || '',
    crop: sp.crop || '',
  }

  const data = loadData()
  const baseFilterOptions = getFilterOptions(data)
  const filterOptions = { ...baseFilterOptions, crops: getCropFilterOptions() }

  const hasFilter = Object.values(filters).some(Boolean)
  const stats = getPortfolioStats(data, hasFilter ? filters : undefined)
  const latestPol = getLatestPoliticalRisk(data)
  const alerts = getAlerts(data)
  const latestWeather = getLatestWeather(data)
  const utilisationTrend = getUtilisationTrendAll(data, hasFilter ? filters : undefined)
  const collectionsTrend = getCollectionsTrendAll(data, hasFilter ? filters : undefined)

  const weatherByCountry: Record<string, { drought: number; flood: number }> = {}
  for (const w of latestWeather) {
    const cc = w.region_code.split('-')[0]
    const countryName = { KE: 'Kenya', NG: 'Nigeria', ET: 'Ethiopia', UG: 'Uganda', RW: 'Rwanda' }[cc] || cc
    if (!weatherByCountry[countryName]) weatherByCountry[countryName] = { drought: 0, flood: 0 }
    weatherByCountry[countryName].drought = Math.max(weatherByCountry[countryName].drought, w.drought_risk_score)
    weatherByCountry[countryName].flood = Math.max(weatherByCountry[countryName].flood, w.flood_risk_score)
  }

  const riskMatrix = latestPol.map(p => {
    const w = weatherByCountry[p.country_name] || { drought: 0, flood: 0 }
    const portfolioData = stats.byCountry.find(c => c.country === p.country_name)
    return {
      country: p.country_name,
      political: p.score,
      tier: p.tier,
      economic: p.pillar_economic_fragility,
      lending: p.pillar_lending_risk,
      drought: Math.round(w.drought),
      tractors: portfolioData?.tractorCount || 0,
      exposure: portfolioData?.owed || 0,
    }
  })

  // Weighted average political risk by tractor count
  const totalTractors = riskMatrix.reduce((s, r) => s + r.tractors, 0)
  const weightedPolRisk = totalTractors > 0
    ? riskMatrix.reduce((s, r) => s + r.political * r.tractors, 0) / totalTractors
    : 0
  const highestRiskCountry = riskMatrix.sort((a, b) => b.political - a.political)[0]

  const repaymentNext12 = data.repayments
    .filter(r => r.status === 'ACTIVE')
    .map(r => ({ date: r.repayment_date, amount: r.repayment_amount_usd, facility: r.facility_name }))
    .sort((a, b) => {
      // Parse DD/MM/YYYY for proper sort
      const parse = (d: string) => {
        const p = String(d).split('/')
        return p.length === 3 ? `${p[2]}${p[1].padStart(2,'0')}${p[0].padStart(2,'0')}` : d
      }
      return parse(a.date).localeCompare(parse(b.date))
    })
    .slice(0, 24)

  const countryExposure = stats.byCountry.map(c => ({
    name: c.country, value: Math.round(c.owed / 1000), tractors: c.tractorCount
  }))

  const uniqueFacilities = [...new Map(data.repayments.filter(r => r.status === 'ACTIVE').map(r => [r.facility_id, r])).values()]
  const totalOutstanding = uniqueFacilities.reduce((s, r) => s + (r.outstanding_usd || 0), 0)

  const polRiskColor = weightedPolRisk >= 70 ? 'var(--red)' : weightedPolRisk >= 60 ? 'var(--coral)' : weightedPolRisk >= 50 ? 'var(--amber)' : 'var(--green)'

  return (
    <div style={{ padding: '32px 36px', maxWidth: '1400px' }}>
      <PageHeader title="Portfolio Command Centre" subtitle="Where is capital overexposed right now?" />

      <Suspense fallback={null}>
        <FilterBar options={filterOptions} current={filters} />
      </Suspense>

      {alerts.length > 0 && (
        <div style={{ marginBottom: '28px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {alerts.slice(0, 5).map(a => (
            <AlertPanel key={a.id} alert={a} context={buildAlertContext(a, data)} />
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', marginBottom: '24px' }}>
        <KpiCard label="Total Outstanding Debt" value={`$${(totalOutstanding / 1e6).toFixed(2)}M`} sub="3 active facilities" />
        <KpiCard label="Portfolio Repayment Rate" value={`${stats.repaymentRate.toFixed(1)}%`} sub={`$${(stats.totalPaid / 1e6).toFixed(1)}M paid`} color={stats.repaymentRate > 70 ? 'var(--green)' : 'var(--amber)'} />
        <KpiCard label="Active Tractors" value={stats.byCountry.reduce((s, c) => s + c.tractorCount, 0).toLocaleString()} sub="Across 5 countries" />
        <KpiCard
          label="Wtd Avg Political Risk"
          value={`${weightedPolRisk.toFixed(1)}/100`}
          sub={`${highestRiskCountry?.country || ''} highest at ${highestRiskCountry?.political || 0}`}
          color={polRiskColor}
          trend={weightedPolRisk >= 60 ? '↑ Elevated' : undefined}
        />
      </div>

      <Grid cols={2} gap={16}>
        <Card>
          <CardTitle>Country exposure — amount owed ($k)</CardTitle>
          <CommandCharts type="exposure-donut" data={countryExposure} />
        </Card>
        <Card>
          <CardTitle>Risk matrix — 5 countries</CardTitle>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr>
                  {['Country', 'Score', 'Tier', 'Economic', 'Lending', 'Max Drought', 'Tractors'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', fontSize: '10px', fontWeight: 400, borderBottom: '0.5px solid var(--border)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {riskMatrix.sort((a, b) => b.political - a.political).map((r, i) => (
                  <tr key={r.country} style={{ borderBottom: i < riskMatrix.length - 1 ? '0.5px solid var(--border)' : 'none' }}>
                    <td style={{ padding: '10px 10px', fontWeight: 500 }}>{r.country}</td>
                    <td style={{ padding: '10px 10px', fontFamily: 'DM Mono, monospace' }}>
                      <span style={{ color: r.political >= 70 ? '#ff2d55' : r.political >= 60 ? 'var(--red)' : r.political >= 50 ? 'var(--coral)' : r.political >= 45 ? 'var(--amber)' : 'var(--green)' }}>{r.political}</span>
                    </td>
                    <td style={{ padding: '10px 10px' }}><TierBadge tier={r.tier} /></td>
                    <td style={{ padding: '10px 10px', fontFamily: 'DM Mono, monospace', color: 'var(--text-secondary)' }}>{r.economic}</td>
                    <td style={{ padding: '10px 10px', fontFamily: 'DM Mono, monospace', color: 'var(--text-secondary)' }}>{r.lending}</td>
                    <td style={{ padding: '10px 10px', fontFamily: 'DM Mono, monospace', color: r.drought > 70 ? 'var(--red)' : r.drought > 50 ? 'var(--amber)' : 'var(--text-secondary)' }}>{r.drought}</td>
                    <td style={{ padding: '10px 10px', fontFamily: 'DM Mono, monospace', color: 'var(--text-secondary)' }}>{r.tractors.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </Grid>

      <div style={{ marginTop: '16px' }}>
        <Card>
          <CardTitle>Upcoming debt repayments (active obligations)</CardTitle>
          <CommandCharts type="repayments" data={repaymentNext12} />
        </Card>
      </div>

      <div style={{ marginTop: '16px' }}>
        <Grid cols={2} gap={16}>
          <Card>
            <CardTitle>Utilisation trend — covenant vs worked ha</CardTitle>
            <CommandCharts type="utilisation-trend" data={utilisationTrend} />
          </Card>
          <Card>
            <CardTitle>Collections trend — worked ha vs amount paid</CardTitle>
            <CommandCharts type="collections-trend" data={collectionsTrend} />
          </Card>
        </Grid>
      </div>

      <div style={{ marginTop: '16px' }}>
        <Card>
          <CardTitle>Portfolio breakdown by country (USD)</CardTitle>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr>
                {['Country', 'Currency', 'Expected (USD)', 'Collected (USD)', 'Repayment Rate', 'Active Tractors'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', fontSize: '10px', fontWeight: 400, borderBottom: '0.5px solid var(--border)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.byCountry.map((c, i) => (
                <tr key={c.country} style={{ borderBottom: i < stats.byCountry.length - 1 ? '0.5px solid var(--border)' : 'none' }}>
                  <td style={{ padding: '10px 10px', fontWeight: 500 }}>{c.country}</td>
                  <td style={{ padding: '10px 10px', fontFamily: 'DM Mono, monospace', color: 'var(--text-secondary)' }}>{CURRENCY_MAP[c.country] || 'USD'}</td>
                  <td style={{ padding: '10px 10px', fontFamily: 'DM Mono, monospace' }}>{fmtUSD(c.owed)}</td>
                  <td style={{ padding: '10px 10px', fontFamily: 'DM Mono, monospace', color: 'var(--green)' }}>{fmtUSD(c.paid)}</td>
                  <td style={{ padding: '10px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ flex: 1, height: '4px', background: 'var(--bg-raised)', borderRadius: '2px', maxWidth: '80px' }}>
                        <div style={{ width: `${Math.min(c.repaymentRate, 100)}%`, height: '100%', background: c.repaymentRate > 70 ? 'var(--green)' : c.repaymentRate > 40 ? 'var(--amber)' : 'var(--red)', borderRadius: '2px' }} />
                      </div>
                      <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '11px', color: 'var(--text-secondary)' }}>{c.repaymentRate.toFixed(1)}%</span>
                    </div>
                  </td>
                  <td style={{ padding: '10px 10px', fontFamily: 'DM Mono, monospace', color: 'var(--text-secondary)' }}>{c.tractorCount.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
      <FootnotesPanel />
    </div>
  )
}
