from __future__ import annotations

import logging

import uvicorn
from fastapi import FastAPI

from digest_scheduler import digest_email_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")

app = FastAPI(title="HT Portfolio Digest", version="1.0.0")
app.include_router(digest_email_router)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
