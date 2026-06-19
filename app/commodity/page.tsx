import { Suspense } from 'react'
import { loadData, getCropConcentration, getTractorsByCountry, getFilterOptions } from '@/lib/data'
import { PageHeader, KpiCard, Card, CardTitle, Grid } from '@/components/ui'
import CommodityCharts from '@/components/CommodityCharts'
import CropPriceTable from '@/components/CropPriceTable'
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
  const cpFrom = sp.cpFrom || ''
  const cpTo = sp.cpTo || ''

  const data = loadData()
  const filterOptions = getFilterOptions(data)
  const cropConc = getCropConcentration(data, hasFilter ? filters : undefined)
  const { month: latestHtMonth, rows: tractorsByCountry } = getTractorsByCountry(data, hasFilter ? filters : undefined)

  const latestBrent = [...data.brent].filter(b => b.price_usd).sort((a, b) => b.price_date.localeCompare(a.price_date))[0]
  const firstBrent = [...data.brent].filter(b => b.price_usd).sort((a, b) => a.price_date.localeCompare(b.price_date))[0]
  const brentChange = firstBrent && latestBrent ? ((latestBrent.price_usd! - firstBrent.price_usd!) / firstBrent.price_usd!) * 100 : 0

  const MAIN_CROPS = ['Wheat', 'Rice', 'Maize']

  // Monthly rows per crop, sorted chronologically
  const cropMonthly = MAIN_CROPS.reduce((acc, crop) => {
    acc[crop] = data.crops
      .filter(c => c.crop === crop && c.year_month)
      .sort((a, b) => a.year_month.localeCompare(b.year_month))
    return acc
  }, {} as Record<string, typeof data.crops>)

  const brentSeries = data.brent.filter(b => b.price_usd).map(b => ({ date: b.price_date.slice(0, 7), price: b.price_usd }))

  // Price change table: respect cpFrom / cpTo date filters
  const cropTableRows = MAIN_CROPS.map(crop => {
    const rows = cropMonthly[crop]
    const filtered = rows.filter(r => (!cpFrom || r.year_month >= cpFrom) && (!cpTo || r.year_month <= cpTo))
    const src = filtered.length ? filtered : rows
    const fromPrice = src[0]?.price || 0
    const toPrice = src[src.length - 1]?.price || 0
    const change = fromPrice ? ((toPrice - fromPrice) / fromPrice) * 100 : 0
    return { crop, fromPrice, toPrice, change, unit: src[0]?.unit || '$/mt', fromMonth: src[0]?.year_month || '', toMonth: src[src.length - 1]?.year_month || '' }
  }).sort((a, b) => b.change - a.change)

  const brentSorted = data.brent.filter(b => b.price_usd && b.price_date)
    .sort((a, b) => a.price_date.localeCompare(b.price_date))
  const brentFiltered = brentSorted.filter(b => (!cpFrom || b.price_date.slice(0, 7) >= cpFrom) && (!cpTo || b.price_date.slice(0, 7) <= cpTo))
  const brentSrc = brentFiltered.length ? brentFiltered : brentSorted
  const brentTableRow = {
    fromPrice: brentSrc[0]?.price_usd || 0,
    toPrice: brentSrc[brentSrc.length - 1]?.price_usd || 0,
    change: brentSrc[0]?.price_usd ? ((brentSrc[brentSrc.length - 1]?.price_usd! - brentSrc[0]?.price_usd!) / brentSrc[0]?.price_usd!) * 100 : 0,
    fromMonth: brentSrc[0]?.price_date?.slice(0, 7) || '',
    toMonth: brentSrc[brentSrc.length - 1]?.price_date?.slice(0, 7) || '',
  }

  const totalRecords = cropConc.reduce((s, c) => s + c.count, 0)
  const top1 = cropConc[0]
  const concentrationRatio = top1 ? (top1.count / totalRecords) * 100 : 0

  // Monthly time series in wide format for chart: { month, Wheat, Rice, Maize }
  const cropPriceTimeSeries = (() => {
    const byMonth: Record<string, Record<string, number | string>> = {}
    for (const c of data.crops) {
      if (!c.year_month) continue
      if (!byMonth[c.year_month]) byMonth[c.year_month] = { month: c.year_month }
      byMonth[c.year_month][c.crop] = c.price
    }
    return Object.values(byMonth).sort((a, b) => String(a.month).localeCompare(String(b.month)))
  })()

  // Per-commodity cards with monthly sparkline series
  const allCommodityCards = MAIN_CROPS.map((cropName, i) => {
    const rows = cropMonthly[cropName]
    const first = rows[0]?.price || 0
    const last = rows[rows.length - 1]?.price || 0
    const change = first ? ((last - first) / first) * 100 : 0
    const series = rows.map(r => ({ value: r.price }))
    return { name: cropName, change, latest: last, unit: rows[0]?.unit || '', series }
  })

  return (
    <div style={{ padding: '32px 36px', maxWidth: '1400px' }}>
      <PageHeader title="Commodity & Crop Concentration" subtitle="Which crops dominate our PAYG book, and what happens if prices fall?" />

      <Suspense fallback={null}>
        <FilterBar options={filterOptions} current={filters} />
      </Suspense>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr) repeat(3, 1fr)', gap: '14px', marginBottom: '24px', alignItems: 'stretch' }}>
        <KpiCard label="Brent Crude (latest)" value={`$${latestBrent?.price_usd?.toFixed(2) || 'N/A'}`} sub="Per barrel" color="var(--coral)" trend={`+${latestBrent?.pct_change_12m?.toFixed(1)}% YoY`} />
        <KpiCard label="Brent change since 2022" value={`${brentChange >= 0 ? '+' : ''}${brentChange.toFixed(1)}%`} sub="Input cost pressure" color="var(--red)" />
        <KpiCard label="Top implement concentration" value={`${concentrationRatio.toFixed(1)}%`} sub={`${top1?.crop || 'N/A'} · ${latestHtMonth}`} color="var(--amber)" />
        <KpiCard label="Crops tracked" value="3" sub="Wheat · Rice · Maize" />
        {allCommodityCards.map((c, i) => {
          const COLORS = ['#f59e0b', '#10b981', '#3b82f6']
          return (
            <div key={c.name} style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: '12px', padding: '16px 18px', display: 'flex', flexDirection: 'column' }}>
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

      {/* Implement + country charts side by side */}
      <Grid cols={2} gap={16}>
        <Card>
          <CardTitle>PAYG tractor records by implement — {latestHtMonth}</CardTitle>
          <CommodityCharts type="crop-bars" data={cropConc} />
        </Card>
        <Card>
          <CardTitle>PAYG tractor records by country — {latestHtMonth}</CardTitle>
          <CommodityCharts type="by-country" data={tractorsByCountry} />
        </Card>
      </Grid>

      {/* Brent crude — above crop prices */}
      <div style={{ marginTop: '16px' }}>
        <Card>
          <CardTitle>Brent crude price — USD/barrel</CardTitle>
          <CommodityCharts type="brent-line" data={brentSeries} />
        </Card>
      </div>

      {/* Monthly crop prices */}
      <div style={{ marginTop: '16px' }}>
        <Card>
          <CardTitle>International crop prices — monthly ($/mt)</CardTitle>
          <CommodityCharts type="crop-prices" data={cropPriceTimeSeries} />
        </Card>
      </div>

      {/* Price change table with date filters */}
      <div style={{ marginTop: '16px' }}>
        <Card>
          <CardTitle>Commodity price change — selectable period</CardTitle>
          <Suspense fallback={null}>
            <CropPriceTable rows={cropTableRows} brent={brentTableRow} cpFrom={cpFrom} cpTo={cpTo} />
          </Suspense>
        </Card>
      </div>

      <FootnotesPanel metrics={COMMODITY_METRICS} />
    </div>
  )
}
