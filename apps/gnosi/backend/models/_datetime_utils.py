"""Helpers per garantir que els camps `datetime` sortin sempre amb info de
zona horària al ISO serialitzat.

Sense això, columnes `DateTime` (sense `timezone=True`) que guarden
`datetime.now(timezone.utc)` retornen un `datetime` naive a SQLAlchemy,
i Pydantic el serialitza com `"2026-05-12T18:55:00"`. El navegador llavors
fa `new Date(iso).toLocaleString()` interpretant la cadena com a **hora
local**, i la columna apareix 1-2 hores enrere al UI.

Convencionalment, tots els `default=lambda: datetime.now(timezone.utc)`
del repo guarden UTC; per a entrades antigues naive assumim aquesta
convenció i hi adjuntem `tzinfo=UTC` abans de serialitzar.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional


def normalize_utc(v: Optional[datetime]) -> Optional[str]:
    """Retorna el ISO 8601 d'un datetime, garantint que porti tz info.

    - `None` → `None` (camps `Optional`).
    - Datetime naive → assumit com UTC i serialitzat amb `+00:00`.
    - Datetime aware → serialitzat tal qual.
    """
    if v is None:
        return None
    if v.tzinfo is None:
        v = v.replace(tzinfo=timezone.utc)
    return v.isoformat()
