"""Bounded execution helpers for user-triggered mail analysis."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import date
from typing import Literal, TypeAlias
from urllib.parse import urlparse

import requests

from backend.domains.mail.services.analysis_cache import (
    PreviousMailAnalysis,
    load_previous_mail_analysis,
    store_previous_mail_analysis,
)
from backend.domains.mail.services.local_analysis import (
    LocalEntityAnalysis,
    extract_local_entities,
)
from backend.security.ai_credentials import resolve_provider_api_key

log = logging.getLogger(__name__)


class MailAnalysisInvalidResponseError(RuntimeError):
    """Raised when a provider response is not the entity JSON contract."""


AnalysisReason: TypeAlias = Literal[
    "not_configured",
    "disabled",
    "timeout",
    "credentials",
    "quota",
    "temporarily_unavailable",
    "invalid_response",
    "internal_error",
]


_HOSTED_PROVIDERS_REQUIRING_CREDENTIALS = {
    "anthropic",
    "deepseek",
    "groq",
    "mistral",
    "openai",
    "openrouter",
}
_HTTP_STATUS_RE = re.compile(r"^AI error (?P<status>\d{3})(?::|$)")
_PUBLIC_PROVIDER_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
_PRIMARY_TIMEOUT_SECONDS = 8
_FALLBACK_TIMEOUT_SECONDS = 12
_PROVIDER_MAX_OCCUPANCY = 2
_PROVIDER_CAPACITY = threading.BoundedSemaphore(_PROVIDER_MAX_OCCUPANCY)
_PROVIDER_EXECUTOR = ThreadPoolExecutor(
    max_workers=_PROVIDER_MAX_OCCUPANCY,
    thread_name_prefix="mail-analysis-provider",
)


class MailAnalysisProviderBusyError(RuntimeError):
    """Raised when every bounded provider worker is still occupied."""


def _call_provider_blocking(
    prompt: str,
    provider: str,
    timeout: int,
    capacity: threading.BoundedSemaphore,
) -> str:
    from pipeline import ai_client

    try:
        return ai_client.call_ai_client(
            prompt[:6000],
            timeout=timeout,
            provider=provider,
            use_cache=False,
        )
    finally:
        capacity.release()


def _consume_provider_result(future: Future[str]) -> None:
    """Observe a late provider exception after its async waiter timed out."""
    if future.cancelled():
        return
    future.exception()


def _is_local_endpoint(url: str) -> bool:
    hostname = (urlparse(url).hostname or "").casefold()
    return hostname in {"127.0.0.1", "::1", "localhost"}


def _configured_provider_names() -> list[str]:
    """Return usable primary/fallback names without contacting providers."""
    from pipeline import ai_client

    candidates = [ai_client.PRIMARY_PROVIDER, ai_client.FALLBACK_PROVIDER]
    configured: list[str] = []
    for name in candidates:
        if not name or name in configured:
            continue
        config = ai_client.PROVIDERS.get(name)
        if not isinstance(config, dict) or config.get("enabled", True) is False:
            continue
        model_url = str(config.get("model_url") or "").strip()
        model_name = str(config.get("model_name") or "").strip()
        if not model_url or not model_name:
            continue
        if (
            name.casefold() in _HOSTED_PROVIDERS_REQUIRING_CREDENTIALS
            and not _is_local_endpoint(model_url)
            and not resolve_provider_api_key(name, config)
        ):
            continue
        configured.append(name)
    return configured


def _configuration_failure_reason() -> AnalysisReason:
    """Explain why no provider can run without making a provider request."""
    from pipeline import ai_client

    saw_disabled = False
    saw_missing_credentials = False
    saw_enabled_candidate = False
    for name in dict.fromkeys(
        candidate
        for candidate in (ai_client.PRIMARY_PROVIDER, ai_client.FALLBACK_PROVIDER)
        if candidate
    ):
        config = ai_client.PROVIDERS.get(name)
        if not isinstance(config, dict):
            continue
        if config.get("enabled", True) is False:
            saw_disabled = True
            continue
        saw_enabled_candidate = True
        model_url = str(config.get("model_url") or "").strip()
        model_name = str(config.get("model_name") or "").strip()
        if not model_url or not model_name:
            continue
        if (
            name.casefold() in _HOSTED_PROVIDERS_REQUIRING_CREDENTIALS
            and not _is_local_endpoint(model_url)
            and not resolve_provider_api_key(name, config)
        ):
            saw_missing_credentials = True
    if saw_missing_credentials:
        return "credentials"
    if saw_disabled and not saw_enabled_candidate:
        return "disabled"
    return "not_configured"


async def request_entity_analysis(
    prompt: str,
    provider: str,
    timeout: int,
) -> str:
    """Run one provider off the event loop with a viewer-safe time bound."""
    capacity = _PROVIDER_CAPACITY
    if not capacity.acquire(blocking=False):
        raise MailAnalysisProviderBusyError("Provider capacity is occupied")
    try:
        provider_future = _PROVIDER_EXECUTOR.submit(
            _call_provider_blocking,
            prompt,
            provider,
            timeout,
            capacity,
        )
        provider_future.add_done_callback(_consume_provider_result)
    except BaseException:
        capacity.release()
        raise
    future = asyncio.wrap_future(provider_future)
    async with asyncio.timeout(timeout):
        return await asyncio.shield(future)


def parse_entity_analysis(content: str, provider: str) -> dict[str, object]:
    """Parse the provider response without retaining or returning raw content."""
    clean_content = content.strip()
    if clean_content.startswith("```json"):
        clean_content = clean_content[7:-3].strip()
    elif clean_content.startswith("```"):
        clean_content = clean_content[3:-3].strip()
    try:
        data: object = json.loads(clean_content)
    except json.JSONDecodeError as error:
        raise MailAnalysisInvalidResponseError("Invalid entity analysis JSON") from error
    if not isinstance(data, dict):
        raise MailAnalysisInvalidResponseError("Entity analysis response must be an object")
    events: object = data.get("events", [])
    contacts: object = data.get("contacts", [])
    if not isinstance(events, list) or not isinstance(contacts, list):
        raise MailAnalysisInvalidResponseError("Entity analysis collections must be lists")
    return {
        "events": events,
        "contacts": contacts,
        "provider": provider,
    }


def _analysis_prompt(context: str) -> str:
    today = date.today().isoformat()
    return f"""Analyze this email and extract calendar events and contacts.
The email may be in any language (Catalan, Spanish, English, French, etc.).
Today's date is {today}.

Return ONLY a JSON object with the fields 'events' and 'contacts'. Do not add
other text or Markdown. Return empty arrays when there are no entities.

Date formats to recognize (non-exhaustive examples):
- "dia 6 de maig de 2026 a les 09.30 hores" → 2026-05-06T09:30:00
- "el proper dilluns a les 10h" → calculate relative to {today}
- "6 de mayo de 2026 a las 10:00" → 2026-05-06T10:00:00
- "May 6th 2026 at 10am" → 2026-05-06T10:00:00

Each event must contain:
- title: string (short descriptive event name)
- start: ISO 8601 string (use T09:00:00 when no time is provided)
- end: ISO 8601 string (one hour after start when not specified)
- location: string (empty when not mentioned)
- description: string (brief summary)

Each contact must contain:
- name: string
- email: string
- phone: string
- company: string
- notes: string

EMAIL CONTENT:
{context}"""


def _public_provider_name(provider: str, index: int) -> str:
    if _PUBLIC_PROVIDER_RE.fullmatch(provider):
        return provider
    return f"provider-{index + 1}"


def _provider_failure_status(error: Exception) -> str:
    if isinstance(error, MailAnalysisProviderBusyError):
        return "unavailable"
    if isinstance(error, (asyncio.TimeoutError, requests.exceptions.Timeout)):
        return "timeout"
    if isinstance(error, requests.exceptions.ConnectionError):
        return "network_error"
    response = getattr(error, "response", None)
    status_code = getattr(response, "status_code", None)
    if not isinstance(status_code, int):
        match = _HTTP_STATUS_RE.match(str(error))
        status_code = int(match.group("status")) if match else None
    if status_code == 401:
        return "unauthorized"
    if status_code == 429:
        return "rate_limited"
    if isinstance(status_code, int) and 500 <= status_code <= 599:
        return "server_error"
    return "unavailable"


def _provider_exhaustion_reason(attempts: list[dict[str, str]]) -> AnalysisReason:
    statuses = {attempt.get("status", "") for attempt in attempts}
    if "unauthorized" in statuses:
        return "credentials"
    if "rate_limited" in statuses:
        return "quota"
    if "timeout" in statuses and statuses <= {"timeout", "unavailable"}:
        return "timeout"
    if statuses == {"invalid_response"}:
        return "invalid_response"
    return "temporarily_unavailable"


async def _local_fallback(
    context: str,
    reason: str,
    analysis_reason: AnalysisReason,
    attempts: list[dict[str, str]],
    *,
    sender: str,
    recipients: tuple[str, ...],
    attachments: tuple[str, ...],
) -> dict[str, object]:
    local_result, previous_result = await asyncio.gather(
        asyncio.to_thread(
            extract_local_entities,
            context,
            sender=sender,
            recipients=recipients,
            attachments=attachments,
        ),
        asyncio.to_thread(
            load_previous_mail_analysis,
            context,
            sender=sender,
            recipients=recipients,
            attachments=attachments,
        ),
        return_exceptions=True,
    )
    for result in (local_result, previous_result):
        if isinstance(result, asyncio.CancelledError):
            raise result
    local = local_result if isinstance(local_result, LocalEntityAnalysis) else None
    previous = (
        previous_result
        if isinstance(previous_result, PreviousMailAnalysis)
        else None
    )
    if not isinstance(previous_result, (PreviousMailAnalysis, type(None))):
        log.warning("Previous mail analysis could not be read")
    if local is None:
        error_code: AnalysisReason = (
            "internal_error" if isinstance(local_result, BaseException) else "invalid_response"
        )
        log.warning("Deterministic local mail analysis failed (%s)", error_code)
        if previous is not None:
            return {
                "events": previous.events,
                "contacts": previous.contacts,
                "provider": "previous_valid",
                "status": "complete",
                "result_source": "previous_valid",
                "degraded_reason": reason,
                "analysis_reason": error_code,
                "provider_attempts": attempts,
            }
        return {
            "events": [],
            "contacts": [],
            "provider": "local_deterministic",
            "error": error_code,
            "status": "degraded",
            "result_source": "local",
            "degraded_reason": reason,
            "analysis_reason": error_code,
            "provider_attempts": attempts,
        }
    return {
        "events": previous.events if previous is not None else local.events,
        "contacts": previous.contacts if previous is not None else local.contacts,
        "provider": "previous_valid" if previous is not None else "local_deterministic",
        "status": "complete",
        "result_source": "previous_valid" if previous is not None else "local",
        "degraded_reason": reason,
        "analysis_reason": analysis_reason,
        "provider_attempts": attempts,
        "local_analysis": local.report.as_dict(),
    }


async def analyze_mail_entities(
    context: str,
    *,
    sender: str = "",
    recipients: tuple[str, ...] = (),
    attachments: tuple[str, ...] = (),
) -> dict[str, object]:
    """Cascade configured providers, then return deterministic local evidence."""
    if not context and not sender and not recipients and not attachments:
        return {"events": [], "contacts": [], "status": "complete"}
    configured = _configured_provider_names()
    attempts: list[dict[str, str]] = []
    prompt = _analysis_prompt(context)
    for index, provider in enumerate(configured):
        public_name = _public_provider_name(provider, index)
        try:
            content = await request_entity_analysis(
                prompt,
                provider,
                _PRIMARY_TIMEOUT_SECONDS if index == 0 else _FALLBACK_TIMEOUT_SECONDS,
            )
        except Exception as error:
            failure = _provider_failure_status(error)
            attempts.append({"provider": public_name, "status": failure})
            log.warning("Mail analysis provider %s failed (%s)", public_name, failure)
            continue
        try:
            parsed = parse_entity_analysis(content, public_name)
        except MailAnalysisInvalidResponseError:
            attempts.append({"provider": public_name, "status": "invalid_response"})
            log.warning("Mail analysis provider %s returned invalid output", public_name)
            continue
        attempts.append({"provider": public_name, "status": "success"})
        await asyncio.to_thread(
            store_previous_mail_analysis,
            context,
            sender=sender,
            recipients=recipients,
            attachments=attachments,
            events=parsed["events"],
            contacts=parsed["contacts"],
        )
        return {
            **parsed,
            "status": "complete",
            "result_source": "provider",
            "provider_attempts": attempts,
        }
    degraded_reason = "not_configured" if not configured else "providers_failed"
    analysis_reason = (
        _configuration_failure_reason()
        if not configured
        else _provider_exhaustion_reason(attempts)
    )
    return await _local_fallback(
        context,
        degraded_reason,
        analysis_reason,
        attempts,
        sender=sender,
        recipients=recipients,
        attachments=attachments,
    )
