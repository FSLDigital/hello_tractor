import { Suspense } from 'react'
import { loadData, getCropConcentration, getFilterOptions } from '@/lib/data'
import { PageHeader, KpiCard, Card, CardTitle, Grid } from '@/components/ui'
import CommodityCharts from '@/components/CommodityCharts'
import FilterBar from '@/components/FilterBar'
import FootnotesPanel, { COMMODITY_METRICS } from '@/components/FootnotesPanel'


export default async function CommodityPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams
  const filters = {
    country: sp.country || '',
    region: sp.region || '',
    implement: sp.implement || '',
    funder: sp.funder || '',
    crop: sp.crop || '',
  }
  const hasFilter = !!(filters.country || filters.region || filters.implement || filters.funder || filters.crop)

  const data = loadData()
  const filterOptions = getFilterOptions(data)
  const cropConc = getCropConcentration(data, hasFilter ? filters : undefined)

  const latestBrent = [...data.brent].filter(b => b.price_usd).sort((a, b) => b.price_date.localeCompare(a.price_date))[0]
  const firstBrent = [...data.brent].filter(b => b.price_usd).sort((a, b) => a.price_date.localeCompare(b.price_date))[0]
  const brentChange = firstBrent && latestBrent ? ((latestBrent.price_usd! - firstBrent.price_usd!) / firstBrent.price_usd!) * 100 : 0

  const cropsByYear = data.crops.reduce((acc, c) => {
    if (!acc[c.crop]) acc[c.crop] = {}
    acc[c.crop][c.year] = c.price
    return acc
  }, {} as Record<string, Record<number, number>>)

  const MAIN_CROPS_TABLE = ['Wheat', 'Rice', 'Maize']
  const cropTrends = MAIN_CROPS_TABLE.map(crop => {
    const prices = cropsByYear[crop] || {}
    const years = Object.keys(prices).map(Number).sort()
    const first = prices[years[0]]
    const last = prices[years[years.length - 1]] || 0
    const change = first ? ((last - first) / first) * 100 : 0
    return { crop, change, latest: last, unit: data.crops.find(c => c.crop === crop)?.unit || '' }
  }).sort((a, b) => b.change - a.change)

  const brentSeries = data.brent.filter(b => b.price_usd).map(b => ({ date: b.price_date.slice(0, 7), price: b.price_usd }))

  const totalRecords = cropConc.reduce((s, c) => s + c.count, 0)
  const top1 = cropConc[0]
  const concentrationRatio = top1 ? (top1.count / totalRecords) * 100 : 0

  const cropPriceTimeSeries = (() => {
    const byYear: Record<number, Record<string, number>> = {}
    for (const c of data.crops) {
      if (!byYear[c.year]) byYear[c.year] = { year: c.year }
      byYear[c.year][c.crop] = c.price
    }
    return Object.values(byYear).sort((a, b) => a.year - b.year)
  })()

  const MAIN_CROPS = ['Wheat', 'Rice', 'Maize']

  // Per-commodity cards with sparkline series — only the three main crops
  const allCommodityCards = MAIN_CROPS.map(cropName => {
    const prices = cropsByYear[cropName] || {}
    const years = Object.keys(prices).map(Number).sort()
    const first = prices[years[0]]
    const last = prices[years[years.length - 1]] || 0
    const change = first ? ((last - first) / first) * 100 : 0
    const unit = data.crops.find(c => c.crop === cropName)?.unit || ''
    const series = years.map(y => ({ value: prices[y] }))
    return { name: cropName, change, latest: last, unit, series }
  })

  return (
    <div style={{ padding: '32px 36px', maxWidth: '1400px' }}>
      <PageHeader title="Commodity & Crop Concentration" subtitle="Which crops dominate our PAYG book, and what happens if prices fall?" />

      <Suspense fallback={null}>
        <FilterBar options={filterOptions} current={filters} />
      </Suspense>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr) repeat(3, 1fr)', gap: '14px', marginBottom: '24px', alignItems: 'stretch' }}>
        <KpiCard label="Brent Crude (latest)" value={`$${latestBrent?.price_usd?.toFixed(2) || 'N/A'}`} sub="Per barrel" color="var(--coral)" trend={`+${latestBrent?.pct_change_12m?.toFixed(1)}% YoY`} />
        <KpiCard label="Brent change since 2022" value={`+${brentChange.toFixed(1)}%`} sub="Input cost pressure" color="var(--red)" />
        <KpiCard label="Top implement concentration" value={`${concentrationRatio.toFixed(1)}%`} sub={top1?.crop || 'N/A'} color="var(--amber)" />
        <KpiCard label="Crops tracked" value="3" sub="Wheat · Rice · Maize" />
        {allCommodityCards.map((c, i) => {
          const COLORS = ['#f59e0b', '#10b981', '#3b82f6']
          return (
            <div key={c.name} style={{
              background: 'var(--bg-card)', border: '0.5px solid var(--border)',
              borderRadius: '12px', padding: '16px 18px', display: 'flex', flexDirection: 'column',
            }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>{c.name}</div>
              <div style={{ fontSize: '24px', fontWeight: 600, fontFamily: 'Syne, sans-serif', letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
                {c.latest > 0 ? (c.latest >= 1000 ? c.latest.toFixed(0) : c.latest >= 100 ? c.latest.toFixed(1) : c.latest.toFixed(2)) : 'N/A'}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>{c.unit}</div>
              <div style={{ fontSize: '11px', color: c.change > 0 ? 'var(--green)' : 'var(--red)', marginTop: '4px', fontFamily: 'DM Mono, monospace' }}>
                {c.change > 0 ? '+' : ''}{c.change.toFixed(1)}% since 2022
              </div>
              <div style={{ marginTop: 'auto', paddingTop: '10px' }}>
                <CommodityCharts type="sparkline" data={c.series} color={COLORS[i % COLORS.length]} />
              </div>
            </div>
          )
        })}
      </div>

      <Grid cols={2} gap={16}>
        <Card>
          <CardTitle>PAYG tractor records by implement type (crop proxy)</CardTitle>
          <CommodityCharts type="crop-bars" data={cropConc} />
        </Card>
        <Card>
          <CardTitle>Brent crude price — USD/barrel</CardTitle>
          <CommodityCharts type="brent-line" data={brentSeries} />
        </Card>
      </Grid>

      <div style={{ marginTop: '16px' }}>
        <Card>
          <CardTitle>International crop price index 2022–2025</CardTitle>
          <CommodityCharts type="crop-prices" data={cropPriceTimeSeries} />
        </Card>
      </div>

      <div style={{ marginTop: '16px' }}>
        <Card>
          <CardTitle>Crop price change 2022 → latest (%)</CardTitle>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr>
                {['Crop', 'Latest price', 'Unit', '% change (2022→latest)'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', fontSize: '10px', fontWeight: 400, borderBottom: '0.5px solid var(--border)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cropTrends.map((c, i) => (
                <tr key={c.crop} style={{ borderBottom: i < cropTrends.length - 1 ? '0.5px solid var(--border)' : 'none' }}>
                  <td style={{ padding: '10px', fontWeight: 500 }}>{c.crop}</td>
                  <td style={{ padding: '10px', fontFamily: 'DM Mono, monospace' }}>{c.latest.toFixed(2)}</td>
                  <td style={{ padding: '10px', color: 'var(--text-secondary)', fontFamily: 'DM Mono, monospace' }}>{c.unit}</td>
                  <td style={{ padding: '10px' }}>
                    <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '11px', color: c.change > 20 ? 'var(--green)' : c.change < -20 ? 'var(--red)' : 'var(--amber)' }}>
                      {c.change > 0 ? '+' : ''}{c.change.toFixed(1)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <FootnotesPanel metrics={COMMODITY_METRICS} />
    </div>
  )
}
