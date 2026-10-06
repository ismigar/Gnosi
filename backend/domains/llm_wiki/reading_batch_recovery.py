"""Reduce automatic delivery after output exhaustion without altering evidence."""
from __future__ import annotations

import re
from typing import Any


class IncompleteReadingBatch(ValueError):
    """A substantial structured answer ended before its JSON was complete."""

    def __init__(self) -> None:
        super().__init__("reading_batch_response_incomplete")


def batch_limit(requested: int, state: dict[str, Any]) -> int:
    limit = state.get("batch_size_limit", 4)
    return max(1, min(4, requested, limit if type(limit) is int else 4))


def delivered_batch_size(state: dict[str, Any]) -> int:
    last = state.get("last_result") or {}
    action = state.get("last_action") or {}
    if action.get("delivery") != "automatic" or last.get("delivery") != "batch":
        return 1
    return len(last.get("sources", []))


def _has_answer_tokens(error: Exception | str) -> bool:
    if isinstance(error, IncompleteReadingBatch) or error == "reading_batch_response_incomplete":
        return True
    from openai import LengthFinishReasonError
    if isinstance(error, LengthFinishReasonError):
        usage = error.completion.usage
        details = usage.completion_tokens_details if usage else None
        if usage and details and details.reasoning_tokens is not None:
            return usage.completion_tokens > details.reasoning_tokens
        return any(bool(choice.message.content) for choice in error.completion.choices)
    # Older jobs persist the SDK diagnostic, not the exception object. Accept
    # only its exact prefix and measured usage; other errors must still stop.
    if not isinstance(error, str) or not error.startswith("Could not parse response content as the length limit was reached - CompletionUsage("):
        return False
    total = re.search(r"\bcompletion_tokens=(\d+)", error)
    reasoning = re.search(r"\breasoning_tokens=(\d+)", error)
    return bool(total and reasoning and int(total[1]) > int(reasoning[1]))


def reduce_batch(state: dict[str, Any], error: Exception | str) -> bool:
    """At most two reductions (4→2→1); no retry for reasoning-only exhaustion."""
    size = delivered_batch_size(state)
    if size <= 1 or not _has_answer_tokens(error):
        return False
    limit = max(1, size // 2)
    if batch_limit(4, state) <= limit:
        return False
    state["batch_size_limit"] = limit
    return True
