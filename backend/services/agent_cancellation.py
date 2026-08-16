"""Cooperative cancellation for streamed agent turns.

Only an opaque token is stored in graph state.  The event stream owns the
in-process event and marks it when the client disconnects; cached workflows can
therefore remain shared safely between requests.
"""

from __future__ import annotations

import threading
import time
import uuid


_LOCK = threading.RLock()
_TOKENS: dict[str, tuple[threading.Event, float]] = {}
_TTL_SECONDS = 180.0


def _prune(now: float) -> None:
    for token, (_event, expires_at) in list(_TOKENS.items()):
        if expires_at <= now:
            _TOKENS.pop(token, None)


def create_cancel_token() -> str:
    """Create a request-scoped cancellation token."""
    token = uuid.uuid4().hex
    with _LOCK:
        now = time.monotonic()
        _prune(now)
        _TOKENS[token] = (threading.Event(), now + _TTL_SECONDS)
    return token


def cancel(token: str) -> bool:
    """Signal cancellation; return whether the token was known."""
    with _LOCK:
        item = _TOKENS.get(str(token or ""))
        if not item:
            return False
        item[0].set()
        return True


def is_cancelled(token: str) -> bool:
    """Read the cancellation signal without leaking the event into checkpoints."""
    if not token:
        return False
    with _LOCK:
        item = _TOKENS.get(str(token))
        return bool(item and item[0].is_set())


def release(token: str) -> None:
    """Release a completed token."""
    with _LOCK:
        _TOKENS.pop(str(token or ""), None)
