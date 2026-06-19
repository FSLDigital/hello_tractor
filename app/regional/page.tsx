import { Suspense } from 'react'
import { loadData, getLatestPoliticalRisk, getLatestWeather, getFilterOptions, getPortfolioStats } from '@/lib/data'
import { PageHeader, KpiCard, Card, CardTitle, Grid } from '@/components/ui'
import RegionalCharts from '@/components/RegionalCharts'
import RegionalTrendCard from '@/components/RegionalTrendCard'
import FilterBar from '@/components/FilterBar'
import FootnotesPanel, { REGIONAL_METRICS } from '@/components/FootnotesPanel'

const COUNTRY_CC: Record<string, string> = { Kenya:'KE', Nigeria:'NG', Ethiopia:'ET', Uganda:'UG', Rwanda:'RW' }
const COUNTRY_FULL: Record<string, string> = { KE:'Kenya', NG:'Nigeria', ET:'Ethiopia', UG:'Uganda', RW:'Rwanda' }

export default async function RegionalPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams
  const filters = {
    country: sp.country || '',
    region: sp.region || '',
    implement: sp.implement || '',
    funder: sp.funder || '',
    crop: sp.crop || '',
  }

  const data = loadData()
  const filterOptions = getFilterOptions(data)
  const latestPol = getLatestPoliticalRisk(data)
  const latestWeather = getLatestWeather(data)

  const portfolioStats = getPortfolioStats(data, filters)
  const tractorsByCountryCode: Record<string, number> = {}
  const exposureByCountryCode: Record<string, number> = {}
  for (const c of portfolioStats.byCountry) {
    const cc = COUNTRY_CC[c.country]
    if (!cc) continue
    tractorsByCountryCode[cc] = c.tractorCount
    exposureByCountryCode[cc] = c.owed
  }

  // Apply country filter to political risk and weather data (supports multiple countries)
  const selectedCountries = filters.country ? filters.country.split(',').map(s => s.trim()).filter(Boolean) : []
  const activeCCs = selectedCountries.map(c => COUNTRY_CC[c]).filter(Boolean)
  const polData = activeCCs.length > 0 ? latestPol.filter(p => activeCCs.includes(p.country_code)) : latestPol
  const weatherData = activeCCs.length > 0
    ? latestWeather.filter(w => activeCCs.some(cc => w.region_code.startsWith(cc + '-')))
    : latestWeather

  const highDrought = weatherData.filter(w => w.drought_risk_score > 70).length
  const highFlood = weatherData.filter(w => w.flood_risk_score > 60).length
  const criticalRegions = weatherData.filter(w => w.drought_risk_score > 80 || w.flood_risk_score > 75)

  const bubbleData = polData.map(p => {
    const regions = weatherData.filter(w => w.region_code.startsWith(p.country_code + '-'))
    const avgDrought = regions.length ? regions.reduce((s, r) => s + r.drought_risk_score, 0) / regions.length : 0
    const atRisk = p.score > 70
      || regions.some(r => r.drought_risk_score > 70)
      || regions.some(r => r.flood_risk_score > 60)
    const totalTractors = tractorsByCountryCode[p.country_code] || 0
    const tractorsAtRisk = atRisk ? totalTractors : 0
    return {
      country: p.country_name,
      code: p.country_code,
      political: p.score,
      drought: Math.round(avgDrought),
      size: Math.max(tractorsAtRisk, 1),
      tractorsAtRisk,
      totalTractors,
      exposure: exposureByCountryCode[p.country_code] || 0,
      tier: p.tier,
    }
  })

  // Weighted average political risk (tractor-weighted)
  const totalPortfolioTractors = Object.values(tractorsByCountryCode).reduce((s, v) => s + v, 0)
  const weightedPolRisk = totalPortfolioTractors > 0
    ? latestPol.reduce((s, p) => s + p.score * (tractorsByCountryCode[p.country_code] || 0), 0) / totalPortfolioTractors
    : 0
  const highestRiskCountry = [...latestPol].sort((a, b) => b.score - a.score)[0]

  const fullPolTrend = (() => {
    const byDate: Record<string, Record<string, number>> = {}
    for (const r of data.politicalRisk) {
      if (!byDate[r.scoring_date]) byDate[r.scoring_date] = {}
      byDate[r.scoring_date][r.country_code] = r.score
    }
    return Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).filter((_, i) => i % 2 === 0).map(([date, scores]) => ({ date: date.slice(0, 7), ...scores }))
  })()

  const weatherSeries = (() => {
    const byDate: Record<string, Record<string, number>> = {}
    for (const w of data.weather) {
      if (w.source === 'era5_baseline') continue
      const cc = w.region_code.split('-')[0]
      if (!byDate[w.year_month]) byDate[w.year_month] = {}
      if (!byDate[w.year_month][cc] || byDate[w.year_month][cc] < w.drought_risk_score) {
        byDate[w.year_month][cc] = w.drought_risk_score
      }
    }
    return Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).map(([date, scores]) => ({ date, ...scores }))
  })()

  // Visible country codes for trend charts (all 5 or just the filtered ones)
  const visibleCodes = activeCCs.length > 0 ? activeCCs : ['ET', 'NG', 'KE', 'UG', 'RW']

  const PILLARS = [
    { key: 'pillar_political_stability', label: 'Political Stability', short: 'P1' },
    { key: 'pillar_security_environment', label: 'Security Environment', short: 'P2' },
    { key: 'pillar_economic_fragility', label: 'Economic Fragility', short: 'P3' },
    { key: 'pillar_agriculture_risk', label: 'Agriculture Risk', short: 'P4' },
    { key: 'pillar_lending_risk', label: 'Lending Risk', short: 'P5' },
  ]

  const SUB_COMPONENTS: { key: string; label: string; pillar: string }[] = [
    { key: 'p1_election_risk', label: 'Election Risk', pillar: 'P1' },
    { key: 'p1_civil_unrest', label: 'Civil Unrest', pillar: 'P1' },
    { key: 'p1_legitimacy_crisis', label: 'Legitimacy Crisis', pillar: 'P1' },
    { key: 'p2_armed_conflict', label: 'Armed Conflict', pillar: 'P2' },
    { key: 'p2_spillover', label: 'Spillover Risk', pillar: 'P2' },
    { key: 'p2_terrorism_crime', label: 'Terrorism / Crime', pillar: 'P2' },
    { key: 'p3_fx_depreciation', label: 'FX Depreciation', pillar: 'P3' },
    { key: 'p3_inflation', label: 'Inflation', pillar: 'P3' },
    { key: 'p3_debt_stress', label: 'Debt Stress', pillar: 'P3' },
    { key: 'p3_gdp_trajectory', label: 'GDP Trajectory', pillar: 'P3' },
    { key: 'p4_land_rights', label: 'Land Rights', pillar: 'P4' },
    { key: 'p4_input_subsidy_disruption', label: 'Subsidy Disruption', pillar: 'P4' },
    { key: 'p4_trade_export_policy', label: 'Trade / Export Policy', pillar: 'P4' },
    { key: 'p4_conflict_farming_zones', label: 'Conflict in Farming Zones', pillar: 'P4' },
    { key: 'p5_fx_controls', label: 'FX Controls', pillar: 'P5' },
    { key: 'p5_govt_credit_interference', label: 'Govt Credit Interference', pillar: 'P5' },
    { key: 'p5_regulatory_risk', label: 'Regulatory Risk', pillar: 'P5' },
    { key: 'p5_borrower_repayment_capacity', label: 'Borrower Repayment Capacity', pillar: 'P5' },
  ]

  const countries = polData.sort((a, b) => b.score - a.score)

  function scoreColor(v: number) {
    if (v >= 8) return '#ff2d55'
    if (v >= 6) return 'var(--red)'
    if (v >= 4) return 'var(--amber)'
    return 'var(--text-secondary)'
  }

  return (
    <div style={{ padding: '32px 36px', maxWidth: '1400px' }}>
      <PageHeader title="Regional & Weather Risk" subtitle="Which regions face drought or flood risk, and how much revenue is at stake?" />

      <Suspense fallback={null}>
        <FilterBar options={filterOptions} current={filters} />
      </Suspense>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', marginBottom: '24px' }}>
        <KpiCard label="High Drought Regions" value={`${highDrought}`} sub="Score > 70 · latest month" color="var(--amber)" />
        <KpiCard label="High Flood Regions" value={`${highFlood}`} sub="Score > 60 · latest month" color="var(--accent)" />
        <KpiCard label="Critical Risk Regions" value={`${criticalRegions.length}`} sub="Drought > 80 or flood > 75" color="var(--red)" />
        <KpiCard
          label="Wtd. avg. political risk"
          value={`${weightedPolRisk.toFixed(1)}/100`}
          sub={`${highestRiskCountry?.country_name || '—'} highest at ${highestRiskCountry?.score ?? '—'}`}
          color={weightedPolRisk >= 70 ? 'var(--red)' : weightedPolRisk >= 60 ? 'var(--coral)' : weightedPolRisk >= 50 ? 'var(--amber)' : 'var(--green)'}
          trend="Tractor-weighted across 5 countries"
        />
      </div>

      <Grid cols={2} gap={16}>
        <Card>
          <CardTitle>Political risk vs drought risk — bubble = tractor count at risk</CardTitle>
          <RegionalCharts type="bubble" data={bubbleData} />
        </Card>
        <Card>
          <CardTitle>Political risk score trend by country</CardTitle>
          <RegionalTrendCard type="pol-trend" data={fullPolTrend} />
        </Card>
      </Grid>

      <div style={{ marginTop: '16px' }}>
        <Card>
          <CardTitle>Max drought risk score by country — monthly</CardTitle>
          <RegionalTrendCard type="weather-trend" data={weatherSeries} />
        </Card>
      </div>

      <div style={{ marginTop: '16px' }}>
        <Card>
          <CardTitle>Political risk — pillar scores by country (latest)</CardTitle>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', fontSize: '10px', fontWeight: 400, borderBottom: '0.5px solid var(--border)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Country</th>
                  <th style={{ textAlign: 'center', padding: '8px 10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', fontSize: '10px', fontWeight: 400, borderBottom: '0.5px solid var(--border)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total</th>
                  {PILLARS.map(p => (
                    <th key={p.key} style={{ textAlign: 'center', padding: '8px 10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', fontSize: '10px', fontWeight: 400, borderBottom: '0.5px solid var(--border)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{p.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {countries.map((c, i) => {
                  const r = c as any
                  return (
                    <tr key={c.country_code} style={{ borderBottom: i < countries.length - 1 ? '0.5px solid var(--border)' : 'none' }}>
                      <td style={{ padding: '10px', fontWeight: 500 }}>{c.country_name}</td>
                      <td style={{ padding: '10px', textAlign: 'center', fontFamily: 'DM Mono, monospace', fontWeight: 600, color: c.score >= 70 ? '#ff2d55' : c.score >= 60 ? 'var(--red)' : c.score >= 50 ? 'var(--amber)' : 'var(--green)' }}>{c.score}</td>
                      {PILLARS.map(p => (
                        <td key={p.key} style={{ padding: '10px', textAlign: 'center', fontFamily: 'DM Mono, monospace', color: scoreColor(r[p.key] || 0) }}>{r[p.key] ?? '—'}</td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div style={{ marginTop: '16px' }}>
        <Card>
          <CardTitle>Political risk — component sub-scores by country (latest)</CardTitle>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', fontSize: '10px', fontWeight: 400, borderBottom: '0.5px solid var(--border)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>Component</th>
                  <th style={{ textAlign: 'center', padding: '8px 6px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', fontSize: '10px', fontWeight: 400, borderBottom: '0.5px solid var(--border)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pillar</th>
                  {countries.map(c => (
                    <th key={c.country_code} style={{ textAlign: 'center', padding: '8px 10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', fontSize: '10px', fontWeight: 400, borderBottom: '0.5px solid var(--border)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{c.country_code}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SUB_COMPONENTS.map((comp, i) => (
                  <tr key={comp.key} style={{ borderBottom: i < SUB_COMPONENTS.length - 1 ? '0.5px solid var(--border)' : 'none', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                    <td style={{ padding: '8px 10px', color: 'var(--text-secondary)' }}>{comp.label}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'center', fontFamily: 'DM Mono, monospace', fontSize: '10px', color: 'var(--text-muted)' }}>{comp.pillar}</td>
                    {countries.map(c => {
                      const val = (c as any)[comp.key]
                      return (
                        <td key={c.country_code} style={{ padding: '8px 10px', textAlign: 'center', fontFamily: 'DM Mono, monospace', color: scoreColor(val || 0) }}>{val ?? '—'}</td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div style={{ marginTop: '16px' }}>
        <Card>
          <CardTitle>Region-level risk detail — latest reading</CardTitle>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr>
                {['Region', 'Country', 'Precipitation (mm)', 'Drought Risk', 'Flood Risk', 'vs Baseline'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', fontSize: '10px', fontWeight: 400, borderBottom: '0.5px solid var(--border)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weatherData.sort((a, b) => b.drought_risk_score - a.drought_risk_score).slice(0, 15).map((w, i, arr) => {
                const cc = w.region_code.split('-')[0]
                const vsBaseline = w.precipitation_mm - w.seasonal_baseline_mm
                return (
                  <tr key={w.region_code} style={{ borderBottom: i < arr.length - 1 ? '0.5px solid var(--border)' : 'none' }}>
                    <td style={{ padding: '10px', fontFamily: 'DM Mono, monospace', fontWeight: 500 }}>{w.region_code}</td>
                    <td style={{ padding: '10px', color: 'var(--text-secondary)' }}>{COUNTRY_FULL[cc] || cc}</td>
                    <td style={{ padding: '10px', fontFamily: 'DM Mono, monospace' }}>{w.precipitation_mm?.toFixed(1)}</td>
                    <td style={{ padding: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '50px', height: '4px', background: 'var(--bg-raised)', borderRadius: '2px' }}>
                          <div style={{ width: `${Math.min(w.drought_risk_score, 100)}%`, height: '100%', background: w.drought_risk_score > 75 ? 'var(--red)' : w.drought_risk_score > 50 ? 'var(--amber)' : 'var(--green)', borderRadius: '2px' }} />
                        </div>
                        <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '11px', color: w.drought_risk_score > 75 ? 'var(--red)' : w.drought_risk_score > 50 ? 'var(--amber)' : 'var(--text-secondary)' }}>{w.drought_risk_score?.toFixed(0)}</span>
                      </div>
                    </td>
                    <td style={{ padding: '10px' }}>
                      <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '11px', color: w.flood_risk_score > 60 ? 'var(--accent)' : 'var(--text-secondary)' }}>{w.flood_risk_score?.toFixed(0)}</span>
                    </td>
                    <td style={{ padding: '10px', fontFamily: 'DM Mono, monospace', fontSize: '11px', color: vsBaseline < -20 ? 'var(--red)' : vsBaseline > 20 ? 'var(--accent)' : 'var(--text-secondary)' }}>
                      {vsBaseline > 0 ? '+' : ''}{vsBaseline?.toFixed(1)} mm
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      </div>

      <FootnotesPanel metrics={REGIONAL_METRICS} />
    </div>
  )
}
