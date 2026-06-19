import { NextResponse } from 'next/server'
import type { AlertContext } from '@/lib/types'

function buildPrompt(alert: Record<string, unknown>, ctx: AlertContext, maxChars: number): string {
  const lines: string[] = [
    'You are a risk analyst for agricultural lending in sub-Saharan Africa.',
    `Search the web for the most recent news (last 30 days) about the country and risk type below, then write a single`,
    `factual paragraph of no more than ${maxChars} characters. Explain WHY this risk is elevated right now, citing`,
    `specific recent events or data you find online alongside the internal metrics provided. End cleanly at a sentence boundary.`,
    '',
    `ALERT: ${String(alert.severity).toUpperCase()} ${alert.category} — ${alert.country}`,
    `Message: ${alert.message}`,
    `Score: ${alert.metric} / threshold ${alert.threshold}`,
  ]

  if (ctx.political) {
    const p = ctx.political
    lines.push(
      '',
      'INTERNAL POLITICAL RISK DATA:',
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
      `INTERNAL WEATHER DATA (${w.region_code}):`,
      `  Drought risk: ${w.drought_risk_score.toFixed(0)}/100`,
      `  Flood risk: ${w.flood_risk_score.toFixed(0)}/100`,
      `  Precipitation: ${w.precipitation_mm.toFixed(0)}mm${deficit}`,
    )
  }

  if (ctx.commodity) {
    const c = ctx.commodity
    lines.push(
      '',
      'INTERNAL COMMODITY DATA:',
      `  Brent crude: $${c.price_usd.toFixed(2)}/bbl`,
      `  1M: ${c.pct_change_1m > 0 ? '+' : ''}${c.pct_change_1m.toFixed(1)}%  |  3M: ${c.pct_change_3m > 0 ? '+' : ''}${c.pct_change_3m.toFixed(1)}%  |  12M: ${c.pct_change_12m > 0 ? '+' : ''}${c.pct_change_12m.toFixed(1)}%`,
    )
  }

  if (ctx.portfolio) {
    const pf = ctx.portfolio
    lines.push(
      '',
      `INTERNAL PORTFOLIO DATA (${pf.country}):`,
      `  Owed: $${(pf.owed / 1000).toFixed(0)}k  |  Paid: $${(pf.paid / 1000).toFixed(0)}k  |  Repayment rate: ${pf.repaymentRate.toFixed(1)}%`,
      `  Active tractors: ${pf.tractorCount.toLocaleString()}`,
    )
  }

  return lines.join('\n')
}

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
  const maxTokens = Math.ceil(maxChars / 3) + 40

  // Try Responses API with web search first
  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        tools: [{ type: 'web_search_preview' }],
        input: prompt,
        max_output_tokens: maxTokens,
      }),
    })

    if (res.ok) {
      const data = await res.json()
      const msgItem = data.output?.find((o: any) => o.type === 'message')
      const textBlock = msgItem?.content?.find((c: any) => c.type === 'output_text')
      const raw: string = textBlock?.text || ''

      if (raw) {
        // Extract unique citations from annotations
        const seen = new Set<string>()
        const citations: { url: string; title: string }[] = []
        for (const ann of (textBlock?.annotations ?? [])) {
          if (ann.type === 'url_citation' && ann.url && !seen.has(ann.url)) {
            seen.add(ann.url)
            citations.push({ url: ann.url, title: ann.title || ann.url })
          }
        }

        // Strip inline citation markers like 【4:0†source】 from the text
        const cleaned = raw.replace(/【[^】]*】/g, '').replace(/\s{2,}/g, ' ').trim()
        return NextResponse.json({ summary: trimAtWord(cleaned, maxChars), citations })
      }
    } else {
      console.error('Responses API error:', res.status, await res.text().catch(() => ''))
    }
  } catch (err) {
    console.error('Responses API fetch failed:', err)
  }

  // Fallback: Chat Completions without web search
  try {
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
      console.error('Chat Completions error:', res.status, await res.json().catch(() => ({})))
      return NextResponse.json({ summary: 'Summary unavailable.', citations: [] }, { status: 200 })
    }

    const data = await res.json()
    const raw: string = data.choices?.[0]?.message?.content || 'Summary unavailable.'
    return NextResponse.json({ summary: trimAtWord(raw.trim(), maxChars), citations: [] })
  } catch (err) {
    console.error('Chat Completions fetch failed:', err)
    return NextResponse.json({ summary: 'Summary unavailable.', citations: [] }, { status: 200 })
  }
}
