"""Bounded retries for one Brain planning call, without provider switching."""

from __future__ import annotations

import math
import random
import time
from collections.abc import Callable, Mapping
from typing import TypeVar

import httpx

from backend.config.logger_config import get_logger
from backend.utils.http_retry import retry_after_seconds


logger = get_logger(__name__)
T = TypeVar("T")
MAX_RETRIES = 4
REQUEST_TIMEOUT_SECONDS = 240
CALL_BUDGET_SECONDS = 360
MAX_WAIT_SECONDS = 120
_TRANSIENT_STATUSES = {408, 429, 500, 502, 503, 504}
_PERMANENT_CODES = {
    "insufficient_quota",
    "billing_hard_limit_reached",
    "billing_not_active",
    "credit_balance_too_low",
}


def _can_retry(error: Exception) -> bool:
    body = getattr(error, "body", None)
    if isinstance(body, Mapping):
        details = body.get("error", body)
        if isinstance(details, Mapping) and any(
            str(details.get(field) or "").lower() in _PERMANENT_CODES
            for field in ("code", "type")
        ):
            return False
    status = getattr(error, "status_code", None)
    if status is None:
        status = getattr(getattr(error, "response", None), "status_code", None)
    if isinstance(status, int):
        return status in _TRANSIENT_STATUSES
    transport_errors = (TimeoutError, ConnectionError, httpx.TimeoutException, httpx.NetworkError)
    return isinstance(error, transport_errors) or isinstance(error.__cause__, transport_errors)


def _retry_delay(error: Exception, retry: int) -> float:
    backoff: float = 5.0 * (2 ** retry) + random.uniform(0, 1)
    headers = getattr(getattr(error, "response", None), "headers", None)
    if not isinstance(headers, Mapping):
        return backoff
    normalized = {str(key).lower(): str(value) for key, value in headers.items()}
    delay = retry_after_seconds(normalized.get("retry-after"), default=backoff)
    milliseconds = normalized.get("retry-after-ms")
    if milliseconds:
        try:
            delay = max(delay, float(milliseconds) / 1000)
        except ValueError:
            pass
    # Never shorten a provider's cooldown to fit our budget: the caller stops
    # instead of issuing another request earlier than the server permits.
    return max(backoff, delay) if math.isfinite(delay) else math.inf


def call_with_retry(
    call: Callable[[int], T],
    *,
    on_wait: Callable[[], None],
    on_attempt: Callable[[], None],
) -> T:
    """Retry transient failures within five calls, two minutes of waits and six minutes total."""
    deadline = time.monotonic() + CALL_BUDGET_SECONDS
    waited = 0.0
    for retry in range(MAX_RETRIES + 1):
        on_attempt()
        timeout = min(REQUEST_TIMEOUT_SECONDS, max(1, int(deadline - time.monotonic())))
        try:
            return call(timeout)
        except Exception as error:
            if retry == MAX_RETRIES or not _can_retry(error):
                raise
            delay = _retry_delay(error, retry)
            if waited + delay > MAX_WAIT_SECONDS or deadline - time.monotonic() - delay < 1:
                raise
            logger.warning(
                "Brain provider unavailable (%s); retry %d/%d in %.1fs",
                type(error).__name__, retry + 1, MAX_RETRIES, delay,
            )
            on_wait()
            time.sleep(delay)
            waited += delay
            if deadline - time.monotonic() < 1:
                raise
    raise AssertionError("unreachable retry state")
