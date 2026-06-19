"""
Send the latest active treasury alerts as a branded Gmail email.

Standalone:
  python send_last_alerts_email.py --dry-run
  python send_last_alerts_email.py --to ola@hellotractor.com

The script reuses the dashboard workbook and alert logic from digest_report.py,
then asks OpenAI for an executive email body using portfolio metrics plus
optional web-search context.
"""

from __future__ import annotations

import argparse
import html
import json
import logging
import os
import textwrap
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

import base64
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

from digest_report import (
    DEFAULT_TO,
    DRY_RUN,
    _build_alerts,
    _load_sheets,
    _portfolio_stats,
    _utilisation_summary,
    _weighted_pol_risk,
)

logger = logging.getLogger(__name__)


def _load_env() -> None:
    here = Path(__file__).resolve().parent
    for p in [here / ".env.local", here / ".env", Path.cwd() / ".env"]:
        if p.exists():
            load_dotenv(p, override=False)
            break


_load_env()

OPENAI_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("HT_ALERT_EMAIL_MODEL", "gpt-4o-mini")
DEFAULT_ALERT_TO = os.getenv("HT_ALERT_EMAIL_TO", DEFAULT_TO)

SEARCH_PROVIDER = os.getenv("HT_ALERT_SEARCH_PROVIDER", "tavily").lower()
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "")
SERPER_API_KEY = os.getenv("SERPER_API_KEY", "")
BRAVE_SEARCH_API_KEY = os.getenv("BRAVE_SEARCH_API_KEY", "")


C = {
    "bg": "#0a0e14",
    "surface": "#111820",
    "card": "#151d27",
    "raised": "#1a2434",
    "border": "rgba(255,255,255,0.10)",
    "border_solid": "#263247",
    "text": "#e8edf5",
    "secondary": "#7a8a9e",
    "muted": "#53657a",
    "accent": "#3b82f6",
    "green": "#10b981",
    "amber": "#f59e0b",
    "red": "#ef4444",
    "teal": "#14b8a6",
    "purple": "#8b5cf6",
    "coral": "#f97316",
}


def _money(value: float, currency: str = "") -> str:
    prefix = f"{currency} " if currency else ""
    abs_value = abs(value)
    if abs_value >= 1_000_000:
        return f"{prefix}{value / 1_000_000:.2f}M"
    if abs_value >= 1_000:
        return f"{prefix}{value / 1_000:.0f}k"
    return f"{prefix}{value:,.0f}"


def _num(value: Any, fallback: float = 0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _escape(value: Any) -> str:
    return html.escape(str(value), quote=True)


def _severity_color(severity: str) -> str:
    return C["red"] if severity.upper() == "CRITICAL" else C["amber"]


def _severity_rank(alert: dict[str, Any]) -> tuple[int, float, str]:
    severity = str(alert.get("severity", "")).upper()
    rank = 0 if severity == "CRITICAL" else 1
    return rank, -_num(alert.get("metric")), str(alert.get("message", ""))


def _latest_three_alerts(alerts: list[dict[str, Any]], limit: int = 3) -> list[dict[str, Any]]:
    return sorted(alerts, key=_severity_rank)[:limit]


def _post_json(url: str, payload: dict[str, Any], headers: dict[str, str]) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=18) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _get_json(url: str, headers: dict[str, str]) -> dict[str, Any]:
    req = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(req, timeout=18) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _search_tavily(query: str) -> list[dict[str, str]]:
    if not TAVILY_API_KEY:
        return []
    payload = {
        "api_key": TAVILY_API_KEY,
        "query": query,
        "search_depth": "basic",
        "max_results": 3,
        "include_answer": False,
    }
    data = _post_json("https://api.tavily.com/search", payload, {"Content-Type": "application/json"})
    return [
        {
            "title": str(r.get("title", "")),
            "url": str(r.get("url", "")),
            "snippet": str(r.get("content", "")),
        }
        for r in data.get("results", [])[:3]
    ]


def _search_serper(query: str) -> list[dict[str, str]]:
    if not SERPER_API_KEY:
        return []
    payload = {"q": query, "num": 3}
    data = _post_json(
        "https://google.serper.dev/search",
        payload,
        {"Content-Type": "application/json", "X-API-KEY": SERPER_API_KEY},
    )
    return [
        {
            "title": str(r.get("title", "")),
            "url": str(r.get("link", "")),
            "snippet": str(r.get("snippet", "")),
        }
        for r in data.get("organic", [])[:3]
    ]


def _search_brave(query: str) -> list[dict[str, str]]:
    if not BRAVE_SEARCH_API_KEY:
        return []
    url = "https://api.search.brave.com/res/v1/web/search?q=" + urllib.parse.quote(query) + "&count=3"
    data = _get_json(url, {"Accept": "application/json", "X-Subscription-Token": BRAVE_SEARCH_API_KEY})
    return [
        {
            "title": str(r.get("title", "")),
            "url": str(r.get("url", "")),
            "snippet": str(r.get("description", "")),
        }
        for r in data.get("web", {}).get("results", [])[:3]
    ]


def _search_web(query: str) -> list[dict[str, str]]:
    try:
        if SEARCH_PROVIDER == "serper":
            return _search_serper(query)
        if SEARCH_PROVIDER == "brave":
            return _search_brave(query)
        return _search_tavily(query)
    except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
        logger.warning("web search failed for %r: %s", query, exc)
        return []


def _search_queries(alert: dict[str, Any]) -> list[str]:
    category = str(alert.get("category", "risk")).lower()
    country = str(alert.get("country", "Africa"))
    if category == "political":
        return [
            f"{country} political crisis government instability 2025",
            f"{country} elections protests civil unrest recent news",
            f"{country} political risk agriculture economy latest",
        ]
    if category == "weather":
        region = str(alert.get("region_code", country))
        return [f"{region} drought flood rainfall agriculture forecast latest"]
    if category == "commodity":
        return ["Brent crude oil prices diesel fuel agriculture Africa latest"]
    return [f"{country} treasury risk agriculture lending latest"]


def _collect_web_context(alert: dict[str, Any], enabled: bool) -> list[dict[str, str]]:
    if not enabled:
        return []
    is_political = str(alert.get("category", "")).lower() == "political"
    seen_urls: set[str] = set()
    results: list[dict[str, str]] = []
    for query in _search_queries(alert):
        for item in _search_web(query):
            url = item.get("url", "")
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)
            results.append(item)
    return results[:9 if is_political else 3]


def _explain_political_risk(alert: dict[str, Any], web_results: list[dict[str, str]]) -> str:
    if not OPENAI_KEY:
        return ""
    country = alert.get("country", "")
    context = _web_context_text(web_results) if web_results else (
        "No live web context available — use your training knowledge and note your knowledge cutoff date."
    )
    prompt = textwrap.dedent(f"""
        You are a political risk analyst for Hello Tractor, an agricultural finance company in {country}.

        Alert: {alert["message"]}
        Trend: {alert.get("bullet_trend", "")}

        In 2–3 sentences, explain:
        1. What specific recent events or structural factors are driving political risk elevation in {country}?
        2. How might these directly affect agricultural lending and tractor operations on the ground?

        Be specific. Cite named events or actors where you can. If relying on training knowledge rather than
        live news, say so briefly. Do not restate the score — explain the causes.

        News context:
        {context}
    """).strip()
    try:
        data = _post_json(
            "https://api.openai.com/v1/chat/completions",
            {"model": OPENAI_MODEL, "messages": [{"role": "user", "content": prompt}],
             "max_tokens": 280, "temperature": 0.3},
            {"Authorization": f"Bearer {OPENAI_KEY}", "Content-Type": "application/json"},
        )
        return data["choices"][0]["message"]["content"].strip()
    except Exception as exc:
        logger.warning("political context AI call failed: %s", exc)
        return ""


def _political_intel_section(explanation: str, web_results: list[dict[str, str]]) -> str:
    if not explanation and not web_results:
        return ""
    explanation_html = "".join(
        f'<p style="margin:0 0 10px;color:{C["text"]};line-height:1.7;font-size:13px;">{_escape(p)}</p>'
        for p in explanation.split("\n\n") if p.strip()
    ) if explanation else ""
    sources_html = _source_list(web_results) if web_results else ""
    return f"""
    <div style="height:24px;"></div>
    <div style="background:{C['card']};border:1px solid {C['amber']}44;border-radius:8px;padding:20px 22px;">
      <div style="font-family:'DM Mono',monospace;font-size:10px;color:{C['amber']};text-transform:uppercase;letter-spacing:.10em;margin-bottom:14px;">What's driving this risk?</div>
      {explanation_html}
      {('<div style="margin-top:12px;">' + sources_html + '</div>') if web_results else ""}
    </div>"""


def _web_context_text(results: list[dict[str, str]]) -> str:
    if not results:
        return "No live web-search context was available."
    return "\n".join(
        f"- {r['title']} ({r['url']}): {r['snippet'][:350]}"
        for r in results
    )


_GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.send"]
_HERE = Path(__file__).resolve().parent


def _get_gmail_service():
    token_path = _HERE / "token.json"
    creds_path = _HERE / "credentials.json"
    creds = None
    if token_path.exists():
        creds = Credentials.from_authorized_user_file(str(token_path), _GMAIL_SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(str(creds_path), _GMAIL_SCOPES)
            creds = flow.run_local_server(port=8080)
        token_path.write_text(creds.to_json())
    return build("gmail", "v1", credentials=creds)


def _compose_ai_body(
    alert: dict[str, Any],
    stats: dict[str, Any],
    util: dict[str, Any],
    weighted_risk: float,
    web_results: list[dict[str, str]],
) -> str:
    if not OPENAI_KEY:
        return (
            "AI narrative unavailable — OPENAI_API_KEY not configured. "
            "Review the alert and portfolio sections below."
        )

    country_lines = "\n".join(
        f"- {r['Country']} ({r['currency']}): {_money(_num(r['owed']), r['currency'])} owed, "
        f"{_money(_num(r['paid']), r['currency'])} collected, {r['repayment_rate']:.1f}% repayment, {int(r['tractors'])} tractors"
        for _, r in stats["by_country"].iterrows()
    )
    prompt = textwrap.dedent(f"""
        You are a treasury risk analyst for Hello Tractor, an agri-finance and tractor services business.
        Write the body of an email to Ola about a single active alert. Use exactly three short paragraphs
        and a final "Recommended action:" sentence. Be direct, executive, and specific. Cite workbook
        metrics and use the web context only as supporting context. Do not invent facts beyond the provided
        data. Do not include a greeting or signoff. Amounts are in each country's local currency.

        Alert:
        - Severity: {alert['severity']}
        - Category: {alert.get('category', '')}
        - Message: {alert['message']}
        - Metric: {alert.get('bullet_metric', '')}
        - Trend: {alert.get('bullet_trend', '')}
        {"- For this political risk alert: focus on the operational and financial impact on Hello Tractor's portfolio in this country. Reference the causal events from the news context if available." if str(alert.get("category","")).lower() == "political" else ""}

        Portfolio (amounts in local currencies per market):
        - Active tractors: {stats['total_tractors']:,}
        - Portfolio repayment rate: {stats['repayment_rate']}%
        - Weighted political risk: {weighted_risk:.1f}/100
        - Utilisation: {util['utilisation_pct']}%
        - Implied collections/ha: {util['implied_per_ha']:.2f} (local CCY)

        Country exposures:
        {country_lines}

        Web-search context:
        {_web_context_text(web_results)}
    """).strip()

    try:
        data = _post_json(
            "https://api.openai.com/v1/chat/completions",
            {
                "model": OPENAI_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 520,
                "temperature": 0.35,
            },
            {
                "Authorization": f"Bearer {OPENAI_KEY}",
                "Content-Type": "application/json",
            },
        )
        return data["choices"][0]["message"]["content"].strip()
    except Exception as exc:
        logger.warning("AI narrative failed: %s", exc)
        return f"AI narrative unavailable ({exc}). Review the alert detail and portfolio metrics below."


def _paragraphs(text: str) -> str:
    parts = [p.strip() for p in text.split("\n\n") if p.strip()]
    if len(parts) == 1:
        parts = [line.strip() for line in text.splitlines() if line.strip()]
    return "".join(
        f'<p style="margin:0 0 14px;color:{C["text"]};line-height:1.72;font-size:14px;">{_escape(p)}</p>'
        for p in parts
    )


def _metric_card(label: str, value: str, color: str = "", subtitle: str = "") -> str:
    value_color = color or C["text"]
    subtitle_html = (
        f'<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:{C["muted"]};margin-top:4px;">{_escape(subtitle)}</div>'
        if subtitle else ""
    )
    return f"""
    <td style="width:25%;padding:16px 18px;border-right:1px solid {C['border_solid']};">
      <div style="font-family:'DM Mono',monospace;font-size:10px;color:{C['secondary']};text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;">{_escape(label)}</div>
      <div style="font-family:'Syne','DM Sans',Arial,sans-serif;font-size:20px;line-height:1.1;font-weight:700;color:{value_color};">{_escape(value)}</div>
      {subtitle_html}
    </td>
    """


def _badge(text: str, color: str) -> str:
    return (
        f'<span style="display:inline-block;background:{color}22;color:{color};border:1px solid {color}55;'
        f'padding:3px 8px;border-radius:6px;font-family:\'DM Mono\',monospace;font-size:10px;font-weight:600;'
        f'letter-spacing:.04em;">{_escape(text)}</span>'
    )


def _alert_card(alert: dict[str, Any]) -> str:
    color = _severity_color(str(alert.get("severity", "")))
    bullets = [
        alert.get("bullet_metric", ""),
        alert.get("bullet_trend", ""),
        alert.get("bullet_narrative", ""),
    ]
    bullet_html = "".join(
        f'<li style="margin:5px 0;color:{C["secondary"]};font-size:12px;line-height:1.55;">{_escape(b)}</li>'
        for b in bullets if b
    )
    return f"""
    <tr>
      <td style="padding:14px 0;border-bottom:1px solid {C['border_solid']};">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="width:96px;vertical-align:top;">{_badge(str(alert.get("severity", "")), color)}</td>
            <td style="vertical-align:top;">
              <div style="font-family:'DM Mono',monospace;font-size:10px;color:{C['muted']};text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px;">{_escape(alert.get("category", ""))}</div>
              <div style="font-size:14px;color:{C['text']};font-weight:600;margin-bottom:8px;">{_escape(alert.get("message", ""))}</div>
              <ul style="margin:0;padding-left:17px;">{bullet_html}</ul>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    """


def _source_list(results: list[dict[str, str]]) -> str:
    if not results:
        return f'<div style="color:{C["secondary"]};font-size:12px;line-height:1.6;">No online search results were attached for this run.</div>'
    rows = ""
    for r in results:
        rows += f"""
        <tr>
          <td style="padding:9px 0;border-bottom:1px solid {C['border_solid']};">
            <a href="{_escape(r['url'])}" style="color:{C['accent']};font-size:12px;font-weight:600;text-decoration:none;">{_escape(r['title'])}</a>
            <div style="color:{C['secondary']};font-size:11px;line-height:1.5;margin-top:3px;">{_escape(r['snippet'][:220])}</div>
          </td>
        </tr>
        """
    return f'<table width="100%" cellpadding="0" cellspacing="0">{rows}</table>'



def _build_html_email(
    alert: dict[str, Any],
    all_alerts: list[dict[str, Any]],
    stats: dict[str, Any],
    weighted_risk: float,
    narrative: str,
    web_results: list[dict[str, str]],
    as_of: str,
    political_section: str = "",
    repayment_subtitle: str = "",
) -> str:
    sev_color = _severity_color(str(alert.get("severity", "")))
    risk_color = C["red"] if weighted_risk >= 70 else C["amber"] if weighted_risk >= 60 else C["green"]
    repayment_color = C["green"] if stats["repayment_rate"] >= 70 else C["amber"] if stats["repayment_rate"] >= 40 else C["red"]
    other_alerts_html = "".join(_alert_card(a) for a in all_alerts)

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@600;700&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:{C['bg']};font-family:'DM Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:{C['bg']};">
    <tr>
      <td align="center" style="padding:32px 14px;">
        <table width="700" cellpadding="0" cellspacing="0" style="width:700px;max-width:100%;background:{C['surface']};border:1px solid {C['border_solid']};border-radius:8px;overflow:hidden;">
          <tr>
            <td style="padding:28px 32px;background:{C['surface']};border-bottom:1px solid {C['border_solid']};">
              <div style="font-family:'DM Mono',monospace;font-size:10px;color:{C['secondary']};letter-spacing:.12em;text-transform:uppercase;margin-bottom:10px;">Hello Tractor · Treasury Risk Engine</div>
              <div style="margin-bottom:12px;">{_badge(str(alert.get("severity","")), sev_color)}</div>
              <div style="font-family:'Syne','DM Sans',Arial,sans-serif;font-size:24px;line-height:1.2;font-weight:700;color:{C['text']};">{_escape(alert.get("message",""))}</div>
              <div style="margin-top:8px;color:{C['secondary']};font-size:12px;">{_escape(as_of)} · sent to Ola</div>
            </td>
          </tr>
          <tr>
            <td style="background:{C['raised']};">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  {_metric_card("Active markets", str(len(stats["by_country"])))}
                  {_metric_card("Overall Repayment %", f'{stats["repayment_rate"]:.1f}%', repayment_color, repayment_subtitle)}
                  {_metric_card("Tractors", f'{stats["total_tractors"]:,}')}
                  {_metric_card("Pol. risk", f'{weighted_risk:.1f}/100', risk_color)}
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px;">
              <div style="font-family:'DM Mono',monospace;font-size:10px;color:{C['secondary']};text-transform:uppercase;letter-spacing:.10em;margin-bottom:12px;">Risk analysis</div>
              {_paragraphs(narrative)}

              {political_section}

              <div style="height:24px;"></div>
              <div style="font-family:'DM Mono',monospace;font-size:10px;color:{C['secondary']};text-transform:uppercase;letter-spacing:.10em;margin-bottom:8px;">Active alerts ({len(all_alerts)})</div>
              <table width="100%" cellpadding="0" cellspacing="0">{other_alerts_html}</table>

              {('<div style="height:24px;"></div><div style="font-family:\'DM Mono\',monospace;font-size:10px;color:' + C["secondary"] + ';text-transform:uppercase;letter-spacing:.10em;margin-bottom:8px;">Online context used</div>' + _source_list(web_results)) if not political_section and web_results else ""}
            </td>
          </tr>
          <tr>
            <td style="background:{C['card']};border-top:1px solid {C['border_solid']};padding:14px 32px;text-align:center;color:{C['muted']};font-size:11px;">
              Generated by Treasury Risk Engine · {datetime.now().strftime("%Y-%m-%d %H:%M")}
              &nbsp;·&nbsp;
              <a href="https://hello-tractor.vercel.app/" style="color:{C['accent']};text-decoration:none;font-weight:600;">Open Treasury Dashboard ↗</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def _deliver_single(to: str, subject: str, html: str, plain: str, dry_run: bool, idx: int) -> dict[str, str]:
    if dry_run:
        preview = Path(__file__).parent / f"digest_preview_{idx}.html"
        preview.write_text(html, encoding="utf-8")
        logger.info("dry_run — preview saved to %s", preview)
        return {"status": "dry_run", "to": to, "subject": subject, "preview": str(preview)}

    msg = MIMEMultipart("alternative")
    msg["To"] = to
    msg["Subject"] = subject
    msg.attach(MIMEText(plain, "plain"))
    msg.attach(MIMEText(html, "html"))
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    service = _get_gmail_service()
    result = service.users().messages().send(userId="me", body={"raw": raw}).execute()
    logger.info("email sent → %s | %s (id=%s)", to, subject, result.get("id"))
    return {"status": "sent", "to": to, "subject": subject, "message_id": result.get("id", "")}


def run_last_alerts_email(
    to: str = DEFAULT_ALERT_TO,
    dry_run: bool = DRY_RUN,
    limit: int = 3,
    include_search: bool = True,
) -> list[dict[str, str]]:
    logger.info("run_last_alerts_email to=%s dry_run=%s limit=%s include_search=%s", to, dry_run, limit, include_search)
    sheets = _load_sheets()
    perf = sheets["HT_Performance"]
    pol = sheets["Political_Risk"]
    wx = sheets["Weather_Forecast"]

    all_alerts = _build_alerts(pol, wx, sheets["Brent_Crude"])
    alerts = _latest_three_alerts(all_alerts, limit=limit)
    if not alerts:
        return [{"status": "skipped", "reason": "no_active_alerts"}]

    stats = _portfolio_stats(perf)
    util = _utilisation_summary(perf)
    weighted_risk = _weighted_pol_risk(pol, perf)
    as_of = datetime.today().strftime("%d %b %Y")

    yr_col = "year" if "year" in perf.columns else None
    if yr_col:
        yr_min = int(perf[yr_col].min())
        yr_max = int(perf[yr_col].max())
        repayment_subtitle = f"{yr_min}–{yr_max}" if yr_min != yr_max else str(yr_min)
    else:
        repayment_subtitle = ""

    if OPENAI_KEY:
        try:
            _post_json(
                "https://api.openai.com/v1/chat/completions",
                {"model": OPENAI_MODEL, "messages": [{"role": "user", "content": "ping"}], "max_tokens": 1},
                {"Authorization": f"Bearer {OPENAI_KEY}", "Content-Type": "application/json"},
            )
        except Exception:
            pass

    results = []
    for idx, alert in enumerate(alerts, start=1):
        is_political = str(alert.get("category", "")).lower() == "political"
        web_results = _collect_web_context(alert, include_search)
        pol_explanation = _explain_political_risk(alert, web_results) if is_political else ""
        pol_section = _political_intel_section(pol_explanation, web_results) if is_political else ""
        narrative = _compose_ai_body(alert, stats, util, weighted_risk, web_results)
        subject = f"Treasury Risk Engine: {alert['message']}"
        html_body = _build_html_email(
            alert, alerts, stats, weighted_risk, narrative, web_results, as_of,
            political_section=pol_section,
            repayment_subtitle=repayment_subtitle,
        )
        plain = (
            f"{subject}\n{'=' * len(subject)}\n\n{narrative}\n\n"
            f"[{alert['severity']}] {alert['message']}\n"
            f"  • {alert.get('bullet_metric', '')}\n"
            f"  • {alert.get('bullet_trend', '')}\n"
            f"  • {alert.get('bullet_narrative', '')}\n"
        )
        if is_political and pol_explanation:
            plain += f"\nWhat's driving this risk?\n{pol_explanation}\n"
        result = _deliver_single(to, subject, html_body, plain, dry_run, idx)
        results.append(result)
        logger.info("alert %d/%d delivered: %s", idx, len(alerts), result["status"])

    return results


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Send the latest three active treasury alerts by email.")
    parser.add_argument("--to", default=DEFAULT_ALERT_TO, help="Recipient email address.")
    parser.add_argument("--dry-run", action="store_true", help="Write digest_preview.html instead of sending.")
    parser.add_argument("--limit", type=int, default=3, help="Number of active alerts to include.")
    parser.add_argument("--no-search", action="store_true", help="Skip online search context.")
    return parser.parse_args()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    args = _parse_args()
    result = run_last_alerts_email(
        to=args.to,
        dry_run=args.dry_run or DRY_RUN,
        limit=args.limit,
        include_search=not args.no_search,
    )
    print(result)
