"""Parseig tolerant del header HTTP `Retry-After` (RFC 7231).

El header pot ser un enter de segons O una data HTTP
(`"Wed, 21 Oct 2025 07:28:00 GMT"`). Fer `float(value)` directe petava amb
`ValueError` davant el format de data i tombava el caller (clon de Notion,
tools MCP…) en lloc de reintentar. Aquest helper interpreta els dos formats i
CAU al `default` si no es pot interpretar — mai llança.
"""
from __future__ import annotations

from typing import Optional


def retry_after_seconds(
    value: Optional[str],
    *,
    default: float,
    cap: Optional[float] = None,
) -> float:
    """Segons a esperar davant un 429/503, tolerant amb el format de `Retry-After`.

    - `value`: el valor cru del header (o None si no hi és).
    - `default`: fallback quan és absent o no interpretable.
    - `cap`: màxim opcional (evita esperes desmesurades si el servidor n'envia
      una de gegant).
    Sempre retorna un float >= 0; mai llança.
    """
    def _cap(x: float) -> float:
        x = max(x, 0.0)
        return min(x, cap) if cap is not None else x

    if not value:
        return _cap(default)

    # Forma "segons" (enter o decimal).
    try:
        return _cap(float(value))
    except (ValueError, TypeError):
        pass

    # Forma data HTTP → delta fins ara.
    try:
        from email.utils import parsedate_to_datetime
        from datetime import datetime, timezone
        dt = parsedate_to_datetime(value)
        if dt is not None:
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return _cap((dt - datetime.now(timezone.utc)).total_seconds())
    except Exception:
        pass

    return _cap(default)
