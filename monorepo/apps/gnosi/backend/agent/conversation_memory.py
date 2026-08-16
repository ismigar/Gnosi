"""Deterministic, bounded conversation-memory compaction."""

from __future__ import annotations

import hashlib
from typing import Any, Iterable


def compact_history_digest(messages: Iterable[Any], *, max_chars: int = 2_000) -> str:
    """Create a safe digest of dropped turns without retaining raw transcripts."""
    rows: list[str] = []
    for message in messages:
        kind = str(getattr(message, "type", "message") or "message")
        if kind not in {"human", "ai"}:
            continue
        text = str(getattr(message, "content", "") or "")
        text = " ".join(text.split())
        if not text:
            continue
        digest = hashlib.sha256(text.encode("utf-8", "replace")).hexdigest()[:10]
        rows.append(f"{kind}:{text[:220]} [ref:{digest}]")
    if not rows:
        return ""
    return (
        "Earlier conversation memory (bounded deterministic digest; evidence may "
        "be incomplete):\n- "
        + "\n- ".join(rows)
    )[:max(0, int(max_chars))]
