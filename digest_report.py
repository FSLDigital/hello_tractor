"""
Portfolio Command Centre — Email Digest Reports
================================================
Three cadence-aware report functions consumed by digest_scheduler.py and
usable as a standalone script.  Each returns dict[str, str] so FastAPI
endpoints can return them directly.

  run_daily_digest(to, dry_run)   → compact alert-only email; skips if no alerts
  run_weekly_digest(to, dry_run)  → full portfolio digest with AI narrative
  run_monthly_digest(to, dry_run) → same as weekly (extend for month-on-month later)

Standalone:
  python digest_report.py [daily|weekly|monthly]
"""

from __future__ import annotations

import logging
import os
import smtplib
import textwrap
from datetime import date, datetime, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from openai import OpenAI

logger = logging.getLogger(__name__)

# ── Environment ───────────────────────────────────────────────────────────────

def _load_env() -> None:
    here = Path(__file__).resolve().parent
    for p in [here / ".env.local", here / ".env", Path.cwd() / ".env"]:
        if p.exists():
            load_dotenv(p, override=False)
            break


_load_env()

OPENAI_KEY   = os.getenv("OPENAI_API_KEY", "")
SMTP_USER    = os.getenv("SMTP_USER", "")
SMTP_PASS    = os.getenv("SMTP_PASS", "")
SMTP_HOST    = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT    = int(os.getenv("SMTP_PORT", "587"))
TWILIO_SID   = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM  = os.getenv("TWILIO_FROM_NUMBER", "")
RECIP_PHONE  = os.getenv("RECIPIENT_PHONE", "")
DEFAULT_TO   = os.getenv("HT_DIGEST_TO", "ola@hellotractor.com")
DRY_RUN      = os.getenv("HT_DIGEST_DRY_RUN", "false").lower() in {"1", "true", "yes", "on"}
FROM_NAME    = "Portfolio Command Centre"
DATA_PATH    = Path(__file__).parent / "public" / "data" / "treasury_data.xlsx"

_openai = OpenAI(api_key=OPENAI_KEY) if OPENAI_KEY else None


# ── Data Loading ──────────────────────────────────────────────────────────────

def _load_sheets() -> dict[str, pd.DataFrame]:
    xls    = pd.ExcelFile(DATA_PATH)
    sheets = {name: xls.parse(name) for name in xls.sheet_names}
    perf   = sheets.get("HT_Performance")
    if perf is not None:
        for col in ["Amount Owed", "Amount Paid", "Worked Acres", "Covenant Targets"]:
            if col in perf.columns:
                perf[col] = pd.to_numeric(perf[col], errors="coerce").fillna(0)
        sheets["HT_Performance"] = perf
    return sheets


# ── Date helpers ──────────────────────────────────────────────────────────────

def _parse_date(d) -> date | None:
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(str(d).strip(), fmt).date()
        except ValueError:
            continue
    return None


def _parse_ym(ym) -> date | None:
    try:
        return datetime.strptime(str(ym).strip()[:7], "%Y-%m").date()
    except ValueError:
        return None


# ── Metric Computation ────────────────────────────────────────────────────────

def _portfolio_stats(perf: pd.DataFrame) -> dict:
    total_owed = perf["Amount Owed"].sum()
    total_paid = perf["Amount Paid"].sum()
    by_country = (
        perf.groupby("Country")
        .agg(owed=("Amount Owed", "sum"), paid=("Amount Paid", "sum"),
             tractors=("Tractor ID", "nunique"))
        .reset_index()
    )
    by_country["repayment_rate"] = (
        by_country["paid"] / by_country["owed"].replace(0, float("nan")) * 100
    ).round(1).fillna(0)
    return {
        "total_owed":     total_owed,
        "total_paid":     total_paid,
        "repayment_rate": round(total_paid / total_owed * 100, 1) if total_owed else 0,
        "total_tractors": int(perf["Tractor ID"].nunique()),
        "by_country":     by_country.sort_values("owed", ascending=False),
    }


def _latest_pol(pol: pd.DataFrame) -> pd.DataFrame:
    idx = pol.groupby("country_code")["scoring_date"].transform("max") == pol["scoring_date"]
    return pol[idx].drop_duplicates("country_code")


def _latest_weather(wx: pd.DataFrame) -> pd.DataFrame:
    if "source" in wx.columns:
        wx = wx[wx["source"] != "era5_baseline"]
    idx = wx.groupby("region_code")["year_month"].transform("max") == wx["year_month"]
    return wx[idx].drop_duplicates("region_code")


def _utilisation_summary(perf: pd.DataFrame) -> dict:
    covenant = perf["Covenant Targets"].sum()
    worked   = perf["Worked Acres"].sum()
    paid     = perf["Amount Paid"].sum()
    owed     = perf["Amount Owed"].sum()
    return {
        "utilisation_pct": round(worked / covenant * 100, 1) if covenant else 0,
        "implied_per_ha":  round(paid / worked, 2) if worked else 0,
        "repayment_rate":  round(paid / owed * 100, 1) if owed else 0,
    }


def _weighted_pol_risk(pol: pd.DataFrame, perf: pd.DataFrame) -> float:
    latest   = _latest_pol(pol)
    tractors = perf.groupby("Country")["Tractor ID"].nunique().reset_index()
    tractors.columns = ["country_name", "tractors"]
    m = latest.merge(tractors, on="country_name", how="left").fillna({"tractors": 0})
    total = m["tractors"].sum()
    return float((m["score"] * m["tractors"]).sum() / total) if total else float(m["score"].mean())


def _upcoming_repayments(repayments: pd.DataFrame, days: int = 90) -> pd.DataFrame:
    active  = repayments[repayments["status"] == "ACTIVE"].copy()
    today   = date.today()
    cutoff  = today + timedelta(days=days)
    active["_d"] = active["repayment_date"].apply(_parse_date)
    mask    = active["_d"].apply(lambda d: d is not None and today <= d <= cutoff)
    return active[mask].sort_values("_d").drop(columns=["_d"])


# ── Alert Generation ──────────────────────────────────────────────────────────

def _pol_trend_3m(pol: pd.DataFrame, country_code: str, current: float) -> str:
    cutoff = (date.today() - timedelta(days=90)).strftime("%Y-%m-%d")
    hist   = pol[pol["country_code"] == country_code].copy()
    hist["scoring_date"] = hist["scoring_date"].astype(str)
    past   = hist[hist["scoring_date"] <= cutoff].sort_values("scoring_date", ascending=False)
    if past.empty:
        return "No 3-month prior score available"
    prior = float(past.iloc[0]["score"])
    delta = current - prior
    return f"Score {'rose' if delta > 0 else 'fell'} {abs(delta):.0f} pts over 3 months ({prior:.0f} → {current:.0f})"


def _weather_trend_3m(wx: pd.DataFrame, region: str, metric: str, current: float) -> str:
    cutoff = date.today() - timedelta(days=90)
    hist   = wx[wx["region_code"] == region].copy()
    hist["_ym"] = hist["year_month"].apply(_parse_ym)
    past   = hist[hist["_ym"].apply(lambda d: d is not None and d <= cutoff)].sort_values("_ym", ascending=False)
    if past.empty:
        return "No 3-month prior data available"
    col   = "drought_risk_score" if metric == "drought" else "flood_risk_score"
    prior = float(past.iloc[0][col])
    delta = current - prior
    return f"{metric.capitalize()} risk {'rose' if delta > 0 else 'fell'} {abs(delta):.0f} pts over 3 months ({prior:.0f} → {current:.0f})"


def _ai_narrative_1s(alert: dict) -> str:
    if not _openai:
        return "OpenAI key not configured."
    prompt = (
        f"One sentence, max 180 chars, specific portfolio risk for an ag-lending firm: "
        f"{alert['message']} (score {alert['metric']:.0f}, threshold {alert['threshold']})"
    )
    resp = _openai.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=60, temperature=0.3,
    )
    return resp.choices[0].message.content.strip()[:180]


def _build_alerts(pol: pd.DataFrame, wx: pd.DataFrame, brent: pd.DataFrame) -> list[dict]:
    alerts = []

    for _, r in _latest_pol(pol).iterrows():
        score = float(r["score"])
        if score < 60:
            continue
        sev = "CRITICAL" if score >= 70 else "WARNING"
        a = dict(severity=sev, category="Political", country=r["country_name"],
                 country_code=r["country_code"],
                 message=f"{r['country_name']} political risk at {score:.0f}/100 ({r['tier']})",
                 metric=score, threshold=70 if sev == "CRITICAL" else 60)
        a["bullet_metric"]    = f"Score: {score:.0f}/100 — tier: {r['tier']}"
        a["bullet_trend"]     = _pol_trend_3m(pol, r["country_code"], score)
        a["bullet_narrative"] = _ai_narrative_1s(a)
        alerts.append(a)

    for _, r in _latest_weather(wx).iterrows():
        drought, flood, region = float(r["drought_risk_score"]), float(r["flood_risk_score"]), r["region_code"]
        if drought > 75:
            a = dict(severity="CRITICAL", category="Weather", country=region.split("-")[0],
                     region_code=region,
                     message=f"Drought risk {drought:.0f}/100 in {region}",
                     metric=drought, threshold=75)
            a["bullet_metric"]    = f"Drought risk: {drought:.0f}/100 in {region}"
            a["bullet_trend"]     = _weather_trend_3m(wx, region, "drought", drought)
            a["bullet_narrative"] = _ai_narrative_1s(a)
            alerts.append(a)
        elif flood > 70:
            a = dict(severity="WARNING", category="Weather", country=region.split("-")[0],
                     region_code=region,
                     message=f"Flood risk {flood:.0f}/100 in {region}",
                     metric=flood, threshold=70)
            a["bullet_metric"]    = f"Flood risk: {flood:.0f}/100 in {region}"
            a["bullet_trend"]     = _weather_trend_3m(wx, region, "flood", flood)
            a["bullet_narrative"] = _ai_narrative_1s(a)
            alerts.append(a)

    bv = brent[brent["price_usd"].notna()].sort_values("price_date", ascending=False)
    if len(bv) and bv.iloc[0]["pct_change_12m"] > 50:
        lb = bv.iloc[0]
        a = dict(severity="WARNING", category="Commodity", country="Global",
                 message=f"Brent crude up {lb['pct_change_12m']:.1f}% YoY — input cost pressure",
                 metric=float(lb["pct_change_12m"]), threshold=50)
        a["bullet_metric"]    = f"Brent: ${lb['price_usd']:.2f}/bbl (+{lb['pct_change_12m']:.1f}% YoY)"
        a["bullet_trend"]     = f"1M {lb['pct_change_1m']:+.1f}%  ·  3M {lb['pct_change_3m']:+.1f}%  ·  12M {lb['pct_change_12m']:+.1f}%"
        a["bullet_narrative"] = _ai_narrative_1s(a)
        alerts.append(a)

    return sorted(alerts, key=lambda x: 0 if x["severity"] == "CRITICAL" else 1)


# ── AI Narrative ──────────────────────────────────────────────────────────────

def _compose_narrative(stats: dict, alerts: list, weighted_risk: float, util: dict) -> str:
    if not _openai:
        return "(OpenAI key not set — narrative unavailable.)"

    alert_lines = "\n".join(
        f"- [{a['severity']}] {a['message']} | {a['bullet_trend']}"
        for a in alerts[:6]
    )
    country_lines = "\n".join(
        f"- {r['Country']}: ${r['owed']/1000:.0f}k owed · {r['repayment_rate']:.1f}% repayment · {int(r['tractors'])} tractors"
        for _, r in stats["by_country"].iterrows()
    )
    prompt = textwrap.dedent(f"""
        Executive portfolio risk digest for Ola, director at Hello Tractor.
        Write 3–4 concise paragraphs (~350 words). Cover: (1) portfolio health & top risk,
        (2) alert interpretation & collections impact, (3) positive signals or mitigants,
        (4) one recommended action. Cite specific numbers. No filler. Body only.

        Portfolio: ${stats['total_owed']/1e6:.2f}M owed · {stats['repayment_rate']}% repayment · {stats['total_tractors']:,} tractors
        Weighted political risk: {weighted_risk:.1f}/100
        Utilisation: {util['utilisation_pct']}%  |  $/ha: ${util['implied_per_ha']:.2f}  |  Collections: {util['repayment_rate']}%

        {country_lines}

        Alerts ({len(alerts)}):
        {alert_lines or 'None'}
    """).strip()

    resp = _openai.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=600, temperature=0.4,
    )
    return resp.choices[0].message.content.strip()


# ── HTML Builders ─────────────────────────────────────────────────────────────

_C = {"green": "#16a34a", "amber": "#d97706", "red": "#dc2626",
      "muted": "#6b7280", "border": "#e5e7eb", "bg": "#f9fafb"}


def _rc(r: float) -> str:
    return _C["green"] if r >= 70 else _C["amber"] if r >= 40 else _C["red"]


def _td(content: str, style: str = "") -> str:
    return f'<td style="padding:9px 10px;border-bottom:1px solid {_C["border"]};{style}">{content}</td>'


def _th(label: str) -> str:
    return (f'<th style="text-align:left;padding:6px 10px;font-size:10px;color:{_C["muted"]};'
            f'font-weight:500;text-transform:uppercase;letter-spacing:.05em;'
            f'border-bottom:2px solid {_C["border"]};">{label}</th>')


def _badge(text: str, color: str) -> str:
    return (f'<span style="background:{color}22;color:{color};padding:2px 8px;'
            f'border-radius:4px;font-size:10px;font-weight:600;font-family:monospace;">{text}</span>')


def _alert_rows_html(alerts: list) -> str:
    rows = ""
    for a in alerts:
        col     = _C["red"] if a["severity"] == "CRITICAL" else _C["amber"]
        bullets = "".join(
            f'<li style="margin:3px 0;font-size:12px;color:#374151;">{b}</li>'
            for b in [a.get("bullet_metric",""), a.get("bullet_trend",""), a.get("bullet_narrative","")]
            if b
        )
        rows += (
            f'<tr>'
            f'<td style="padding:12px 10px;vertical-align:top;border-bottom:1px solid {_C["border"]};">{_badge(a["severity"], col)}</td>'
            f'<td style="padding:12px 10px;vertical-align:top;border-bottom:1px solid {_C["border"]};font-size:11px;color:{_C["muted"]};font-family:monospace;">{a["category"]}</td>'
            f'<td style="padding:12px 10px;vertical-align:top;border-bottom:1px solid {_C["border"]};">'
            f'<div style="font-size:13px;font-weight:500;margin-bottom:6px;">{a["message"]}</div>'
            f'<ul style="margin:0;padding-left:16px;">{bullets}</ul>'
            f'</td>'
            f'</tr>'
        )
    return rows


def _build_html_full(stats: dict, alerts: list, upcoming: pd.DataFrame,
                     util: dict, weighted_risk: float, narrative: str, as_of: str) -> str:
    risk_col = _C["red"] if weighted_risk >= 70 else _C["amber"] if weighted_risk >= 60 else _C["green"]

    kpi_cells = "".join(
        f'<td style="padding:18px 22px;border-right:.5px solid #334155;width:25%;">'
        f'<div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">{lbl}</div>'
        f'<div style="font-size:20px;font-weight:700;color:{col};">{val}</div></td>'
        for lbl, val, col in [
            ("Total Owed",             f"${stats['total_owed']/1e6:.2f}M",    "#f1f5f9"),
            ("Repayment Rate",         f"{stats['repayment_rate']}%",           _rc(stats["repayment_rate"])),
            ("Active Tractors",        f"{stats['total_tractors']:,}",          "#f1f5f9"),
            ("Wtd Avg Political Risk", f"{weighted_risk:.1f}/100",              risk_col),
        ]
    )

    def country_row(r) -> str:
        mono = "font-family:monospace;font-size:12px;"
        return (
            "<tr>"
            + _td(f"<strong>{r['Country']}</strong>")
            + _td(f"${r['owed']/1000:.0f}k", mono)
            + _td(f"${r['paid']/1000:.0f}k", mono + f"color:{_C['green']};")
            + _td(f"{r['repayment_rate']:.1f}%", mono + f"color:{_rc(r['repayment_rate'])};")
            + _td(str(int(r["tractors"])), mono + f"color:{_C['muted']};")
            + "</tr>"
        )

    def rep_row(r) -> str:
        mono = "font-family:monospace;font-size:12px;"
        return (
            "<tr>"
            + _td(str(r["repayment_date"]), mono)
            + _td(str(r.get("facility_name", "")), "font-size:12px;")
            + _td(f"${float(r['repayment_amount_usd']):,.0f}", mono)
            + "</tr>"
        )

    country_rows = "".join(country_row(r) for _, r in stats["by_country"].iterrows())
    rep_rows = (
        "".join(rep_row(r) for _, r in upcoming.head(6).iterrows())
        if not upcoming.empty
        else f'<tr><td colspan="3" style="padding:10px;color:{_C["muted"]};font-size:13px;">No repayments due in the next 90 days.</td></tr>'
    )
    narrative_html = "".join(
        f'<p style="margin:0 0 14px;color:#374151;line-height:1.75;font-size:14px;">{p}</p>'
        for p in narrative.split("\n\n") if p.strip()
    )
    alerts_section = ""
    if alerts:
        rows_html = _alert_rows_html(alerts)
        alerts_section = (
            f'<div style="margin-bottom:30px;">'
            f'<div style="font-size:10px;color:{_C["muted"]};text-transform:uppercase;letter-spacing:.07em;font-weight:600;margin-bottom:12px;">Active Alerts — {len(alerts)} triggered</div>'
            f'<table style="width:100%;border-collapse:collapse;"><thead><tr>{_th("Sev")}{_th("Category")}{_th("Alert + 3-bullet context")}</tr></thead>'
            f'<tbody>{rows_html}</tbody></table></div>'
        )
    metric_cells = "".join(
        f'<td style="padding:14px 18px;text-align:center;border-right:1px solid {_C["border"]};">'
        f'<div style="font-size:10px;color:{_C["muted"]};text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">{lbl}</div>'
        f'<div style="font-size:20px;font-weight:700;color:{col};">{val}</div></td>'
        for lbl, val, col in [
            ("% Utilisation",    f"{util['utilisation_pct']}%",   _rc(util["utilisation_pct"])),
            ("Implied $/ha",     f"${util['implied_per_ha']:.2f}", "#374151"),
            ("Collections Rate", f"{util['repayment_rate']}%",    _rc(util["repayment_rate"])),
        ]
    )

    return f"""<!DOCTYPE html><html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;">
<tr><td align="center" style="padding:32px 16px;">
<table width="660" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.1);">
  <tr><td style="background:#0f172a;padding:26px 32px;">
    <div style="font-size:10px;color:#94a3b8;letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px;">Hello Tractor · Portfolio Command Centre</div>
    <div style="font-size:22px;font-weight:700;color:#f1f5f9;">Weekly Risk Digest</div>
    <div style="font-size:12px;color:#64748b;margin-top:4px;">As of {as_of}</div>
  </td></tr>
  <tr><td style="background:#1e293b;padding:0;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>{kpi_cells}</tr></table>
  </td></tr>
  <tr><td style="padding:30px 32px;">
    <div style="margin-bottom:28px;">
      <div style="font-size:10px;color:{_C['muted']};text-transform:uppercase;letter-spacing:.07em;font-weight:600;margin-bottom:14px;">Executive Summary</div>
      {narrative_html}
    </div>
    {alerts_section}
    <div style="margin-bottom:28px;">
      <div style="font-size:10px;color:{_C['muted']};text-transform:uppercase;letter-spacing:.07em;font-weight:600;margin-bottom:12px;">Country Breakdown</div>
      <table width="100%" cellpadding="0" cellspacing="0">
        <thead><tr>{_th("Country")}{_th("Owed")}{_th("Paid")}{_th("Rate")}{_th("Tractors")}</tr></thead>
        <tbody>{country_rows}</tbody>
      </table>
    </div>
    <div style="margin-bottom:28px;background:{_C['bg']};border-radius:10px;overflow:hidden;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td colspan="3" style="padding:12px 18px;font-size:10px;color:{_C['muted']};text-transform:uppercase;letter-spacing:.07em;font-weight:600;border-bottom:1px solid {_C['border']};">Operational Metrics (12-month window)</td></tr>
        <tr>{metric_cells}</tr>
      </table>
    </div>
    <div>
      <div style="font-size:10px;color:{_C['muted']};text-transform:uppercase;letter-spacing:.07em;font-weight:600;margin-bottom:12px;">Upcoming Repayments — next 90 days</div>
      <table width="100%" cellpadding="0" cellspacing="0">
        <thead><tr>{_th("Date")}{_th("Facility")}{_th("Amount (USD)")}</tr></thead>
        <tbody>{rep_rows}</tbody>
      </table>
    </div>
  </td></tr>
  <tr><td style="background:#f8fafc;border-top:1px solid {_C['border']};padding:14px 32px;text-align:center;">
    <div style="font-size:11px;color:#9ca3af;">Generated by <strong>Portfolio Command Centre</strong> · {as_of}</div>
  </td></tr>
</table>
</td></tr></table>
</body></html>"""


def _build_html_daily(alerts: list, as_of: str) -> str:
    """Compact HTML for the daily alert-only email."""
    rows_html = _alert_rows_html(alerts)
    crit = sum(1 for a in alerts if a["severity"] == "CRITICAL")
    warn = sum(1 for a in alerts if a["severity"] == "WARNING")
    return f"""<!DOCTYPE html><html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;">
<tr><td align="center" style="padding:32px 16px;">
<table width="620" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.1);">
  <tr><td style="background:#0f172a;padding:22px 28px;">
    <div style="font-size:10px;color:#94a3b8;letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px;">Hello Tractor · Portfolio Command Centre</div>
    <div style="font-size:20px;font-weight:700;color:#f1f5f9;">Daily Alert Digest</div>
    <div style="font-size:12px;color:#64748b;margin-top:4px;">{as_of} · {crit} critical · {warn} warning</div>
  </td></tr>
  <tr><td style="padding:24px 28px;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <thead><tr>{_th("Sev")}{_th("Category")}{_th("Alert + 3-bullet context")}</tr></thead>
      <tbody>{rows_html}</tbody>
    </table>
  </td></tr>
  <tr><td style="background:#f8fafc;border-top:1px solid {_C['border']};padding:12px 28px;text-align:center;">
    <div style="font-size:11px;color:#9ca3af;">Portfolio Command Centre · {as_of}</div>
  </td></tr>
</table>
</td></tr></table>
</body></html>"""


# ── Delivery ──────────────────────────────────────────────────────────────────

def _build_plain(subject: str, stats: dict | None, alerts: list,
                 util: dict | None, weighted_risk: float | None, narrative: str) -> str:
    lines = [subject, "=" * len(subject), "", narrative, ""]
    if alerts:
        lines += ["ALERTS", "------"]
        for a in alerts:
            lines += [f"[{a['severity']}] {a['message']}",
                      f"  • {a.get('bullet_metric','')}",
                      f"  • {a.get('bullet_trend','')}",
                      f"  • {a.get('bullet_narrative','')}", ""]
    if stats:
        lines += [
            "PORTFOLIO", "---------",
            f"  Owed: ${stats['total_owed']/1e6:.2f}M  |  Rate: {stats['repayment_rate']}%  |  Tractors: {stats['total_tractors']:,}",
        ]
    return "\n".join(lines)


def _deliver(to: str, subject: str, html: str, plain: str, dry_run: bool) -> dict[str, str]:
    if dry_run:
        preview = Path(__file__).parent / "digest_preview.html"
        preview.write_text(html, encoding="utf-8")
        logger.info("dry_run — preview saved to %s", preview)
        return {"status": "dry_run", "to": to, "subject": subject, "preview": str(preview)}

    if not SMTP_USER or not SMTP_PASS:
        preview = Path(__file__).parent / "digest_preview.html"
        preview.write_text(html, encoding="utf-8")
        logger.warning("SMTP not configured — saved to %s", preview)
        return {"status": "no_smtp", "to": to, "subject": subject, "preview": str(preview)}

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = f"{FROM_NAME} <{SMTP_USER}>"
    msg["To"]      = to
    msg.attach(MIMEText(plain, "plain"))
    msg.attach(MIMEText(html, "html"))
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as srv:
        srv.ehlo(); srv.starttls(); srv.login(SMTP_USER, SMTP_PASS)
        srv.sendmail(SMTP_USER, to, msg.as_string())
    logger.info("email sent → %s | %s", to, subject)
    return {"status": "sent", "to": to, "subject": subject}


def _send_sms(body: str) -> None:
    if not all([TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM, RECIP_PHONE]):
        logger.warning("Twilio not configured — SMS skipped")
        return
    try:
        from twilio.rest import Client
        Client(TWILIO_SID, TWILIO_TOKEN).messages.create(body=body, from_=TWILIO_FROM, to=RECIP_PHONE)
        logger.info("SMS sent → %s", RECIP_PHONE)
    except ImportError:
        logger.warning("pip install twilio required for SMS delivery")
    except Exception as exc:
        logger.error("SMS failed: %s", exc)


# ── Public API ────────────────────────────────────────────────────────────────

def run_daily_digest(to: str = DEFAULT_TO, dry_run: bool = DRY_RUN) -> dict[str, str]:
    """
    Compact alert-only email.  Skips delivery entirely if no alerts are active.
    CRITICAL alerts also trigger an SMS.
    """
    logger.info("run_daily_digest to=%s dry_run=%s", to, dry_run)
    sheets  = _load_sheets()
    alerts  = _build_alerts(sheets["Political_Risk"], sheets["Weather_Forecast"], sheets["Brent_Crude"])

    if not alerts:
        logger.info("daily digest: no active alerts — skipping")
        return {"status": "skipped", "reason": "no_active_alerts"}

    as_of   = datetime.today().strftime("%d %b %Y")
    subject = f"[HT Portfolio] Daily Alert Digest — {as_of} ({sum(1 for a in alerts if a['severity']=='CRITICAL')} critical)"
    html    = _build_html_daily(alerts, as_of)
    plain   = _build_plain(subject, None, alerts, None, None, "")
    result  = _deliver(to, subject, html, plain, dry_run)

    critical = [a for a in alerts if a["severity"] == "CRITICAL"]
    if critical and result["status"] in {"sent", "dry_run"}:
        sms = f"[HT CRITICAL — {as_of}]\n" + "\n".join(f"• {a['message']}" for a in critical)
        _send_sms(sms)

    return result


def run_weekly_digest(to: str = DEFAULT_TO, dry_run: bool = DRY_RUN) -> dict[str, str]:
    """Full portfolio digest with AI narrative.  Always sends."""
    logger.info("run_weekly_digest to=%s dry_run=%s", to, dry_run)
    sheets        = _load_sheets()
    perf, pol, wx = sheets["HT_Performance"], sheets["Political_Risk"], sheets["Weather_Forecast"]
    stats         = _portfolio_stats(perf)
    util          = _utilisation_summary(perf)
    weighted_risk = _weighted_pol_risk(pol, perf)
    upcoming      = _upcoming_repayments(sheets["Repayment_Schedule"])
    alerts        = _build_alerts(pol, wx, sheets["Brent_Crude"])
    narrative     = _compose_narrative(stats, alerts, weighted_risk, util)
    as_of         = datetime.today().strftime("%d %b %Y")
    subject       = f"[HT Portfolio] Weekly Risk Digest — {as_of}"
    html          = _build_html_full(stats, alerts, upcoming, util, weighted_risk, narrative, as_of)
    plain         = _build_plain(subject, stats, alerts, util, weighted_risk, narrative)
    result        = _deliver(to, subject, html, plain, dry_run)

    critical = [a for a in alerts if a["severity"] == "CRITICAL"]
    if critical and result["status"] in {"sent", "dry_run"}:
        sms = f"[HT CRITICAL — {as_of}]\n" + "\n".join(f"• {a['message']}" for a in critical)
        _send_sms(sms)

    return result


def run_monthly_digest(to: str = DEFAULT_TO, dry_run: bool = DRY_RUN) -> dict[str, str]:
    """Month-end full digest — same content as weekly, subject line differs."""
    logger.info("run_monthly_digest to=%s dry_run=%s", to, dry_run)
    result = run_weekly_digest(to=to, dry_run=dry_run)
    # Patch subject line to say Monthly instead of Weekly
    result["subject"] = result.get("subject", "").replace("Weekly", "Monthly")
    return result


# ── Standalone entry point ────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    cadence = sys.argv[1] if len(sys.argv) > 1 else "weekly"
    fn = {"daily": run_daily_digest, "weekly": run_weekly_digest, "monthly": run_monthly_digest}.get(cadence)
    if not fn:
        print(f"Unknown cadence '{cadence}'. Use: daily | weekly | monthly")
        sys.exit(1)
    result = fn()
    print(result)
