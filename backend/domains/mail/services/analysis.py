"""Bounded execution helpers for user-triggered mail analysis."""

from __future__ import annotations

import asyncio
import json
from urllib.parse import urlparse

from backend.security.ai_credentials import resolve_provider_api_key


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
