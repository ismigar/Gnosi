"""Tolerant parsing of the HTTP `Retry-After` header (RFC 7231).

The header can be an integer number of seconds OR an HTTP date
(`"Wed, 21 Oct 2025 07:28:00 GMT"`). Calling `float(value)` directly used to blow up with
`ValueError` on the date format and take down the caller (Notion clone,
MCP tools…) instead of retrying. This helper interprets both formats and
FALLS BACK to `default` if it can't be parsed — it never raises.
"""
from __future__ import annotations

from typing import Optional


def retry_after_seconds(
    value: Optional[str],
    *,
    default: float,
    cap: Optional[float] = None,
) -> float:
    """Seconds to wait before a 429/503, tolerant of the `Retry-After` format.

    - `value`: the raw header value (or None if absent).
    - `default`: fallback when absent or unparsable.
    - `cap`: optional maximum (avoids excessive waits if the server sends
      an outrageous one).
    Always returns a float >= 0; never raises.
    
    """
    def _cap(x: float) -> float:
        x = max(x, 0.0)
        return min(x, cap) if cap is not None else x

    if not value:
        return _cap(default)

    # "seconds" form (integer or decimal).
    try:
        return _cap(float(value))
    except (ValueError, TypeError):
        pass

    # HTTP date form → delta up to now.
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
