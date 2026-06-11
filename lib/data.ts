import * as XLSX from 'xlsx'
import path from 'path'
import fs from 'fs'
import type { DashboardData, FXRate, Repayment, BrentPrice, CropPrice, PoliticalRisk, WeatherForecast, SeasonalityIndex, HTPerformance, AlertContext, DSCRRow } from './types'

let cachedData: DashboardData | null = null

export function loadData(): DashboardData {
  if (cachedData) return cachedData

  const filePath = path.join(process.cwd(), 'public', 'data', 'treasury_data.xlsx')
  const buffer = fs.readFileSync(filePath)
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true })

  function sheet<T>(name: string): T[] {
    const ws = wb.Sheets[name]
    if (!ws) return []
    return XLSX.utils.sheet_to_json<T>(ws, { defval: null })
  }

  const rawDSCR = sheet<DSCRRow>('DSCR').map(r => {
    // Re-derive formula columns from raw inputs (formula cache may be absent after xlsx edits)
    const std = Number(r.short_term_debt) || 0
    const ltd = Number(r.long_term_debt) || 0
    const cash = Number(r.cash) || 0
    const equity = Number(r.shareholders_equity) || 0
    const ebit = Number(r.ebit) || 0
    const ebitda = Number(r.ebitda) || 0
    const interest = Number(r.interest_expense) || 0
    const principal = Number(r.principal_repayments) || 0
    const totalDebt = std + ltd
    return {
      ...r,
      net_debt: totalDebt - cash,
      total_debt: totalDebt,
      debt_to_equity: equity > 0 ? totalDebt / equity : null,
      interest_coverage: interest > 0 ? ebit / interest : null,
      dscr: (interest + principal) > 0 ? ebitda / (interest + principal) : null,
    }
  })
  const dscrWithLLCR = computeLLCR(rawDSCR.filter(r => r.period))

  cachedData = {
    fx: sheet<FXRate>('FX_Rates'),
    repayments: sheet<Repayment>('Repayment_Schedule'),
    brent: sheet<BrentPrice>('Brent_Crude'),
    crops: sheet<CropPrice>('Crop_Prices'),
    politicalRisk: sheet<PoliticalRisk>('Political_Risk'),
    weather: sheet<WeatherForecast>('Weather_Forecast'),
    seasonality: sheet<SeasonalityIndex>('Seasonality_Index'),
    htPerformance: sheet<HTPerformance>('HT_Performance'),
    dscr: dscrWithLLCR,
  }

  return cachedData
}

// --- Crop → Region mapping (Maize, Rice, or Wheat only) ---

export const CROP_REGION_MAP: Record<string, string> = {
  // Ethiopia
  'Bale':                      'Wheat',
  'East Shewa':                'Maize',
  'Siltie':                    'Maize',
  'W/ Arsi':                   'Wheat',
  // Kenya
  'Rift Valley':               'Maize',
  'Nyanza':                    'Maize',
  'Central':                   'Maize',
  // Nigeria
  'North Central':             'Maize',
  'North central':             'Maize',
  'North East':                'Maize',
  'North West':                'Wheat',
  'North west':                'Wheat',
  'South East':                'Rice',
  'South East/ North Central': 'Maize',
  'South West':                'Rice',
  // Uganda
  'Central Region':            'Maize',
  'Eastern Region':            'Maize',
  'Northern Region':           'Maize',
  'Western Region':            'Maize',
}

export function getCropFilterOptions(): string[] {
  return ['Maize', 'Rice', 'Wheat']
}

// --- Filter helpers ---

export interface HTFilters {
  country?: string
  region?: string
  implement?: string
  funder?: string
  crop?: string
}

export function getFilterOptions(data: DashboardData) {
  const countries = new Set<string>()
  const regions = new Set<string>()
  const implements_ = new Set<string>()
  const trustees = new Set<string>()

  for (const r of data.htPerformance) {
    if (r.country) countries.add(r.country)
    if (r.region) regions.add(r.region)
    if (r.primary_implement) implements_.add(r.primary_implement)
    if (r.funder) trustees.add(r.funder)
  }

  return {
    countries: [...countries].sort(),
    regions: [...regions].sort(),
    implements: [...implements_].sort(),
    funders: [...trustees].sort(),
    crops: getCropFilterOptions(),
  }
}

export function filterHTPerformance(perf: HTPerformance[], filters: HTFilters): HTPerformance[] {
  return perf.filter(r => {
    if (filters.country && r.country !== filters.country) return false
    if (filters.region && r.region !== filters.region) return false
    if (filters.implement && r.primary_implement !== filters.implement) return false
    if (filters.funder && r.funder !== filters.funder) return false
    if (filters.crop) {
      if (CROP_REGION_MAP[r.region || ''] !== filters.crop) return false
    }
    return true
  })
}

// --- Derived metrics ---

function buildFXRates(data: DashboardData): Record<string, number> {
  const latest: Record<string, { rate: number; date: string }> = {}
  for (const r of data.fx) {
    if (!latest[r.currency_code] || r.observed_at > latest[r.currency_code].date)
      latest[r.currency_code] = { rate: r.rate_to_usd, date: r.observed_at }
  }
  return Object.fromEntries(Object.entries(latest).map(([k, v]) => [k, v.rate]))
}

function toUSD(amount: number, currencyCode: string, fxRates: Record<string, number>): number {
  const rate = fxRates[currencyCode]
  return rate ? amount / rate : amount
}

function parseOrigDate(raw: string | null | undefined): Date | null {
  if (!raw) return null
  const parts = String(raw).split('/')
  if (parts.length !== 3) return null
  const d = parseInt(parts[0]), m = parseInt(parts[1]), y = parseInt(parts[2])
  if (!d || !m || !y) return null
  return new Date(y, m - 1, d)
}

function remainingMonths(origDate: Date, now: Date, contractYears = 5): number {
  const endDate = new Date(origDate)
  endDate.setFullYear(endDate.getFullYear() + contractYears)
  const diff = (endDate.getFullYear() - now.getFullYear()) * 12 + (endDate.getMonth() - now.getMonth())
  return Math.max(0, diff)
}

type TractorMeta = { covenant: number; rate: number; origDate: Date | null; country: string; currency_code: string; key: string }

// Builds per-tractor profile from historical rows only, resolving last non-zero covenant and rate.
function buildTractorMeta(data: DashboardData, filters?: HTFilters): Map<string, TractorMeta> {
  const perf = filters ? filterHTPerformance(data.htPerformance, filters) : data.htPerformance
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const meta = new Map<string, TractorMeta>()
  for (const r of perf) {
    const yr = r.year; const mn = r.month_num
    if (!yr || !mn) continue
    const key = `${yr}-${String(mn).padStart(2, '0')}`
    if (key > currentMonth) continue
    const id = String(r.tractor_id)
    const existing = meta.get(id)
    const covenant = Number(r.monthly_covenant_target) || 0
    const rate = Number(r.repayment_per_area) || 0
    const origDate = parseOrigDate(r.origination_date as string)
    if (!existing || key > existing.key) {
      meta.set(id, {
        covenant: covenant > 0 ? covenant : (existing?.covenant || 0),
        rate: rate > 0 ? rate : (existing?.rate || 0),
        origDate: origDate || existing?.origDate || null,
        country: r.country || existing?.country || '',
        currency_code: r.currency_code || existing?.currency_code || '',
        key,
      })
    } else {
      if (covenant > 0 && existing.covenant === 0) existing.covenant = covenant
      if (rate > 0 && existing.rate === 0) existing.rate = rate
      if (origDate && !existing.origDate) existing.origDate = origDate
    }
  }
  return meta
}

// Exposure = remaining months in 5-year contract × covenant_ha × rate_per_ha → USD
function tractorExposureUSD(meta: TractorMeta, fxRates: Record<string, number>, now: Date): number {
  if (!meta.covenant || !meta.rate || !meta.origDate) return 0
  return toUSD(meta.covenant * meta.rate, meta.currency_code, fxRates) * remainingMonths(meta.origDate, now)
}

export function getPortfolioStats(data: DashboardData, filters?: HTFilters) {
  const activeRepayments = data.repayments.filter(r => r.status === 'ACTIVE')
  const totalOutstanding = [...new Map(activeRepayments.map(r => [r.facility_id, r])).values()]
    .reduce((s, r) => s + (r.outstanding_usd || 0), 0)

  const fxRates = buildFXRates(data)
  const now = new Date()
  const tractorMeta = buildTractorMeta(data, filters)
  const perf = filters ? filterHTPerformance(data.htPerformance, filters) : data.htPerformance

  const byCountry: Record<string, { owed: number; paid: number; tractors: Set<string> }> = {}
  for (const [id, meta] of tractorMeta) {
    const c = meta.country || 'Unknown'
    if (!byCountry[c]) byCountry[c] = { owed: 0, paid: 0, tractors: new Set() }
    byCountry[c].tractors.add(id)
    byCountry[c].owed += tractorExposureUSD(meta, fxRates, now)
  }

  const totalPaid = perf.reduce((s, r) => s + toUSD(Number(r.total_collection) || 0, r.currency_code, fxRates), 0)
  const totalOwed = Object.values(byCountry).reduce((s, v) => s + v.owed, 0)
  const repaymentRate = totalOwed > 0 ? (totalPaid / totalOwed) * 100 : 0

  return {
    totalOutstanding,
    totalOwed,
    totalPaid,
    repaymentRate,
    byCountry: Object.entries(byCountry).map(([country, v]) => ({
      country,
      owed: v.owed,
      paid: v.paid,
      tractorCount: v.tractors.size,
      repaymentRate: v.owed > 0 ? (v.paid / v.owed) * 100 : 0,
    })).sort((a, b) => b.owed - a.owed),
  }
}

// Exposure keyed by currency code (USD) — used for FX VaR
export function getExposureByCurrency(data: DashboardData): Record<string, number> {
  const fxRates = buildFXRates(data)
  const now = new Date()
  const result: Record<string, number> = {}
  for (const meta of buildTractorMeta(data).values()) {
    if (!meta.currency_code) continue
    result[meta.currency_code] = (result[meta.currency_code] || 0) + tractorExposureUSD(meta, fxRates, now)
  }
  return result
}

export function getLatestPoliticalRisk(data: DashboardData) {
  const latest: Record<string, PoliticalRisk> = {}
  for (const r of data.politicalRisk) {
    if (!latest[r.country_code] || r.scoring_date > latest[r.country_code].scoring_date) {
      latest[r.country_code] = r
    }
  }
  return Object.values(latest)
}

export function getLatestWeather(data: DashboardData) {
  const latest: Record<string, WeatherForecast> = {}
  for (const r of data.weather) {
    // Skip era5_baseline future placeholders — they have 0 drought and flood scores
    if (r.source === 'era5_baseline') continue
    if (!latest[r.region_code] || r.year_month > latest[r.region_code].year_month) {
      latest[r.region_code] = r
    }
  }
  return Object.values(latest)
}

export function getFXSeries(data: DashboardData) {
  const currencies = ['KES', 'NGN', 'ETB', 'UGX', 'RWF']
  const byDate: Record<string, Record<string, number>> = {}
  for (const r of data.fx) {
    if (!currencies.includes(r.currency_code)) continue
    if (!byDate[r.observed_at]) byDate[r.observed_at] = {}
    byDate[r.observed_at][r.currency_code] = r.rate_to_usd
  }
  const sorted = Object.keys(byDate).sort()
  const base: Record<string, number> = {}
  if (sorted.length > 0) {
    const first = byDate[sorted[0]]
    for (const c of currencies) base[c] = first[c] || 1
  }
  return sorted.map(date => {
    const entry: Record<string, number | string> = { date }
    for (const c of currencies) {
      const raw = byDate[date][c]
      if (raw && base[c]) entry[c] = Math.round((raw / base[c]) * 1000) / 10
    }
    return entry
  })
}

export function getWeatherByCountry(data: DashboardData) {
  const countryMap: Record<string, WeatherForecast[]> = {}
  for (const r of data.weather) {
    const cc = r.region_code.split('-')[0]
    if (!countryMap[cc]) countryMap[cc] = []
    countryMap[cc].push(r)
  }
  return countryMap
}

export function getCropConcentration(data: DashboardData, filters?: HTFilters) {
  const perf = filters ? filterHTPerformance(data.htPerformance, filters) : data.htPerformance
  const byCrop: Record<string, number> = {}
  for (const r of perf) {
    const crop = r.primary_implement || 'Unknown'
    byCrop[crop] = (byCrop[crop] || 0) + 1
  }
  return Object.entries(byCrop)
    .map(([crop, count]) => ({ crop, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15)
}

// --- Weighted Average Cost of Funding ---

export function getWACF(data: DashboardData) {
  const activeRepayments = data.repayments.filter(r => r.status === 'ACTIVE')
  const uniqueFacilities = [...new Map(activeRepayments.map(r => [r.facility_id, r])).values()]

  let weightedSum = 0
  let totalOutstanding = 0

  for (const f of uniqueFacilities) {
    const outstanding = f.outstanding_usd || 0
    const rate = f.interest_rate ?? 0  // treat null as 0%
    weightedSum += outstanding * rate
    totalOutstanding += outstanding
  }

  const wacf = totalOutstanding > 0 ? (weightedSum / totalOutstanding) * 100 : 0
  return { wacf, totalOutstanding, facilities: uniqueFacilities }
}

// --- DSCR / LLCR ---

// LLCR = NPV(CFADS[t..n]) / total_debt[t]
// Uses per-row discount_rate (annual), converted to monthly compounding.
export function computeLLCR(rows: DSCRRow[]): DSCRRow[] {
  const n = rows.length
  return rows.map((row, i) => {
    const totalDebt = Number(row.total_debt) || 0
    if (totalDebt <= 0) return { ...row, llcr: 0 }
    const annualRate = Number(row.discount_rate) || 0.09
    const r = annualRate / 12
    let npv = 0
    for (let j = i; j < n; j++) {
      const cfads = Number(rows[j].cfads) || 0
      npv += cfads / Math.pow(1 + r, j - i + 1)
    }
    return { ...row, llcr: Math.round((npv / totalDebt) * 1000) / 1000 }
  })
}

export function getDSCRMetrics(data: DashboardData) {
  const rows = data.dscr
  if (!rows.length) return { rows, latest: null, currentIndex: -1 }

  const today = new Date()
  const currentPeriod = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

  // Find the row closest to (and not after) today; fall back to last row
  let currentIndex = rows.findLastIndex(r => r.period <= currentPeriod)
  if (currentIndex === -1) currentIndex = 0

  return { rows, latest: rows[currentIndex], currentIndex }
}

// --- ALM: expected inflows vs funding outflows per quarter ---

function parseMonth(monthStr: string): number {
  const MAP: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 }
  const m = String(monthStr).match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i)
  return m ? MAP[m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()] || 0 : 0
}

function parseYear(monthStr: string, rowYear: number): number {
  const m = String(monthStr).match(/(\d{4})/)
  return m ? parseInt(m[1]) : rowYear
}

export function getALMData(data: DashboardData, filters?: HTFilters) {
  const fxRates = buildFXRates(data)
  const perf = filters ? filterHTPerformance(data.htPerformance, filters) : data.htPerformance
  const totalOwed = perf.reduce((s, r) => s + toUSD(Number(r.expected_collection) || 0, r.currency_code, fxRates), 0)
  const totalPaid = perf.reduce((s, r) => s + toUSD(Number(r.total_collection) || 0, r.currency_code, fxRates), 0)
  const avgRepaymentRate = totalOwed > 0 ? totalPaid / totalOwed : 0

  // Build seasonality lookup: month_number → avg seasonality_index across all countries
  const seasonByMonth: Record<number, number[]> = {}
  for (const s of data.seasonality) {
    const mn = s.month_number
    if (!mn) continue
    if (!seasonByMonth[mn]) seasonByMonth[mn] = []
    if (s.seasonality_index != null) seasonByMonth[mn].push(Number(s.seasonality_index))
  }
  const avgSeason: Record<number, number> = {}
  for (const [mn, vals] of Object.entries(seasonByMonth)) {
    const v = vals.filter(x => x > 0)
    avgSeason[Number(mn)] = v.length ? v.reduce((a, b) => a + b, 0) / v.length : 1.0
  }

  // Monthly expected inflows = expected_collection (USD) × avgRepaymentRate × seasonality
  const monthlyInflows: Record<string, number> = {}
  for (const r of perf) {
    const expected = toUSD(Number(r.expected_collection) || 0, r.currency_code, fxRates)
    if (!expected) continue
    const mo = parseMonth(r.month)
    const yr = parseYear(r.month, r.year)
    if (!mo || !yr) continue
    const key = `${yr}-${String(mo).padStart(2, '0')}`
    const season = avgSeason[mo] || 1.0
    monthlyInflows[key] = (monthlyInflows[key] || 0) + expected * avgRepaymentRate * season
  }

  // Funding outflows (repayments) per quarter
  const quarterlyOutflows: Record<string, number> = {}
  const quarterlyInflows: Record<string, number> = {}

  for (const [ym, inflow] of Object.entries(monthlyInflows)) {
    const [y, m] = ym.split('-').map(Number)
    const q = `Q${Math.ceil(m / 3)}'${String(y).slice(-2)}`
    quarterlyInflows[q] = (quarterlyInflows[q] || 0) + inflow
  }

  for (const r of data.repayments.filter(rp => rp.status === 'ACTIVE')) {
    const d = String(r.repayment_date)
    const parts = d.includes('/') ? d.split('/') : d.split('-')
    let year = '', month = 0
    if (parts.length === 3 && d.includes('/')) {
      month = parseInt(parts[1] || parts[0]); year = parts[2]?.slice(-2) || parts[0]
    } else {
      year = parts[0]?.slice(-2) || ''; month = parseInt(parts[1] || '0')
    }
    const q = `Q${Math.ceil(month / 3)}'${year}`
    quarterlyOutflows[q] = (quarterlyOutflows[q] || 0) + (r.repayment_amount_usd || 0)
  }

  // Generate 12 quarters anchored to current quarter (11 past + current)
  const now = new Date()
  let almYr = now.getFullYear()
  let almQ = Math.ceil((now.getMonth() + 1) / 3)
  const targetQuarters: string[] = []
  for (let i = 0; i < 12; i++) {
    targetQuarters.unshift(`Q${almQ}'${String(almYr).slice(-2)}`)
    almQ--
    if (almQ === 0) { almQ = 4; almYr-- }
  }

  // Per-quarter seasonality: average of the three constituent months
  const qSeasonality: Record<number, number> = {}
  for (let qi = 1; qi <= 4; qi++) {
    const months = [qi * 3 - 2, qi * 3 - 1, qi * 3]
    const sv = months.map(m => avgSeason[m] || 1.0)
    qSeasonality[qi] = sv.reduce((a, b) => a + b, 0) / sv.length
  }

  // 12-quarter average outflow as projection base for quarters without actual schedule data
  const knownOutflows = Object.values(quarterlyOutflows).filter(v => v > 0)
  const avgOutflow = knownOutflows.length > 0 ? knownOutflows.reduce((a, b) => a + b, 0) / knownOutflows.length : 0

  return targetQuarters.map(q => {
    const qNum = parseInt(q.match(/Q(\d)/)?.[1] || '1')
    const actualOutflow = quarterlyOutflows[q]
    return {
      q,
      inflows: Math.round(quarterlyInflows[q] || 0),
      outflows: Math.round(actualOutflow !== undefined ? actualOutflow : Math.round(avgOutflow * (qSeasonality[qNum] || 1.0))),
    }
  })
}

// --- ALM: historical actuals and forecast base ---

function buildSeasonality(data: DashboardData): Record<number, number> {
  const seasonByMonth: Record<number, number[]> = {}
  for (const s of data.seasonality) {
    const mn = s.month_number
    if (!mn) continue
    if (!seasonByMonth[mn]) seasonByMonth[mn] = []
    if (s.seasonality_index != null) seasonByMonth[mn].push(Number(s.seasonality_index))
  }
  const avgSeason: Record<number, number> = {}
  for (const [mn, vals] of Object.entries(seasonByMonth)) {
    const v = vals.filter(x => x > 0)
    avgSeason[Number(mn)] = v.length ? v.reduce((a, b) => a + b, 0) / v.length : 1.0
  }
  return avgSeason
}

export function getALMHistorical(data: DashboardData): { q: string; inflows: number; outflows: number }[] {
  const fxRates = buildFXRates(data)
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const quarterlyInflows: Record<string, number> = {}
  for (const r of data.htPerformance) {
    const yr = r.year
    const mn = r.month_num
    if (!yr || !mn) continue
    const key = `${yr}-${String(mn).padStart(2, '0')}`
    if (key > currentMonth) continue
    const amountUSD = toUSD(Number(r.total_collection) || 0, r.currency_code, fxRates)
    const q = `Q${Math.ceil(mn / 3)}'${String(yr).slice(-2)}`
    quarterlyInflows[q] = (quarterlyInflows[q] || 0) + amountUSD
  }

  const quarterlyOutflows: Record<string, number> = {}
  for (const r of data.repayments) {
    const d = String(r.repayment_date)
    const parts = d.split('/')
    if (parts.length !== 3) continue
    const month = parseInt(parts[1])
    const year = parseInt(parts[2])
    if (!month || !year) continue
    const key = `${year}-${String(month).padStart(2, '0')}`
    if (key > currentMonth) continue
    const q = `Q${Math.ceil(month / 3)}'${String(year).slice(-2)}`
    quarterlyOutflows[q] = (quarterlyOutflows[q] || 0) + (r.repayment_amount_usd || 0)
  }

  const allQuarters = new Set([...Object.keys(quarterlyInflows), ...Object.keys(quarterlyOutflows)])
  return [...allQuarters]
    .sort((a, b) => {
      const m = /Q(\d)'(\d{2})/
      const ma = a.match(m), mb = b.match(m)
      if (!ma || !mb) return 0
      return (parseInt(ma[2]) * 100 + parseInt(ma[1])) - (parseInt(mb[2]) * 100 + parseInt(mb[1]))
    })
    .map(q => ({
      q,
      inflows: Math.round(quarterlyInflows[q] || 0),
      outflows: Math.round(quarterlyOutflows[q] || 0),
    }))
}

export function getALMForecastBase(data: DashboardData): { q: string; baseInflows: number; outflows: number }[] {
  const fxRates = buildFXRates(data)
  const seasonality = buildSeasonality(data)
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  // Pass 1: build per-tractor last known covenant + rate, and country-level averages as fallback
  const latestCovenantByTractor = new Map<string, { covenant: number; key: string }>()
  const latestRateByTractor = new Map<string, { rate: number; currency_code: string; country: string; key: string }>()
  const covenantSumByCountry: Record<string, { sum: number; count: number }> = {}
  for (const r of data.htPerformance) {
    const yr = r.year; const mn = r.month_num
    if (!yr || !mn) continue
    const key = `${yr}-${String(mn).padStart(2, '0')}`
    if (key > currentMonth) continue
    const id = String(r.tractor_id)
    const country = r.country || ''
    const covenant = Number(r.monthly_covenant_target) || 0
    const rate = Number(r.repayment_per_area) || 0
    if (covenant > 0) {
      const ex = latestCovenantByTractor.get(id)
      if (!ex || key > ex.key) latestCovenantByTractor.set(id, { covenant, key })
      if (!covenantSumByCountry[country]) covenantSumByCountry[country] = { sum: 0, count: 0 }
      covenantSumByCountry[country].sum += covenant
      covenantSumByCountry[country].count += 1
    }
    if (rate > 0) {
      const ex = latestRateByTractor.get(id)
      if (!ex || key > ex.key) latestRateByTractor.set(id, { rate, currency_code: r.currency_code, country, key })
    }
  }
  const avgCovenantByCountry: Record<string, number> = {}
  for (const [c, { sum, count }] of Object.entries(covenantSumByCountry))
    avgCovenantByCountry[c] = count > 0 ? sum / count : 0

  const resolvedCovenant = (id: string, country: string) =>
    latestCovenantByTractor.get(id)?.covenant || avgCovenantByCountry[country] || 0

  const quarterlyInflows: Record<string, number> = {}

  // Pass 2: future HT rows up to data horizon (they have rate but covenant = 0)
  for (const r of data.htPerformance) {
    const yr = r.year; const mn = r.month_num
    if (!yr || !mn) continue
    const key = `${yr}-${String(mn).padStart(2, '0')}`
    if (key <= currentMonth) continue
    const rate = Number(r.repayment_per_area) || 0
    if (rate === 0) continue
    const covenant = resolvedCovenant(String(r.tractor_id), r.country || '')
    if (covenant === 0) continue
    const amountUSD = toUSD(covenant * rate, r.currency_code, fxRates) * (seasonality[mn] || 1.0)
    const q = `Q${Math.ceil(mn / 3)}'${String(yr).slice(-2)}`
    quarterlyInflows[q] = (quarterlyInflows[q] || 0) + amountUSD
  }

  // Pass 3: extrapolate beyond HT data horizon using each tractor's last known rate
  let maxHTYear = 0, maxHTMonth = 0
  for (const r of data.htPerformance) {
    if (!r.year || !r.month_num) continue
    if (r.year > maxHTYear || (r.year === maxHTYear && r.month_num > maxHTMonth)) {
      maxHTYear = r.year; maxHTMonth = r.month_num
    }
  }
  let maxRepYear = 0, maxRepMonth = 0
  for (const r of data.repayments) {
    if (r.status !== 'ACTIVE') continue
    const parts = String(r.repayment_date).split('/')
    if (parts.length !== 3) continue
    const mo = parseInt(parts[1]); const yr = parseInt(parts[2])
    if (!mo || !yr) continue
    if (yr > maxRepYear || (yr === maxRepYear && mo > maxRepMonth)) { maxRepYear = yr; maxRepMonth = mo }
  }

  if (maxHTYear > 0 && maxRepYear > 0) {
    let yr = maxHTYear; let mn = maxHTMonth + 1
    if (mn > 12) { mn = 1; yr++ }
    while (yr < maxRepYear || (yr === maxRepYear && mn <= maxRepMonth)) {
      const key = `${yr}-${String(mn).padStart(2, '0')}`
      if (key > currentMonth) {
        const q = `Q${Math.ceil(mn / 3)}'${String(yr).slice(-2)}`
        for (const [id, rateRef] of latestRateByTractor) {
          const covenant = resolvedCovenant(id, rateRef.country)
          if (covenant === 0) continue
          const amountUSD = toUSD(covenant * rateRef.rate, rateRef.currency_code, fxRates) * (seasonality[mn] || 1.0)
          quarterlyInflows[q] = (quarterlyInflows[q] || 0) + amountUSD
        }
      }
      mn++; if (mn > 12) { mn = 1; yr++ }
    }
  }

  const quarterlyOutflows: Record<string, number> = {}
  for (const r of data.repayments) {
    if (r.status !== 'ACTIVE') continue
    const d = String(r.repayment_date)
    const parts = d.split('/')
    if (parts.length !== 3) continue
    const month = parseInt(parts[1])
    const year = parseInt(parts[2])
    if (!month || !year) continue
    const key = `${year}-${String(month).padStart(2, '0')}`
    if (key <= currentMonth) continue
    const q = `Q${Math.ceil(month / 3)}'${String(year).slice(-2)}`
    quarterlyOutflows[q] = (quarterlyOutflows[q] || 0) + (r.repayment_amount_usd || 0)
  }

  const allQuarters = new Set([...Object.keys(quarterlyInflows), ...Object.keys(quarterlyOutflows)])
  return [...allQuarters]
    .sort((a, b) => {
      const m = /Q(\d)'(\d{2})/
      const ma = a.match(m), mb = b.match(m)
      if (!ma || !mb) return 0
      return (parseInt(ma[2]) * 100 + parseInt(ma[1])) - (parseInt(mb[2]) * 100 + parseInt(mb[1]))
    })
    .map(q => ({
      q,
      baseInflows: Math.round(quarterlyInflows[q] || 0),
      outflows: Math.round(quarterlyOutflows[q] || 0),
    }))
}

// --- Utilisation trend: last 12 months (covenant, booked, worked ha) ---

export function getUtilisationTrend(data: DashboardData, filters?: HTFilters, fromMonth?: string, toMonth?: string) {
  const perf = filters ? filterHTPerformance(data.htPerformance, filters) : data.htPerformance
  const byMonth: Record<string, { covenant: number; booked: number; worked: number; label: string }> = {}

  for (const r of perf) {
    const mo = parseMonth(r.month)
    const yr = parseYear(r.month, r.year)
    if (!mo || !yr) continue
    const key = `${yr}-${String(mo).padStart(2, '0')}`
    if (!byMonth[key]) {
      const MON_LABELS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      byMonth[key] = { covenant: 0, booked: 0, worked: 0, label: `${MON_LABELS[mo]} ${String(yr).slice(-2)}` }
    }
    const v = byMonth[key]
    const covenant = Number(r.monthly_covenant_target) || 0
    const worked = Number(r.monthly_area_serviced) || 0
    v.covenant += covenant
    v.worked += worked
  }

  const sorted = Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b))
  if (fromMonth || toMonth) {
    return sorted
      .filter(([key]) => (!fromMonth || key >= fromMonth) && (!toMonth || key <= toMonth))
      .map(([, v]) => v)
  }
  return sorted.slice(-12).map(([, v]) => v)
}

// --- Collections trend: last 12 months (worked vs paid) ---

export function getCollectionsTrend(data: DashboardData, filters?: HTFilters, fromMonth?: string, toMonth?: string) {
  const fxRates = buildFXRates(data)
  const perf = filters ? filterHTPerformance(data.htPerformance, filters) : data.htPerformance
  const byMonth: Record<string, { worked: number; paid: number; owed: number; label: string }> = {}

  for (const r of perf) {
    const mo = parseMonth(r.month)
    const yr = parseYear(r.month, r.year)
    if (!mo || !yr) continue
    const key = `${yr}-${String(mo).padStart(2, '0')}`
    if (!byMonth[key]) {
      const MON_LABELS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      byMonth[key] = { worked: 0, paid: 0, owed: 0, label: `${MON_LABELS[mo]} ${String(yr).slice(-2)}` }
    }
    byMonth[key].worked += Number(r.monthly_area_serviced) || 0
    byMonth[key].paid += toUSD(Number(r.total_collection) || 0, r.currency_code, fxRates)
    byMonth[key].owed += toUSD(Number(r.expected_collection) || 0, r.currency_code, fxRates)
  }

  const sorted = Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b))
  if (fromMonth || toMonth) {
    return sorted
      .filter(([key]) => (!fromMonth || key >= fromMonth) && (!toMonth || key <= toMonth))
      .map(([, v]) => v)
  }
  return sorted.slice(-12).map(([, v]) => v)
}

export function getUtilisationTrendAll(data: DashboardData, filters?: HTFilters) {
  const perf = filters ? filterHTPerformance(data.htPerformance, filters) : data.htPerformance
  const byMonth: Record<string, { covenant: number; booked: number; worked: number; label: string }> = {}
  for (const r of perf) {
    const mo = parseMonth(r.month)
    const yr = parseYear(r.month, r.year)
    if (!mo || !yr) continue
    const key = `${yr}-${String(mo).padStart(2, '0')}`
    if (!byMonth[key]) {
      const MON_LABELS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      byMonth[key] = { covenant: 0, booked: 0, worked: 0, label: `${MON_LABELS[mo]} ${String(yr).slice(-2)}` }
    }
    const v = byMonth[key]
    v.covenant += Number(r.monthly_covenant_target) || 0
    v.worked += Number(r.monthly_area_serviced) || 0
  }
  return Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => ({ key, ...v }))
}

export function getCollectionsTrendAll(data: DashboardData, filters?: HTFilters) {
  const fxRates = buildFXRates(data)
  const perf = filters ? filterHTPerformance(data.htPerformance, filters) : data.htPerformance
  const byMonth: Record<string, { worked: number; paid: number; owed: number; label: string }> = {}
  for (const r of perf) {
    const mo = parseMonth(r.month)
    const yr = parseYear(r.month, r.year)
    if (!mo || !yr) continue
    const key = `${yr}-${String(mo).padStart(2, '0')}`
    if (!byMonth[key]) {
      const MON_LABELS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      byMonth[key] = { worked: 0, paid: 0, owed: 0, label: `${MON_LABELS[mo]} ${String(yr).slice(-2)}` }
    }
    byMonth[key].worked += Number(r.monthly_area_serviced) || 0
    byMonth[key].paid += toUSD(Number(r.total_collection) || 0, r.currency_code, fxRates)
    byMonth[key].owed += toUSD(Number(r.expected_collection) || 0, r.currency_code, fxRates)
  }
  return Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => ({ key, ...v }))
}

export function getAlerts(data: DashboardData): Alert[] {
  const alerts: Alert[] = []
  const latestPol = getLatestPoliticalRisk(data)
  const latestWeather = getLatestWeather(data)

  for (const r of latestPol) {
    if (r.score >= 70) alerts.push({ id: `pol-${r.country_code}`, severity: 'critical', category: 'Political', country: r.country_name, message: `${r.country_name} political risk at ${r.score}/100 (${r.tier})`, metric: r.score, threshold: 70, timestamp: r.scoring_date })
    else if (r.score >= 60) alerts.push({ id: `pol-${r.country_code}`, severity: 'warning', category: 'Political', country: r.country_name, message: `${r.country_name} political risk elevated at ${r.score}/100 (${r.tier})`, metric: r.score, threshold: 60, timestamp: r.scoring_date })
  }

  for (const r of latestWeather) {
    if (r.drought_risk_score > 75) alerts.push({ id: `drought-${r.region_code}`, severity: 'critical', category: 'Weather', country: r.region_code.split('-')[0], message: `Drought risk ${r.drought_risk_score.toFixed(0)}/100 in ${r.region_code}`, metric: r.drought_risk_score, threshold: 75, timestamp: r.year_month })
    else if (r.flood_risk_score > 70) alerts.push({ id: `flood-${r.region_code}`, severity: 'warning', category: 'Weather', country: r.region_code.split('-')[0], message: `Flood risk ${r.flood_risk_score.toFixed(0)}/100 in ${r.region_code}`, metric: r.flood_risk_score, threshold: 70, timestamp: r.year_month })
  }

  const latestBrent = [...data.brent].filter(b => b.price_usd).sort((a, b) => b.price_date.localeCompare(a.price_date))[0]
  if (latestBrent && latestBrent.pct_change_12m > 50) {
    alerts.push({ id: 'brent-1', severity: 'warning', category: 'Commodity', country: 'Global', message: `Brent crude up ${latestBrent.pct_change_12m.toFixed(1)}% YoY — input cost pressure`, metric: latestBrent.pct_change_12m, threshold: 50, timestamp: latestBrent.price_date })
  }

  return alerts.sort((a, b) => (a.severity === 'critical' ? -1 : 1))
}

export interface Alert {
  id: string
  severity: 'critical' | 'warning' | 'info'
  category: string
  country: string
  message: string
  metric: number
  threshold: number
  timestamp: string
}

const CC_TO_COUNTRY: Record<string, string> = { KE: 'Kenya', NG: 'Nigeria', ET: 'Ethiopia', UG: 'Uganda', RW: 'Rwanda' }

export function buildAlertContext(alert: Alert, data: DashboardData): AlertContext {
  const latestPol = getLatestPoliticalRisk(data)
  const latestWeather = getLatestWeather(data)
  const stats = getPortfolioStats(data)
  const latestBrent = [...data.brent].filter(b => b.price_usd).sort((a, b) => b.price_date.localeCompare(a.price_date))[0]
  const ctx: AlertContext = {}

  if (alert.category === 'Political') {
    const pol = latestPol.find(p => p.country_name === alert.country)
    if (pol) {
      ctx.political = {
        score: pol.score, prior_score: pol.prior_score, score_delta: pol.score_delta,
        tier: pol.tier,
        pillar_political_stability: pol.pillar_political_stability,
        pillar_security_environment: pol.pillar_security_environment,
        pillar_economic_fragility: pol.pillar_economic_fragility,
        pillar_agriculture_risk: pol.pillar_agriculture_risk,
        pillar_lending_risk: pol.pillar_lending_risk,
        key_drivers: pol.key_drivers,
      }
    }
    const pf = stats.byCountry.find(c => c.country === alert.country)
    if (pf) ctx.portfolio = { country: pf.country, owed: pf.owed, paid: pf.paid, tractorCount: pf.tractorCount, repaymentRate: pf.repaymentRate }
  }

  if (alert.category === 'Weather') {
    const regionCode = alert.id.replace(/^(drought|flood)-/, '')
    const wf = latestWeather.find(w => w.region_code === regionCode)
    if (wf) {
      ctx.weather = {
        region_code: wf.region_code,
        drought_risk_score: wf.drought_risk_score,
        flood_risk_score: wf.flood_risk_score,
        precipitation_mm: wf.precipitation_mm,
        seasonal_baseline_mm: wf.seasonal_baseline_mm,
      }
    }
    const countryName = CC_TO_COUNTRY[alert.country] || alert.country
    const pf = stats.byCountry.find(c => c.country === countryName)
    if (pf) ctx.portfolio = { country: pf.country, owed: pf.owed, paid: pf.paid, tractorCount: pf.tractorCount, repaymentRate: pf.repaymentRate }
  }

  if (alert.category === 'Commodity' && latestBrent) {
    ctx.commodity = {
      price_usd: latestBrent.price_usd!,
      pct_change_1m: latestBrent.pct_change_1m,
      pct_change_3m: latestBrent.pct_change_3m,
      pct_change_12m: latestBrent.pct_change_12m,
    }
  }

  return ctx
}
