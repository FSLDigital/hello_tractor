from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from fastapi import APIRouter, Depends
from fastapi.security import OAuth2PasswordBearer

from digest_report import run_daily_digest, run_weekly_digest, run_monthly_digest
from send_last_alerts_email import DEFAULT_ALERT_TO, run_last_alerts_email


logger = logging.getLogger(__name__)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

digest_email_router = APIRouter(
    prefix="/portfolio-digest-email",
    tags=["portfolio-digest-email"],
    dependencies=[Depends(oauth2_scheme)],
)

_daily_task:   asyncio.Task | None = None
_weekly_task:  asyncio.Task | None = None
_monthly_task: asyncio.Task | None = None


def _load_env() -> None:
    here = Path(__file__).resolve().parent
    for env_path in [here / ".env.local", here / ".env", Path.cwd() / ".env"]:
        if env_path.exists():
            load_dotenv(env_path, override=False)


_load_env()

TZ         = ZoneInfo(os.getenv("HT_DIGEST_TIMEZONE", "Africa/Nairobi"))
RUN_HOUR   = 8
RUN_MIN    = 0
DEFAULT_TO = os.getenv("HT_DIGEST_TO", "ola@hellotractor.com")
DRY_RUN    = os.getenv("HT_DIGEST_DRY_RUN", "false").lower() in {"1", "true", "yes", "on"}


# ─────────────────────────────────────────────────────────────
# NEXT-RUN CALCULATORS
# ─────────────────────────────────────────────────────────────

def _next_daily(now: datetime) -> datetime:
    """Every day at 08:00 EAT."""
    candidate = now.replace(hour=RUN_HOUR, minute=RUN_MIN, second=0, microsecond=0)
    if candidate <= now:
        candidate += timedelta(days=1)
    return candidate


def _next_weekly(now: datetime) -> datetime:
    """Every Monday at 08:00 EAT — reports on the completed Mon–Sun week."""
    days_to_monday = (7 - now.weekday()) % 7
    candidate = (now + timedelta(days=days_to_monday)).replace(
        hour=RUN_HOUR, minute=RUN_MIN, second=0, microsecond=0
    )
    if candidate <= now:
        candidate += timedelta(weeks=1)
    return candidate


def _next_monthly(now: datetime) -> datetime:
    """1st of every month at 08:00 EAT — reports on the completed previous month."""
    if now.day == 1 and (now.hour, now.minute) < (RUN_HOUR, RUN_MIN):
        return now.replace(hour=RUN_HOUR, minute=RUN_MIN, second=0, microsecond=0)
    year, month = now.year, now.month
    if month == 12:
        year, month = year + 1, 1
    else:
        month += 1
    return datetime(year, month, 1, RUN_HOUR, RUN_MIN, 0, tzinfo=now.tzinfo)


# ─────────────────────────────────────────────────────────────
# SCHEDULING LOOPS
# ─────────────────────────────────────────────────────────────

async def _loop(name: str, next_fn, job_fn) -> None:
    while True:
        now = datetime.now(tz=TZ)
        next_run = next_fn(now)
        wait_seconds = max(1, int((next_run - now).total_seconds()))
        logger.info("%s next run at %s", name, next_run.isoformat())
        await asyncio.sleep(wait_seconds)
        try:
            await asyncio.to_thread(job_fn)
        except Exception:
            logger.exception("%s scheduled run failed", name)


def _run_daily()   -> dict[str, str]: return run_daily_digest(to=DEFAULT_TO, dry_run=DRY_RUN)
def _run_weekly()  -> dict[str, str]: return run_weekly_digest(to=DEFAULT_TO, dry_run=DRY_RUN)
def _run_monthly() -> dict[str, str]: return run_monthly_digest(to=DEFAULT_TO, dry_run=DRY_RUN)
def _run_last_alerts() -> dict[str, str]: return run_last_alerts_email(to=DEFAULT_ALERT_TO, dry_run=DRY_RUN)


# ─────────────────────────────────────────────────────────────
# FASTAPI LIFECYCLE
# ─────────────────────────────────────────────────────────────

@digest_email_router.on_event("startup")
async def startup_digest_scheduler() -> None:
    global _daily_task, _weekly_task, _monthly_task
    if _daily_task is None or _daily_task.done():
        _daily_task = asyncio.create_task(_loop("daily_digest", _next_daily, _run_daily))
        logger.info("daily digest scheduler started")
    if _weekly_task is None or _weekly_task.done():
        _weekly_task = asyncio.create_task(_loop("weekly_digest", _next_weekly, _run_weekly))
        logger.info("weekly digest scheduler started")
    if _monthly_task is None or _monthly_task.done():
        _monthly_task = asyncio.create_task(_loop("monthly_digest", _next_monthly, _run_monthly))
        logger.info("monthly digest scheduler started")


@digest_email_router.on_event("shutdown")
async def shutdown_digest_scheduler() -> None:
    global _daily_task, _weekly_task, _monthly_task
    for task, name in [
        (_daily_task,   "daily"),
        (_weekly_task,  "weekly"),
        (_monthly_task, "monthly"),
    ]:
        if task is not None:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            logger.info("%s digest scheduler stopped", name)
    _daily_task = _weekly_task = _monthly_task = None


# ─────────────────────────────────────────────────────────────
# ENDPOINTS
# ─────────────────────────────────────────────────────────────

@digest_email_router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@digest_email_router.post("/run-now/daily")
async def run_now_daily() -> dict[str, str]:
    return await asyncio.to_thread(_run_daily)


@digest_email_router.post("/run-now/weekly")
async def run_now_weekly() -> dict[str, str]:
    return await asyncio.to_thread(_run_weekly)


@digest_email_router.post("/run-now/monthly")
async def run_now_monthly() -> dict[str, str]:
    return await asyncio.to_thread(_run_monthly)


@digest_email_router.post("/run-now/last-alerts")
async def run_now_last_alerts() -> dict[str, str]:
    return await asyncio.to_thread(_run_last_alerts)
