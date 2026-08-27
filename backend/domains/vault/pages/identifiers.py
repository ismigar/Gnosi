"""Validation for page and history identifiers used in filesystem paths."""

import re

from fastapi import HTTPException

PAGE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
HISTORY_TIMESTAMP_RE = re.compile(r"^\d{8}_\d{6}$")


def validate_safe_page_id(page_id: str) -> str:
    """Return a safe path-segment page id or raise HTTP 400."""
    normalized = str(page_id or "").strip()
    if not normalized or not PAGE_ID_RE.match(normalized) or normalized.startswith("."):
        raise HTTPException(status_code=400, detail="Invalid page_id")
    return normalized


def validate_history_timestamp(timestamp: str) -> str:
    """Return a safe history timestamp or raise HTTP 400."""
    normalized = str(timestamp or "").strip()
    if not normalized or not HISTORY_TIMESTAMP_RE.match(normalized):
        raise HTTPException(status_code=400, detail="Invalid timestamp")
    return normalized


__all__ = [
    "HISTORY_TIMESTAMP_RE",
    "PAGE_ID_RE",
    "validate_history_timestamp",
    "validate_safe_page_id",
]
