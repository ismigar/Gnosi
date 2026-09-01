"""Typed OpenAI-compatible client with primary/fallback provider routing."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any, TypeAlias, cast

import requests
from requests import Response

from backend.config.app_config import load_params
from backend.config.data_dir import resolve_data_dir
from backend.config.env_config import get_env
from backend.config.logger_config import get_logger
from backend.config.paths_config import get_paths
from backend.security.ai_credentials import resolve_provider_api_key
from backend.utils.safe_io import safe_write_json

ProviderConfig: TypeAlias = dict[str, Any]
ProviderRegistry: TypeAlias = dict[str, ProviderConfig]

log = get_logger(__name__)


def _provider_registry(value: object) -> ProviderRegistry:
    """Narrow the dynamic YAML provider map to named configuration objects."""
    if not isinstance(value, dict):
        return {}
    providers: ProviderRegistry = {}
    for name, config in value.items():
        if isinstance(name, str) and isinstance(config, dict):
            providers[name] = cast(ProviderConfig, dict(config))
    return providers


def _config_text(config: ProviderConfig, name: str, default: str = "") -> str:
    value = config.get(name)
    if value is None:
        return default
    return str(value).strip()


def _config_int(config: ProviderConfig, name: str, default: int) -> int:
    value = config.get(name, default)
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _provider_url(provider_name: str, config: ProviderConfig) -> str:
    url = _config_text(config, "model_url")
    if not url:
        raise ValueError(f"Provider '{provider_name}' has no model_url configured")
    return url


paths = get_paths()
out_dir = paths.get("OUT_DIR") or (resolve_data_dir(create=True) / "out")
CACHE_FILE = Path(out_dir) / "ai_cache.json"

cfg = load_params(strict_env=False)
PROVIDERS = _provider_registry(cfg.ai.get("providers"))
PRIMARY_PROVIDER = str(cfg.ai.get("primary_provider", "ollama"))
_fallback_value = cfg.ai.get("fallback_provider", "groq")
FALLBACK_PROVIDER: str | None = str(_fallback_value) if _fallback_value is not None else None

if not PROVIDERS:
    PROVIDERS = {
        "default": {
            "model_name": cfg.ai.get("model_name", "llama3.2"),
            "model_url": cfg.ai.get(
                "model_url",
                "http://localhost:11434/v1/chat/completions",
            ),
            "timeout": cfg.ai.get("timeout", 120),
            "retries": cfg.ai.get("retries", 2),
            "max_content_chars": 8000,
        }
    }
    PRIMARY_PROVIDER = "default"
    FALLBACK_PROVIDER = None


def _load_cache() -> dict[str, str]:
    try:
        if not CACHE_FILE.exists():
            return {}
        with CACHE_FILE.open("r", encoding="utf-8") as handle:
            loaded = json.load(handle)
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        log.warning("Could not load AI cache: %s", error)
        return {}
    if not isinstance(loaded, dict):
        return {}
    return {
        key: value
        for key, value in loaded.items()
        if isinstance(key, str) and isinstance(value, str)
    }


def _save_cache(cache: Mapping[str, str]) -> None:
    try:
        safe_write_json(CACHE_FILE, dict(cache))
    except Exception as error:  # noqa: BLE001 - cache persistence is best effort
        log.warning("Could not save AI cache: %s", error)


_AI_CACHE: dict[str, str] = _load_cache()


def get_provider_config(provider_name: str) -> ProviderConfig:
    """Return one provider configuration or reject an unknown provider."""
    config = PROVIDERS.get(provider_name)
    if not config:
        raise ValueError(f"Unknown provider: {provider_name}")
    return config


def _response_content(response: Response) -> str:
    """Validate and extract one OpenAI-compatible chat response."""
    try:
        payload = response.json()
    except ValueError as error:
        raise RuntimeError("AI provider returned invalid JSON") from error
    if not isinstance(payload, dict):
        raise RuntimeError("AI provider returned a non-object JSON payload")
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise RuntimeError("AI provider response does not contain choices[0]")
    message = choices[0].get("message")
    if not isinstance(message, dict):
        raise RuntimeError("AI provider response does not contain a message object")
    value = message.get("content") or message.get("reasoning_content") or ""
    return value if isinstance(value, str) else str(value)


def _provider_headers(provider_name: str, config: ProviderConfig) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    resolved_api_key = resolve_provider_api_key(provider_name, config)
    if provider_name == "groq" and not resolved_api_key:
        resolved_api_key = get_env("HF_API_KEY", required=False)
    if resolved_api_key:
        headers["Authorization"] = f"Bearer {resolved_api_key}"
    return headers


def _call_provider(
    provider_name: str,
    prompt: str,
    timeout: int | None = None,
) -> str:
    """Call one configured OpenAI-compatible provider."""
    config = get_provider_config(provider_name)
    url = _provider_url(provider_name, config)
    default_timeout = _config_int(config, "timeout", 120)
    body: dict[str, object] = {
        "model": _config_text(config, "model_name"),
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 1000,
        "temperature": 0.2,
    }
    response = requests.post(
        url,
        headers=_provider_headers(provider_name, config),
        json=body,
        timeout=timeout or default_timeout,
    )
    if response.status_code != 200:
        raise RuntimeError(f"AI error {response.status_code}: {response.text[:200]}")
    return _response_content(response)


def call_ai_client(
    prompt: str,
    stream: bool = False,
    timeout: int = 120,
    provider: str | None = None,
    use_cache: bool = True,
) -> str:
    """Call one provider with optional prompt-hash caching."""
    del stream  # Kept in the public signature for legacy callers.
    prompt_hash = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
    if use_cache and prompt_hash in _AI_CACHE:
        log.debug("Cache hit for prompt hash %s", prompt_hash[:8])
        return _AI_CACHE[prompt_hash]

    provider_name = provider or PRIMARY_PROVIDER
    config = get_provider_config(provider_name)
    content = _call_provider(
        provider_name,
        prompt,
        timeout=timeout or _config_int(config, "timeout", 120),
    )
    if content and use_cache:
        _AI_CACHE[prompt_hash] = content
        _save_cache(_AI_CACHE)
    return content


def call_ai_with_fallback(
    prompt: str,
    timeout_primary: int | None = None,
    timeout_fallback: int | None = None,
    max_chars_primary: int | None = None,
    use_cache: bool = True,
) -> tuple[str, str]:
    """Try the primary provider, then the configured fallback on failure."""
    prompt_hash = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
    if use_cache and prompt_hash in _AI_CACHE:
        log.debug("Cache hit for prompt hash %s", prompt_hash[:8])
        return _AI_CACHE[prompt_hash], "cache"

    primary_config = get_provider_config(PRIMARY_PROVIDER)
    max_chars = max_chars_primary or _config_int(
        primary_config,
        "max_content_chars",
        2000,
    )
    truncated_prompt = prompt
    if len(prompt) > max_chars:
        truncated_prompt = prompt[:max_chars] + "\n[... truncated ...]"
        log.debug(
            "Truncated prompt from %s to %s chars for %s",
            len(prompt),
            max_chars,
            PRIMARY_PROVIDER,
        )

    primary_timeout = timeout_primary or _config_int(primary_config, "timeout", 60)
    try:
        content = _call_provider(
            PRIMARY_PROVIDER,
            truncated_prompt,
            timeout=primary_timeout,
        )
        if content and use_cache:
            _AI_CACHE[prompt_hash] = content
            _save_cache(_AI_CACHE)
        return content, PRIMARY_PROVIDER
    except requests.exceptions.Timeout:
        log.warning(
            "%s timed out after %ss; trying %s",
            PRIMARY_PROVIDER,
            primary_timeout,
            FALLBACK_PROVIDER,
        )
    except Exception as error:  # noqa: BLE001 - fallback owns provider failures
        log.warning("%s failed: %s", PRIMARY_PROVIDER, str(error)[:100])

    if FALLBACK_PROVIDER:
        try:
            fallback_config = get_provider_config(FALLBACK_PROVIDER)
            fallback_timeout = timeout_fallback or _config_int(
                fallback_config,
                "timeout",
                300,
            )
            content = _call_provider(
                FALLBACK_PROVIDER,
                prompt,
                timeout=fallback_timeout,
            )
            if content and use_cache:
                _AI_CACHE[prompt_hash] = content
                _save_cache(_AI_CACHE)
            log.info("%s succeeded as fallback", FALLBACK_PROVIDER)
            return content, FALLBACK_PROVIDER
        except Exception as error:  # noqa: BLE001 - normalize both provider failures
            log.error("%s also failed: %s", FALLBACK_PROVIDER, str(error)[:100])
            raise RuntimeError(f"Both {PRIMARY_PROVIDER} and {FALLBACK_PROVIDER} failed") from error

    raise RuntimeError(f"{PRIMARY_PROVIDER} failed and no fallback configured")


def check_provider_availability(provider_name: str) -> bool:
    """Return whether one provider accepts a minimal chat request."""
    try:
        config = get_provider_config(provider_name)
        url = _provider_url(provider_name, config)
    except ValueError:
        return False
    body: dict[str, object] = {
        "model": _config_text(config, "model_name"),
        "messages": [{"role": "user", "content": "Hi"}],
        "max_tokens": 1,
    }
    try:
        response = requests.post(
            url,
            headers=_provider_headers(provider_name, config),
            json=body,
            timeout=30,
        )
        return response.status_code == 200
    except Exception as error:  # noqa: BLE001 - availability checks never escape
        log.warning("Provider %s check failed: %s", provider_name, error)
        return False


def check_model_availability() -> bool:
    """Compatibility alias for checking the primary provider."""
    return check_provider_availability(PRIMARY_PROVIDER)


def get_available_providers() -> dict[str, bool]:
    """Check every configured provider independently."""
    return {name: check_provider_availability(name) for name in PROVIDERS}
