"""Safe, bounded recovery metadata for failed agent turns.

Recovery is intentionally advisory.  The server never replays a turn
automatically because a failed turn may already have prepared a governed
action.  The client can offer a deliberate retry of the original prompt.
"""

from __future__ import annotations

from typing import Any


RETRYABLE_ERROR_CODES = frozenset({
    "agent_loop_exhausted",
    "agent_turn_timeout",
    "timeout",
    "server_error",
    "service_unavailable",
    "rate_limit",
    "rate_limit_exceeded",
    "network_error",
})


def is_retryable_error_code(code: Any) -> bool:
    """Return whether retrying the same prompt is a safe user option."""
    normalized = str(code or "").strip().lower()
    return normalized in RETRYABLE_ERROR_CODES


def recovery_metadata(code: Any) -> dict[str, Any]:
    """Return bounded UI metadata without exposing exception internals."""
    retryable = is_retryable_error_code(code)
    return {
        "retryable": retryable,
        "action": "retry_message" if retryable else "edit_request",
        "automatic": False,
        "max_attempts": 1,
    }
