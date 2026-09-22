"""Compatibility names for old scripts; the principal is the only AI runtime."""
from __future__ import annotations


def call_ai_client(prompt: str, stream: bool = False, timeout: int = 120,
                   provider: str | None = None, use_cache: bool = True) -> str:
    from backend.services.agent_execution import generate_for
    if provider:
        raise ValueError("Functional operations cannot select a provider")
    result, _model = generate_for("writing", prompt, timeout=timeout)
    return result


def call_ai_with_fallback(prompt: str, timeout_primary: int | None = None,
                          timeout_fallback: int | None = None,
                          max_chars_primary: int | None = None,
                          use_cache: bool = True) -> str:
    """Legacy name, with no independent fallback or prompt truncation."""
    from backend.services.agent_execution import generate_for
    result, _model = generate_for("writing", prompt, timeout=timeout_primary or 120)
    return result
