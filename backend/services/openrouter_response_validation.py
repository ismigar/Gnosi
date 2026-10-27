"""Reject malformed Chat Completions before the SDK's structured parser runs."""
from __future__ import annotations

import json
import math
import re
from typing import Any
from urllib.parse import urlsplit

from openai import APIStatusError
from openai._constants import MAX_RETRY_AFTER_DELAY
from openai.types.chat import ChatCompletionMessage
from pydantic import ValidationError

from backend.utils.http_retry import retry_after_seconds


class ProviderResponseError(APIStatusError):
    """A terminal provider envelope, retaining its real HTTP response and body."""


def _token(value: Any) -> str:
    text = str(value or "")
    return text if re.fullmatch(r"[A-Za-z0-9_.:-]{1,200}", text) else ""


def _refused(value: Any) -> bool:
    if isinstance(value, list):
        return any(_refused(item) for item in value)
    if not isinstance(value, dict):
        return False
    if value.get("refusal") or any(str(value.get(key) or "").lower() in
            {"content_filter", "safety", "refusal", "blocked", "moderation"}
            for key in ("finish_reason", "native_finish_reason", "code", "type")):
        return True
    return any(_refused(item) for item in value.values())


def _permanent(value: Any) -> bool:
    if isinstance(value, list):
        return any(_permanent(item) for item in value)
    if not isinstance(value, dict):
        return False
    codes = {"400", "401", "402", "403", "404", "422", "insufficient_quota", "quota_exceeded",
             "billing_hard_limit_reached", "billing_not_active", "credit_balance_too_low"}
    if any(str(value.get(key) or "").lower() in codes for key in ("code", "type", "provider_error_code")):
        return True
    return any(_permanent(item) for item in value.values())


def terminal_error(value: Any) -> bool:
    """Keep explicit permanent refusals terminal, including wrapped provider text."""
    words = str(value or "").lower()
    return _permanent(value) or _refused(value) or any(marker in words for marker in (
        "content_filter", "content filter", "refusal", "safety", "moderation",
        "insufficient_quota", "insufficient quota", "insufficient credit", "insufficient fund",
        "quota_exceeded", "quota exceeded", "billing_hard_limit_reached", "billing_not_active",
        "credit_balance_too_low", "payment required"))


def _eligible(response: Any, endpoint: tuple[str, str, str]) -> bool:
    url = urlsplit(str(response.request.url))
    if (url.scheme, url.netloc, url.path) != endpoint or response.status_code != 200:
        return False
    if "application/json" not in response.headers.get("content-type", "").lower():
        return False
    try:
        request = json.loads(response.request.content)
    except (ValueError, RuntimeError):
        return False
    return isinstance(request, dict) and request.get("stream") is not True


def has_usage(value: Any) -> bool:
    if isinstance(value, list):
        return any(has_usage(item) for item in value)
    if isinstance(value, dict):
        return bool(value.get("usage")) or any(has_usage(item) for item in value.values())
    return False


def _usable_choices(choices: Any) -> bool:
    if not isinstance(choices, list) or not choices:
        return False
    for choice in choices:
        if not isinstance(choice, dict) or not isinstance(choice.get("message"), dict):
            return False
        try:
            ChatCompletionMessage.model_validate(choice["message"], strict=True)
        except ValidationError:
            return False
    return True


def _validate(response: Any) -> None:
    invalid_json = False
    try:
        original = response.json()
    except ValueError:
        invalid_json = True
        original = response.text
    payload = original if isinstance(original, dict) else {}
    choices = payload.get("choices")
    usable = _usable_choices(choices)
    structured = isinstance(json.loads(response.request.content).get("response_format"), dict)
    native_filter = usable and isinstance(choices, list) and any(choice.get("finish_reason") == "content_filter" for choice in choices)
    # Preserve the SDK's native filter exception and ordinary chat refusals.
    # Structured operations must never accept JSON accompanying a refusal.
    if usable and not payload.get("error") and (native_filter or not structured or not _refused(payload)):
        return
    state = ("invalid_json" if invalid_json else "invalid_envelope" if not isinstance(original, dict) else
             "present" if usable else "missing" if "choices" not in payload else "null" if choices is None else "empty" if choices == [] else "invalid")
    error = payload.get("error")
    code = error.get("code") if isinstance(error, dict) else None
    terminal_body = error if isinstance(original, dict) else original
    transient = (not error or str(code) in {"408", "429", "500", "502", "503", "504"}) and not terminal_error(terminal_body)
    refused = _refused(original) or any(word in str(terminal_body or "").lower()
                                     for word in ("content_filter", "content filter", "refusal", "safety", "moderation"))
    # A buffered answer with usage must remain one failed accounted generation;
    # never overwrite that usage with a subsequent SDK attempt's metadata.
    delay = retry_after_seconds(response.headers.get("retry-after"), default=0)
    try:
        milliseconds = float(response.headers.get("retry-after-ms", "0")) / 1000
        delay = max(delay, milliseconds) if math.isfinite(milliseconds) else math.inf
    except ValueError:
        delay = math.inf
    retry = (transient and not refused and not has_usage(original)
             and response.headers.get("x-should-retry", "").strip().lower() != "false"
             and response.headers.get("x-ratelimit-limit-req-minute", "").strip() != "0"
             and math.isfinite(delay) and delay <= MAX_RETRY_AFTER_DELAY)
    sdk_status = 502
    generation = _token(payload.get("id"))
    from backend.services.ai_usage_transport import observe
    from backend.services.agent_execution_trace import record
    diagnostic = {
        "upstream_http_status": 200, "choices": state, "generation_id": generation,
        "error_code": _token(code), "refused": refused,
        "sdk_retry_index": _token(response.request.headers.get("x-stainless-retry-count")),
        "normalized_sdk_status": sdk_status if retry else None, "retry_after_seconds": delay if math.isfinite(delay) else None,
    }
    try:
        observe(original)
        record("provider.response_invalid", diagnostic)
    except Exception as error:
        # Do not let a local diagnostic/storage defect enter the SDK's generic
        # connection-error retry loop and issue additional upstream requests.
        raise ProviderResponseError("provider_response_diagnostics_failed", response=response, body=diagnostic) from error
    if not retry:
        raise ProviderResponseError(
            f"provider_response_invalid: upstream HTTP 200; choices={state}; "
            f"code={_token(code) or 'unavailable'}; generation={generation or 'unavailable'}",
            response=response, body=original)
    # Treat an unusable HTTP-200 envelope as a gateway protocol failure. The
    # original status is retained explicitly; the body is never altered. This
    # uses only the SDK's existing retry count, backoff, timeout and same request.
    response.extensions["gnosi_upstream_http_status"] = 200
    response.headers["x-gnosi-upstream-http-status"] = "200"
    if delay > 0:
        response.headers["retry-after-ms"] = str(math.ceil(delay * 1000))
    response.status_code = sdk_status


def install(model: Any) -> None:
    """Augment existing clients without replacing TLS, proxy or timeout settings."""
    for name, asynchronous in (("root_client", False), ("root_async_client", True)):
        sdk = getattr(model, name, None)
        client = getattr(sdk, "_client", None)
        hooks = getattr(client, "event_hooks", None)
        if sdk is None or not isinstance(hooks, dict):
            continue
        base = urlsplit(str(sdk.base_url).rstrip("/") + "/chat/completions")
        endpoint = (base.scheme, base.netloc, base.path)
        responses = hooks.setdefault("response", [])
        if any(getattr(hook, "_gnosi_endpoint", None) == endpoint for hook in responses):
            continue
        async def async_guard(response: Any, endpoint: tuple[str, str, str] = endpoint) -> None:
            if _eligible(response, endpoint):
                await response.aread()
                _validate(response)
        def sync_guard(response: Any, endpoint: tuple[str, str, str] = endpoint) -> None:
            if _eligible(response, endpoint):
                response.read()
                _validate(response)
        guard = async_guard if asynchronous else sync_guard
        setattr(guard, "_gnosi_endpoint", endpoint)
        responses.append(guard)
