"""Ordered middleware composition for Gnosi's FastAPI application."""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from backend.services.active_vault_middleware import ActiveVaultMiddleware


LOOPBACK_ORIGIN_RE = r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$"


def register_middleware(app: FastAPI) -> None:
    """Install CORS, compression and active-vault context in legacy order."""
    origins_env = os.environ.get("CORS_ORIGINS", "").strip()
    origins = [origin.strip() for origin in origins_env.split(",") if origin.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_origin_regex=None if origins else LOOPBACK_ORIGIN_RE,
        allow_credentials=bool(origins_env),
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.add_middleware(ActiveVaultMiddleware)
