export interface FXRate {
  currency_code: string
  rate_to_usd: number
  observed_at: string
}

export interface Repayment {
  facility_id: string
  facility_name: string
  facility_type: string
  currency_code: string
  repayment_date: string
  repayment_amount_usd: number
  outstanding_usd: number
  interest_rate: number | null
  status: string
}

export interface BrentPrice {
  commodity_code: string
  price_date: string
  price_usd: number | null
  pct_change_1m: number
  pct_change_3m: number
  pct_change_12m: number
}

export interface CropPrice {
  crop: string
  year: number
  year_month: string
  price: number
  unit: string
  price_basis: string
  source: string
}

export interface PoliticalRisk {
  scoring_date: string
  country_code: string
  country_name: string
  score: number
  tier: string
  prior_score: number
  score_delta: number
  pillar_political_stability: number
  pillar_security_environment: number
  pillar_economic_fragility: number
  pillar_agriculture_risk: number
  pillar_lending_risk: number
  key_drivers: string
}

export interface WeatherForecast {
  forecast_id: number
  region_code: string
  year_month: string
  precipitation_mm: number
  drought_risk_score: number
  flood_risk_score: number
  seasonal_baseline_mm: number
  source?: string
}

export interface SeasonalityIndex {
  country: string
  month: string
  month_number: number
  index_worked_acres: number
  index_amount_paid: number
  index_repayment_rate: number
  seasonality_index: number
}

export interface HTPerformance {
  country: string
  currency_code: string
  year: number
  month_num: number
  month: string
  funder: string | null
  name: string
  tractor_id: string
  monthly_covenant_target: number | null
  monthly_area_serviced: number
  repayment_per_area: number | null
  collection_plus_surcharge: number | null
  covenant_collection_100pct: number | null
  surcharge_expected: number | null
  surcharge_covered: number | null
  surcharge_collected: number | null
  expected_collection: number
  expected_revenue: number | null
  covenant_collection_target: number | null
  total_collection: number
  actual_collection: number | null
  pct_expected_vs_covenant: number | null
  pct_actual_vs_covenant: number | null
  is_duplicate_entry: boolean | null
  escalations: string | null
  months_in_operations: number | null
  tractor_id_lu: string | null
  gender: string | null
  age: number | null
  primary_implement: string | null
  region: string | null
  origination_date: string | null
  cohorts: string | null
}

export interface AlertContext {
  political?: {
    score: number
    prior_score: number
    score_delta: number
    tier: string
    pillar_political_stability: number
    pillar_security_environment: number
    pillar_economic_fragility: number
    pillar_agriculture_risk: number
    pillar_lending_risk: number
    key_drivers: string
  }
  weather?: {
    region_code: string
    drought_risk_score: number
    flood_risk_score: number
    precipitation_mm: number
    seasonal_baseline_mm: number
  }
  portfolio?: {
    country: string
    owed: number
    paid: number
    tractorCount: number
    repaymentRate: number
  }
  commodity?: {
    price_usd: number
    pct_change_1m: number
    pct_change_3m: number
    pct_change_12m: number
  }
}

export interface DSCRRow {
  period: string
  cash: number
  short_term_debt: number
  long_term_debt: number
  shareholders_equity: number
  ebit: number
  ebitda: number
  interest_expense: number
  principal_repayments: number
  net_debt: number | null
  total_debt: number | null
  debt_to_equity: number | null
  interest_coverage: number | null
  dscr: number | null
  cfads: number | null
  discount_rate: number | null
  llcr?: number
}

export interface DashboardData {
  fx: FXRate[]
  repayments: Repayment[]
  brent: BrentPrice[]
  crops: CropPrice[]
  politicalRisk: PoliticalRisk[]
  weather: WeatherForecast[]
  seasonality: SeasonalityIndex[]
  htPerformance: HTPerformance[]
  dscr: DSCRRow[]
}
