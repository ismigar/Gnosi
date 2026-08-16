"""Process-local provider circuit breaker with bounded cooldowns."""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Any


@dataclass
class _ProviderState:
    failures: int = 0
    last_error: str = ""
    opened_until: float = 0.0
    last_success: float = 0.0


_LOCK = threading.RLock()
_STATES: dict[str, _ProviderState] = {}
_BASE_COOLDOWN_SECONDS = 5.0
_MAX_COOLDOWN_SECONDS = 300.0


def _key(provider: str, model: str = "") -> str:
    return f"{str(provider or '').strip().lower()}:{str(model or '').strip()}"


def is_available(provider: str, model: str = "") -> bool:
    """Return whether the candidate is outside its cooldown window."""
    with _LOCK:
        state = _STATES.get(_key(provider, model))
        return not state or state.opened_until <= time.monotonic()


def record_failure(provider: str, model: str, error: BaseException) -> dict[str, Any]:
    """Open or extend a circuit after a provider failure."""
    key = _key(provider, model)
    with _LOCK:
        state = _STATES.setdefault(key, _ProviderState())
        state.failures += 1
        state.last_error = type(error).__name__[:80]
        cooldown = min(
            _MAX_COOLDOWN_SECONDS,
            _BASE_COOLDOWN_SECONDS * (2 ** max(0, state.failures - 1)),
        )
        state.opened_until = time.monotonic() + cooldown
        return {
            "provider": str(provider),
            "model": str(model),
            "failures": state.failures,
            "cooldown_seconds": cooldown,
            "reason": state.last_error,
        }


def record_success(provider: str, model: str) -> None:
    """Close a circuit and clear transient failure history after success."""
    with _LOCK:
        state = _STATES.setdefault(_key(provider, model), _ProviderState())
        state.failures = 0
        state.last_error = ""
        state.opened_until = 0.0
        state.last_success = time.monotonic()


def snapshot() -> list[dict[str, Any]]:
    """Return bounded operational metadata for diagnostics, never exceptions."""
    now = time.monotonic()
    with _LOCK:
        return [
            {
                "provider": key.split(":", 1)[0],
                "model": key.split(":", 1)[1],
                "failures": state.failures,
                "open": state.opened_until > now,
                "cooldown_remaining": max(0, round(state.opened_until - now, 2)),
                "last_error": state.last_error,
            }
            for key, state in list(_STATES.items())[-64:]
        ]


def reset() -> None:
    """Clear state for isolated tests and controlled maintenance."""
    with _LOCK:
        _STATES.clear()
