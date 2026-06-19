import { Suspense } from 'react'
import { loadData, getFXSeries, getWACF, getALMData, getALMHistorical, getALMForecastBase, getExposureByCurrency, getDSCRMetrics, getDurationMetrics } from '@/lib/data'
import { PageHeader, KpiCard, Card, CardTitle, Grid, SectionDivider } from '@/components/ui'
import FXCharts from '@/components/FXCharts'
import FXVaR from '@/components/FXVaR'
import FXBaseDatePicker from '@/components/FXBaseDatePicker'
import DSCRCharts from '@/components/DSCRCharts'
import DurationCharts from '@/components/DurationCharts'
import FootnotesPanel, { FX_METRICS } from '@/components/FootnotesPanel'

export default async function FXPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams
  const fxBaseDate = sp.fx_from || ''

  const data = loadData()
  const fxSeries = getFXSeries(data)
  const { wacf, totalOutstanding } = getWACF(data)
  const almData = getALMData(data)
  const almHistorical = getALMHistorical(data)
  const almForecastBase = getALMForecastBase(data)
  const { rows: dscrRows, latest: dscrLatest } = getDSCRMetrics(data)
  const duration = getDurationMetrics(data)

  const currencies = ['KES', 'NGN', 'ETB', 'UGX', 'RWF']
  const currencyNames: Record<string, string> = { KES: 'Kenyan Shilling', NGN: 'Nigerian Naira', ETB: 'Ethiopian Birr', UGX: 'Ugandan Shilling', RWF: 'Rwandan Franc' }
  const currencyCountry: Record<string, string> = { KES: 'Kenya', NGN: 'Nigeria', ETB: 'Ethiopia', UGX: 'Uganda', RWF: 'Rwanda' }

  const latestFX = data.fx.reduce((acc, r) => {
    if (!acc[r.currency_code] || r.observed_at > acc[r.currency_code].observed_at) acc[r.currency_code] = r
    return acc
  }, {} as Record<string, typeof data.fx[0]>)

  const firstFX = data.fx.reduce((acc, r) => {
    if (!acc[r.currency_code] || r.observed_at < acc[r.currency_code].observed_at) acc[r.currency_code] = r
    return acc
  }, {} as Record<string, typeof data.fx[0]>)

  // 12-month trailing FX change
  const twelveMonthsAgo = new Date()
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1)
  const twelveMonthsAgoStr = twelveMonthsAgo.toISOString().slice(0, 10)
  const fxTwelveMonthsAgo = data.fx.reduce((acc, r) => {
    if (r.observed_at <= twelveMonthsAgoStr) {
      if (!acc[r.currency_code] || r.observed_at > acc[r.currency_code].observed_at) acc[r.currency_code] = r
    }
    return acc
  }, {} as Record<string, typeof data.fx[0]>)

  // Custom base date FX rates
  const fxBaseRates = data.fx.reduce((acc, r) => {
    const cutoff = fxBaseDate || '1900-01-01'
    if (r.observed_at <= cutoff) {
      if (!acc[r.currency_code] || r.observed_at > acc[r.currency_code].observed_at) acc[r.currency_code] = r
    }
    return acc
  }, {} as Record<string, typeof data.fx[0]>)

  const fxStats = currencies.map(c => {
    const latest = latestFX[c]
    const yearAgo = fxTwelveMonthsAgo[c]
    const change12m = yearAgo && latest ? ((latest.rate_to_usd - yearAgo.rate_to_usd) / yearAgo.rate_to_usd) * 100 : 0
    const baseRef = fxBaseRates[c] || firstFX[c]
    const changeFull = baseRef && latest ? ((latest.rate_to_usd - baseRef.rate_to_usd) / baseRef.rate_to_usd) * 100 : 0
    return { code: c, name: currencyNames[c], country: currencyCountry[c], latest: latest?.rate_to_usd || 0, change: changeFull, change12m }
  })

  // --- VaR data preparation ---
  const FX_CCY = ['KES', 'NGN', 'ETB', 'UGX', 'RWF']

  // Monthly FX rates per currency (last observation per month, chronological)
  const monthlyByCC: Record<string, Map<string, { rate: number; date: string }>> = {}
  for (const r of data.fx) {
    if (!FX_CCY.includes(r.currency_code)) continue
    const month = r.observed_at.slice(0, 7)
    if (!monthlyByCC[r.currency_code]) monthlyByCC[r.currency_code] = new Map()
    const ex = monthlyByCC[r.currency_code].get(month)
    if (!ex || r.observed_at > ex.date) monthlyByCC[r.currency_code].set(month, { rate: r.rate_to_usd, date: r.observed_at })
  }
  const fxMonthlyRates: Record<string, number[]> = {}
  for (const [c, m] of Object.entries(monthlyByCC)) {
    fxMonthlyRates[c] = [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v.rate)
  }

  const exposureByFXCurrency = getExposureByCurrency(data)

  const activeRepayments = data.repayments.filter(r => r.status === 'ACTIVE')
  const uniqueFacilities = [...new Map(activeRepayments.map(r => [r.facility_id, r])).values()]
  const facilitySchedule = uniqueFacilities.map(f => {
    const sorted = activeRepayments
      .filter(r => r.facility_id === f.facility_id)
      .sort((a, b) => a.repayment_date.localeCompare(b.repayment_date))
    return {
      name: f.facility_name,
      currency: f.currency_code,
      outstanding: f.outstanding_usd,
      rate: f.interest_rate,
      nextPayment: sorted[0]?.repayment_amount_usd || 0,
      nextPaymentDate: sorted[0]?.repayment_date || null,
    }
  })

  const uniqueKES = [...new Map(activeRepayments.filter(r => r.currency_code === 'KES').map(r => [r.facility_id, r])).values()].reduce((s, r) => s + r.outstanding_usd, 0)
  const uniqueUSD = [...new Map(activeRepayments.filter(r => r.currency_code === 'USD').map(r => [r.facility_id, r])).values()].reduce((s, r) => s + r.outstanding_usd, 0)

  // Exposure-weighted FX change across all portfolio currencies (+ve = depreciated vs USD)
  const totalLocalExposure = currencies.reduce((s, c) => s + (exposureByFXCurrency[c] || 0), 0)
  const weightedFXChange = totalLocalExposure > 0
    ? currencies.reduce((s, c) => s + (fxStats.find(f => f.code === c)?.change || 0) * (exposureByFXCurrency[c] || 0), 0) / totalLocalExposure
    : 0

  const fxMinDate = fxSeries[0]?.date as string | undefined
  const fxMaxDate = fxSeries[fxSeries.length - 1]?.date as string | undefined

  const CELL = { fontSize: '11px', fontFamily: 'DM Mono, monospace' } as const
  const MUTED = { ...CELL, color: 'var(--text-muted)' } as const

  const changeColLabel = `Δ since ${fxBaseDate ? fxBaseDate.slice(0, 7) : 'first obs.'}`

  return (
    <div style={{ padding: '32px 36px', maxWidth: '1400px' }}>
      <PageHeader title="FX Exposure & Liability Management" subtitle="Are asset inflows matching debt outflows? Which currencies are weakening fastest?" />

      {/* Top KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', marginBottom: '16px' }}>
        <KpiCard label="KES Facility Exposure" value={`$${(uniqueKES / 1e6).toFixed(2)}M`} sub="ABSA + FSD · 11.66% / 0%" color="var(--text-primary)" />
        <KpiCard label="USD Facility Exposure" value={`$${(uniqueUSD / 1e6).toFixed(2)}M`} sub="KUZA · 6.00%" color="var(--text-primary)" />
        <KpiCard label="Wtd. Avg. Cost of Funding" value={`${wacf.toFixed(2)}%`} sub={`$${(totalOutstanding / 1e6).toFixed(2)}M outstanding`} color={wacf > 10 ? 'var(--red)' : wacf > 6 ? 'var(--amber)' : 'var(--green)'} trend="Null rates treated as 0%" />
        <KpiCard
          label={`Wtd. portfolio FX shift (${changeColLabel})`}
          value={`${(-weightedFXChange) >= 0 ? '+' : ''}${(-weightedFXChange).toFixed(1)}%`}
          sub="Exposure-wtd. across 5 currencies · -ve = weakened vs USD"
          color={weightedFXChange > 10 ? 'var(--red)' : weightedFXChange > 0 ? 'var(--amber)' : 'var(--green)'}
        />
      </div>

      {/* Per-currency exchange rate cards with 12-mo change */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '14px', marginBottom: '24px' }}>
        {fxStats.map(f => (
          <div key={f.code} style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: '12px', padding: '16px 18px' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
              {f.code} / USD · {f.country}
            </div>
            <div style={{ fontSize: '22px', fontWeight: 600, fontFamily: 'Syne, sans-serif', color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              {f.latest.toFixed(2)}
            </div>
            <div style={{ fontSize: '11px', marginTop: '4px', fontFamily: 'DM Mono, monospace', color: f.change12m > 0 ? 'var(--red)' : 'var(--green)' }}>
              {(-f.change12m) >= 0 ? '+' : ''}{(-f.change12m).toFixed(1)}% (12-mo)
            </div>
          </div>
        ))}
      </div>

      {/* Value at Risk tool */}
      <Card style={{ marginBottom: '16px' }}>
        <CardTitle>Value at Risk — FX depreciation at 95% confidence</CardTitle>
        <FXVaR fxMonthlyRates={fxMonthlyRates} exposureUSD={exposureByFXCurrency} />
      </Card>

      {/* Depreciation chart — date range controlled inside FXCharts */}
      <Card style={{ marginBottom: '16px' }}>
        <CardTitle>Currency strength indexed to first observation = 100 (lower = weaker vs USD)</CardTitle>
        <FXCharts type="indexed-lines" data={fxSeries} minDate={fxMinDate} maxDate={fxMaxDate} />
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginBottom: '16px' }}>
        <Card>
          <CardTitle>Currency summary vs USD</CardTitle>
          <Suspense fallback={null}>
            <div style={{ marginBottom: '10px' }}>
              <FXBaseDatePicker current={fxBaseDate} />
            </div>
          </Suspense>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr>
                {['Currency', 'Country', 'Rate (per USD)', changeColLabel].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', fontSize: '10px', fontWeight: 400, borderBottom: '0.5px solid var(--border)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fxStats.map((f, i) => (
                <tr key={f.code} style={{ borderBottom: i < fxStats.length - 1 ? '0.5px solid var(--border)' : 'none' }}>
                  <td style={{ padding: '10px', fontWeight: 500, fontFamily: 'DM Mono, monospace' }}>{f.code}</td>
                  <td style={{ padding: '10px', color: 'var(--text-secondary)' }}>{f.country}</td>
                  <td style={{ padding: '10px', fontFamily: 'DM Mono, monospace' }}>{f.latest.toFixed(2)}</td>
                  <td style={{ padding: '10px', fontFamily: 'DM Mono, monospace', color: f.change > 0 ? 'var(--red)' : 'var(--green)' }}>
                    {(-f.change) >= 0 ? '+' : ''}{(-f.change).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card>
          <CardTitle>Active debt facilities</CardTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {facilitySchedule.map(f => (
              <div key={f.name} style={{ padding: '12px', background: 'var(--bg-raised)', borderRadius: '8px', border: '0.5px solid var(--border)' }}>
                <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>{f.name}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                  <div style={MUTED}>Outstanding</div>
                  <div style={CELL}>${f.outstanding.toLocaleString()}</div>
                  <div style={MUTED}>Currency</div>
                  <div style={{ ...CELL, color: 'var(--accent)' }}>{f.currency}</div>
                  <div style={MUTED}>Interest rate</div>
                  <div style={{ ...CELL, color: 'var(--amber)' }}>{f.rate != null ? `${(f.rate * 100).toFixed(2)}%` : '0.00% (assumed)'}</div>
                  <div style={MUTED}>Next repayment date</div>
                  <div style={{ ...CELL, color: 'var(--text-secondary)' }}>{f.nextPaymentDate || 'N/A'}</div>
                  <div style={MUTED}>Next repayment amount</div>
                  <div style={{ ...CELL, color: 'var(--green)' }}>${f.nextPayment.toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Currency trends (sparklines) + FX correlation heatmap */}
      <Card style={{ marginBottom: '16px' }}>
        <CardTitle>Currency trends & FX correlation</CardTitle>
        <FXCharts type="fx-trends-heatmap" data={fxSeries} />
      </Card>

      {/* ALM historical + forecast side by side */}
      <div style={{ marginBottom: '16px' }}>
        <Grid cols={2} gap={16}>
          <Card>
            <CardTitle>Historical inflows vs repayments — actual (USD)</CardTitle>
            <FXCharts type="alm-historical" data={almHistorical} />
          </Card>
          <Card>
            <CardTitle>Projected future inflows vs repayments — seasonality-adjusted (USD)</CardTitle>
            <FXCharts type="alm-forecast" data={almForecastBase} />
          </Card>
        </Grid>
      </div>

      {/* Duration section */}
      <SectionDivider label="PAYG Portfolio Duration — PV-weighted average time to cashflows" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', marginBottom: '16px' }}>
        <KpiCard
          label="Portfolio Duration"
          value={`${duration.portfolioDuration.toFixed(2)} mo`}
          sub="PV-weighted avg. time to remaining cashflows"
          color="var(--accent)"
        />
        <KpiCard
          label="Total Present Value"
          value={duration.totalPV >= 1e6 ? `$${(duration.totalPV / 1e6).toFixed(2)}M` : `$${(duration.totalPV / 1e3).toFixed(0)}k`}
          sub="Discounted at monthly funding cost"
          color="var(--text-primary)"
        />
        <KpiCard
          label="Active Agreements"
          value={duration.activeAgreements.toLocaleString()}
          sub="Agreements with remaining contract life"
          color="var(--text-primary)"
        />
        <KpiCard
          label="Monthly Funding Rate"
          value={`${(duration.annualFundingRate / 12).toFixed(3)}%`}
          sub={`WACF ${duration.annualFundingRate.toFixed(2)}% p.a. ÷ 12`}
          color="var(--amber)"
        />
      </div>

      <div style={{ marginBottom: '16px' }}>
        <Grid cols={2} gap={16}>
          <Card>
            <CardTitle>Duration by country — PV-weighted average (months)</CardTitle>
            <DurationCharts type="by-country" metrics={duration} />
          </Card>
          <Card>
            <CardTitle>Agreement duration distribution</CardTitle>
            <DurationCharts type="distribution" metrics={duration} />
          </Card>
        </Grid>
      </div>

      <Card style={{ marginBottom: '24px' }}>
        <CardTitle>Forward cashflow profile — PV of aggregate repayments by quarter (USD)</CardTitle>
        <DurationCharts type="cashflow-profile" metrics={duration} />
      </Card>

      {/* DSCR / LLCR section */}
      {(() => {
        const firstPeriod = dscrRows[0]?.period
        const lastPeriod = dscrRows[dscrRows.length - 1]?.period
        const periodRange = firstPeriod && lastPeriod ? `${firstPeriod} – ${lastPeriod}` : ''
        return <SectionDivider label={`Debt Service & Coverage Metrics${periodRange ? ` · ${periodRange}` : ''}`} />
      })()}

      {dscrLatest && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', marginBottom: '16px' }}>
          <KpiCard
            label={`DSCR · ${dscrLatest.period}`}
            value={dscrLatest.dscr != null ? `${Number(dscrLatest.dscr).toFixed(2)}x` : '—'}
            sub="EBITDA / (Interest + Principal)"
            color={Number(dscrLatest.dscr) >= 1.2 ? 'var(--green)' : Number(dscrLatest.dscr) >= 1.0 ? 'var(--amber)' : 'var(--red)'}
          />
          <KpiCard
            label={`LLCR · ${dscrLatest.period}`}
            value={dscrLatest.llcr != null ? `${Number(dscrLatest.llcr).toFixed(2)}x` : '—'}
            sub="NPV(CFADS remaining) / Total Debt"
            color={Number(dscrLatest.llcr) >= 1.2 ? 'var(--green)' : Number(dscrLatest.llcr) >= 1.0 ? 'var(--amber)' : 'var(--red)'}
          />
          <KpiCard
            label={`Interest Coverage · ${dscrLatest.period}`}
            value={dscrLatest.interest_coverage != null ? `${Number(dscrLatest.interest_coverage).toFixed(2)}x` : '—'}
            sub="EBIT / Interest Expense"
            color={Number(dscrLatest.interest_coverage) >= 3.0 ? 'var(--green)' : Number(dscrLatest.interest_coverage) >= 2.0 ? 'var(--amber)' : 'var(--red)'}
          />
          <KpiCard
            label={`D/E Ratio · ${dscrLatest.period}`}
            value={dscrLatest.debt_to_equity != null ? `${Number(dscrLatest.debt_to_equity).toFixed(2)}x` : '—'}
            sub="(STD + LTD) / Shareholders Equity"
            color={Number(dscrLatest.debt_to_equity) <= 1.0 ? 'var(--green)' : Number(dscrLatest.debt_to_equity) <= 2.0 ? 'var(--amber)' : 'var(--red)'}
          />
        </div>
      )}

      <div style={{ marginBottom: '24px' }}>
        <Grid cols={2} gap={16}>
          <Card>
            <CardTitle>DSCR — debt service coverage over loan life (projected)</CardTitle>
            <DSCRCharts type="dscr-llcr" rows={dscrRows} />
          </Card>
          <Card>
            <CardTitle>Interest coverage & debt/equity — leverage trajectory (projected)</CardTitle>
            <DSCRCharts type="leverage" rows={dscrRows} />
          </Card>
        </Grid>
      </div>

      <FootnotesPanel metrics={FX_METRICS} />
    </div>
  )
}
