"""Bounded execution helpers for user-triggered mail analysis."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import date
from urllib.parse import urlparse

from backend.domains.mail.services.local_analysis import extract_local_entities
from backend.security.ai_credentials import resolve_provider_api_key

log = logging.getLogger(__name__)


class MailAnalysisNotConfiguredError(RuntimeError):
    """Raised when neither configured analysis provider can be used."""


class MailAnalysisInvalidResponseError(RuntimeError):
    """Raised when a provider response is not the entity JSON contract."""


_HOSTED_PROVIDERS_REQUIRING_CREDENTIALS = {
    "anthropic",
    "deepseek",
    "groq",
    "mistral",
    "openai",
    "openrouter",
}


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


async def request_entity_analysis(prompt: str) -> tuple[str, str]:
    """Run provider fallback off the event loop with viewer-safe time bounds."""
    from pipeline import ai_client

    configured = _configured_provider_names()
    if not configured:
        raise MailAnalysisNotConfiguredError("No mail analysis provider is configured")
    if ai_client.PRIMARY_PROVIDER in configured:
        return await asyncio.to_thread(
            ai_client.call_ai_with_fallback,
            prompt,
            timeout_primary=20,
            timeout_fallback=30,
            max_chars_primary=6000,
        )
    provider = configured[0]
    content = await asyncio.to_thread(
        ai_client.call_ai_client,
        prompt[:6000],
        timeout=30,
        provider=provider,
    )
    return content, provider


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


def _local_fallback(context: str, error_code: str) -> dict[str, object]:
    local = extract_local_entities(context)
    if local.has_entities:
        return {
            "events": local.events,
            "contacts": local.contacts,
            "provider": "local_deterministic",
        }
    return {
        "events": [],
        "contacts": [],
        "error": error_code,
    }


async def analyze_mail_entities(context: str) -> dict[str, object]:
    """Use configured AI, then literal-only local extraction on provider failure."""
    if not context:
        return {"events": [], "contacts": []}
    try:
        content, provider = await request_entity_analysis(_analysis_prompt(context))
    except MailAnalysisNotConfiguredError:
        return _local_fallback(context, "not_configured")
    except Exception as error:
        log.warning(
            "Mail entity analysis provider unavailable: %s",
            type(error).__name__,
        )
        return _local_fallback(context, "temporarily_unavailable")
    try:
        return parse_entity_analysis(content, provider)
    except MailAnalysisInvalidResponseError as error:
        log.warning(
            "Mail entity analysis returned an invalid response: %s",
            type(error).__name__,
        )
        return _local_fallback(context, "invalid_response")
