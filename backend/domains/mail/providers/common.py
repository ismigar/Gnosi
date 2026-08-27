"""Shared mail-provider normalization helpers."""

from __future__ import annotations

from email.header import decode_header as _decode_header
from email.utils import parsedate_to_datetime


def _decode_mime(value: str) -> str:
    import html

    if not value:
        return ""
    try:
        parts = _decode_header(value)
    except Exception:
        return str(value)
    out = []
    for part, charset in parts:
        if isinstance(part, bytes):
            codec = charset
            if codec:
                codec = codec.strip().strip('"').strip("'").lower()
                if codec in ("unknown-8bit", "unknown", "x-unknown", "attachment"):
                    codec = "utf-8"
            else:
                codec = "utf-8"
            try:
                out.append(part.decode(codec, errors="replace"))
            except LookupError:
                out.append(part.decode("latin1", errors="replace"))
            except Exception:
                out.append(part.decode("utf-8", errors="replace"))
        else:
            out.append(part)
    return html.unescape("".join(out))


def _ts(date_str: str) -> int:
    try:
        return int(parsedate_to_datetime(date_str).timestamp())
    except Exception:
        return 0
