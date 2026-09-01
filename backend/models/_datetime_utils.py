"""Helpers to ensure `datetime` fields always come out with timezone
info in the serialized ISO string.

Without this, `DateTime` columns (without `timezone=True`) that store
`datetime.now(timezone.utc)` return a naive `datetime` in SQLAlchemy,
and Pydantic serializes it as `"2026-05-12T18:55:00"`. The browser then
runs `new Date(iso).toLocaleString()`, interpreting the string as **local
time**, and the column appears 1-2 hours behind in the UI.

By convention, every `default=lambda: datetime.now(timezone.utc)`
in the repo stores UTC; for old naive entries we assume this
convention and attach `tzinfo=UTC` to them before serializing.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, overload


@overload
def normalize_utc(v: None) -> None: ...


@overload
def normalize_utc(v: datetime) -> str: ...


def normalize_utc(v: Optional[datetime]) -> Optional[str]:
    """Returns the ISO 8601 of a datetime, ensuring it carries tz info.

    - `None` → `None` (`Optional` fields).
    - Naive datetime → assumed as UTC and serialized with `+00:00`.
    - Aware datetime → serialized as-is.

    """
    if v is None:
        return None
    if v.tzinfo is None:
        v = v.replace(tzinfo=timezone.utc)
    return v.isoformat()
