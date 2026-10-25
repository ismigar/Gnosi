"""Retry a podcast's transient capacity refusal inside its existing call/deadline limits."""
from __future__ import annotations

from asyncio import sleep
from collections.abc import Mapping
import math
from time import monotonic
from typing import Any

from openai import APIStatusError

from backend.services.agent_execution_models import AgentOperation, ExecutionScope
from backend.services.agent_cancellation import await_with_cancellation
from backend.utils.http_retry import retry_after_seconds

_PERMANENT_CODES = {"insufficient_quota", "quota_exceeded", "billing_hard_limit_reached",
                    "billing_not_active", "credit_balance_too_low"}


def _delay(error: APIStatusError) -> float | None:
    if error.status_code not in {429, 500, 502, 503, 504}:
        return None
    response = getattr(error, "response", None)
    headers = {str(k).lower(): str(v).strip() for k, v in getattr(response, "headers", {}).items()}
    if headers.get("x-should-retry", "").lower() == "false" or headers.get("x-ratelimit-limit-req-minute") == "0":
        return None
    body: Any = getattr(error, "body", None)
    envelope = body
    # SDK errors may expose only the nested error object as .body, omitting
    # outer usage. Inspect only the already buffered response; never read a live stream.
    if response is not None and getattr(response, "is_stream_consumed", False):
        try:
            envelope = response.json()
        except (ValueError, RuntimeError):
            pass
    from backend.services.openrouter_response_validation import has_usage, terminal_error
    if has_usage(envelope) or has_usage(body) or terminal_error(envelope) or terminal_error(body):
        return None
    details = body.get("error", body) if isinstance(body, Mapping) else {}
    if isinstance(details, Mapping):
        metadata = details.get("metadata", {})
        codes = [details.get("code"), details.get("type")]
        if isinstance(metadata, Mapping):
            codes.append(metadata.get("provider_error_code"))
        if any(str(code).lower() in _PERMANENT_CODES for code in codes):
            return None
    requested = retry_after_seconds(headers.get("retry-after"), default=5.0)
    if not math.isfinite(requested):
        return None
    delay = max(5.0, requested)
    try:
        milliseconds = float(headers.get("retry-after-ms", "0")) / 1000
    except ValueError:
        milliseconds = 0
    if not math.isfinite(milliseconds) or not math.isfinite(delay):
        return None
    return max(delay, milliseconds)


async def wait_for_capacity(error: APIStatusError, request: AgentOperation, *, calls_left: int,
                            deadline: float, scope: ExecutionScope, run_id: str, cancel_token: str = "") -> None:
    from backend.services.agent_execution_trace import append
    delay = _delay(error)
    if (not request.operation.startswith("podcast.coverage.") or calls_left < 1 or delay is None
            or deadline - monotonic() - delay < 1):
        raise error
    append(scope, run_id, "operation.provider_retry", {
        "status_code": error.status_code, "wait_seconds": delay, "calls_left": calls_left,
        "upstream_http_status": 200 if error.response.headers.get("x-gnosi-upstream-http-status") == "200" else error.status_code,
        "operation": request.operation, "same_request_and_provider": True})
    await await_with_cancellation(sleep(delay), cancel_token)
    if deadline - monotonic() < 1:
        raise error
