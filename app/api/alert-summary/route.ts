import { NextResponse } from 'next/server'
import type { AlertContext } from '@/lib/types'

function buildPrompt(alert: Record<string, unknown>, ctx: AlertContext, maxChars: number): string {
  const lines: string[] = [
    'You are a risk analyst for agricultural lending in sub-Saharan Africa.',
    `Write a single factual paragraph of no more than ${maxChars} characters using only the data below.`,
    `Cite specific numbers. Stay strictly under ${maxChars} characters — end cleanly at a sentence boundary.`,
    '',
    `ALERT: ${String(alert.severity).toUpperCase()} ${alert.category} — ${alert.country}`,
    `Message: ${alert.message}`,
    `Score: ${alert.metric} / threshold ${alert.threshold}`,
  ]

  if (ctx.political) {
    const p = ctx.political
    lines.push(
      '',
      'POLITICAL RISK PILLARS:',
      `  Overall: ${p.score}/100 (prev ${p.prior_score}, delta ${p.score_delta > 0 ? '+' : ''}${p.score_delta}) — tier: ${p.tier}`,
      `  Political Stability: ${p.pillar_political_stability}`,
      `  Security Environment: ${p.pillar_security_environment}`,
      `  Economic Fragility: ${p.pillar_economic_fragility}`,
      `  Agriculture Risk: ${p.pillar_agriculture_risk}`,
      `  Lending Risk: ${p.pillar_lending_risk}`,
      `  Key Drivers: ${p.key_drivers}`,
    )
  }

  if (ctx.weather) {
    const w = ctx.weather
    const deficit = w.seasonal_baseline_mm > 0
      ? ` (baseline ${w.seasonal_baseline_mm.toFixed(0)}mm, deficit ${(w.seasonal_baseline_mm - w.precipitation_mm).toFixed(0)}mm)`
      : ''
    lines.push(
      '',
      `WEATHER DATA (${w.region_code}):`,
      `  Drought risk: ${w.drought_risk_score.toFixed(0)}/100`,
      `  Flood risk: ${w.flood_risk_score.toFixed(0)}/100`,
      `  Precipitation: ${w.precipitation_mm.toFixed(0)}mm${deficit}`,
    )
  }

  if (ctx.commodity) {
    const c = ctx.commodity
    lines.push(
      '',
      'BRENT CRUDE:',
      `  Price: $${c.price_usd.toFixed(2)}/bbl`,
      `  1M: ${c.pct_change_1m > 0 ? '+' : ''}${c.pct_change_1m.toFixed(1)}%  |  3M: ${c.pct_change_3m > 0 ? '+' : ''}${c.pct_change_3m.toFixed(1)}%  |  12M: ${c.pct_change_12m > 0 ? '+' : ''}${c.pct_change_12m.toFixed(1)}%`,
    )
  }

  if (ctx.portfolio) {
    const pf = ctx.portfolio
    lines.push(
      '',
      `PORTFOLIO (${pf.country}):`,
      `  Owed: $${(pf.owed / 1000).toFixed(0)}k  |  Paid: $${(pf.paid / 1000).toFixed(0)}k  |  Repayment rate: ${pf.repaymentRate.toFixed(1)}%`,
      `  Active tractors: ${pf.tractorCount.toLocaleString()}`,
    )
  }

  return lines.join('\n')
}

// Trim to maxChars without cutting mid-word
function trimAtWord(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const cut = text.slice(0, maxChars)
  const lastSentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  if (lastSentence > maxChars * 0.6) return cut.slice(0, lastSentence + 1)
  const lastSpace = cut.lastIndexOf(' ')
  return lastSpace > maxChars * 0.7 ? cut.slice(0, lastSpace) + '…' : cut + '…'
}

export async function POST(request: Request) {
  const body = await request.json()
  const alert = body.alert as Record<string, unknown>
  const context: AlertContext = body.context || {}
  const maxChars: number = typeof body.maxChars === 'number' ? body.maxChars : 500

  const prompt = buildPrompt(alert, context, maxChars)
  const maxTokens = Math.ceil(maxChars / 3) + 20

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.3,
    }),
  })

  if (!res.ok) {
    return NextResponse.json({ summary: 'Summary unavailable.' }, { status: 200 })
  }

  const data = await res.json()
  const raw: string = data.choices?.[0]?.message?.content || 'Summary unavailable.'
  const summary = trimAtWord(raw.trim(), maxChars)
  return NextResponse.json({ summary })
}
