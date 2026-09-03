import os
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional, Tuple

# Single source of truth for which providers run without an API key.
# Safe at import time: model_catalog only depends on stdlib + app_config.
from backend.agent.model_catalog import LOCAL_PROVIDER_IDS
from backend.security.keychain_manager import get_keychain


PROVIDER_CREDENTIAL_KEYS = {
    "groq": "groq_api_key",
    "openai": "openai_api_key",
    "anthropic": "anthropic_api_key",
    "openrouter": "openrouter_api_key",
    "google": "google_api_key",
    "perplexity": "perplexity_api_key",
    "together": "together_api_key",
    "fireworks": "fireworks_api_key",
    "xai": "xai_api_key",
    "deepseek": "deepseek_api_key",
    "mistral": "mistral_api_key",
    "cohere": "cohere_api_key",
    "voyage": "voyage_api_key",
    "novita": "novita_api_key",
    "siliconflow": "siliconflow_api_key",
}

PROVIDER_ENV_KEYS = {
    "groq": "GROQ_API_KEY",
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
    "google": "GOOGLE_API_KEY",
    "perplexity": "PERPLEXITY_API_KEY",
    "together": "TOGETHER_API_KEY",
    "fireworks": "FIREWORKS_API_KEY",
    "xai": "XAI_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
}

PROVIDER_MODELS = {
    "groq": ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
    "openai": ["gpt-4o", "gpt-4o-mini", "o1-preview", "o1-mini"],
    "anthropic": ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest", "claude-3-opus-latest"],
    "openrouter": [
        "openai/gpt-4o-mini",
        "anthropic/claude-3.5-sonnet",
        "meta-llama/llama-3.1-70b-instruct",
        "deepseek/deepseek-chat",
    ],
    "google": ["gemini-1.5-pro", "gemini-1.5-flash"],
    "perplexity": ["llama-3.1-sonar-large-128k-online", "llama-3.1-sonar-small-128k-online"],
    "together": [
        "meta-llama/Llama-3.1-405B-Instruct-Turbo",
        "meta-llama/Llama-3.1-70B-Instruct-Turbo",
        "mistralai/Mixtral-8x7B-Instruct-v0.1",
    ],
    "fireworks": [
        "accounts/fireworks/models/llama-v3p1-405b-instruct",
        "accounts/fireworks/models/llama-v3p1-70b-instruct",
    ],
    "xai": ["grok-2-1212", "grok-2-mini-1212", "grok-beta"],
    "deepseek": ["deepseek-chat", "deepseek-coder"],
    "mistral": ["mistral-large-latest", "pixtral-large-latest", "mistral-small-latest"],
    "cohere": ["command-r-plus", "command-v0.1"],
    "novita": ["meta-llama/llama-3.1-70b-instruct", "meta-llama/llama-3.1-8b-instruct"],
    "siliconflow": ["deepseek-ai/DeepSeek-V3", "meta-llama/Llama-3.1-70B-Instruct"],
    "voyage": ["voyage-2", "voyage-large-2"],
    "ollama": ["llama3.2:latest", "mistral", "phi3"],
    "generic": ["custom-model-1", "custom-model-2"],
}

PROVIDER_METADATA = {
    "groq": {"name": "Groq", "icon": "https://groq.com/favicon.ico"},
    "openai": {"name": "OpenAI", "icon": "https://openai.com/favicon.ico"},
    "anthropic": {"name": "Anthropic", "icon": "https://www.anthropic.com/favicon.ico"},
    "openrouter": {"name": "OpenRouter", "icon": "https://openrouter.ai/favicon.ico"},
    "google": {
        "name": "Google Gemini",
        "icon": "https://www.gstatic.com/lamda/images/favicon_v2_71f1146747ef16186b970.png",
    },
    "perplexity": {"name": "Perplexity", "icon": "https://www.perplexity.ai/favicon.ico"},
    "together": {"name": "Together AI", "icon": "https://www.together.ai/favicon.ico"},
    "fireworks": {"name": "Fireworks AI", "icon": "https://fireworks.ai/favicon.ico"},
    "xai": {"name": "xAI (Grok)", "icon": "https://x.ai/favicon.ico"},
    "deepseek": {"name": "DeepSeek", "icon": "https://www.deepseek.com/favicon.ico"},
    "mistral": {"name": "Mistral AI", "icon": "https://mistral.ai/img/favicon.ico"},
    "cohere": {"name": "Cohere", "icon": "https://cohere.com/favicon.ico"},
    "voyage": {"name": "Voyage AI", "icon": "https://voyageai.com/favicon.ico"},
    "novita": {"name": "Novita AI", "icon": "https://novita.ai/favicon.ico"},
    "siliconflow": {"name": "SiliconFlow", "icon": "https://siliconflow.cn/favicon.ico"},
    "ollama": {"name": "Ollama (Local)", "icon": ""},
    "generic": {"name": "Generic OpenAI", "icon": ""},
}


def credential_key_for_provider(provider_id: str) -> Optional[str]:
    normalized = (provider_id or "").strip().lower()
    mapped = PROVIDER_CREDENTIAL_KEYS.get(normalized)
    if mapped:
        return mapped
    if not normalized:
        return None
    safe = normalized.replace(" ", "_").replace("/", "_").replace(".", "_").replace("-", "_")
    return f"ai_provider_{safe}_credential"


def env_key_for_provider(provider_id: str) -> Optional[str]:
    return PROVIDER_ENV_KEYS.get((provider_id or "").strip().lower())


def env_keys_for_provider(provider_id: str) -> List[str]:
    """All env var names that may hold this provider's API key.

    Union of the legacy hardcoded map and whatever models.dev knows
    (e.g. google → GOOGLE_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY / GEMINI_API_KEY),
    so ANY catalog provider can be wired through the environment. Lazy import +
    broad except: this sits on hot request paths and the catalog must never
    break credential resolution.
    """
    keys: List[str] = []
    legacy = env_key_for_provider(provider_id)
    if legacy:
        keys.append(legacy)
    try:
        from backend.agent.model_catalog import catalog_env_keys

        for key in catalog_env_keys(provider_id):
            if key not in keys:
                keys.append(key)
    except Exception:
        pass
    return keys


def normalize_credential_ref(
    provider_id: str,
    provider_cfg: Mapping[str, object],
) -> Optional[str]:
    ref = (provider_cfg or {}).get("credential_ref")
    if isinstance(ref, str) and ref.strip():
        return ref.strip()
    key = credential_key_for_provider(provider_id)
    if not key:
        return None
    return f"__keychain__:{key}"


def resolve_provider_api_key(
    provider_id: str,
    provider_cfg: Mapping[str, object] | None,
) -> Optional[str]:
    cfg = provider_cfg or {}
    inline_key = cfg.get("api_key")
    if isinstance(inline_key, str) and inline_key.strip() and inline_key.strip() != "********":
        return inline_key.strip()

    # Try mapping pattern
    ref = normalize_credential_ref(provider_id, cfg)
    if not ref:
        # Fallback to canonical gnosi pattern
        ref = credential_key_for_provider(provider_id)

    if ref:
        # Check if it's already a __keychain__ ref
        key = ref.split(":", 1)[1] if ref.startswith("__keychain__:") else ref
        secure = get_keychain().get_credential(key)
        if secure:
            return secure

    # Final fallback to environment (legacy map + models.dev env names)
    for env_key in env_keys_for_provider(provider_id):
        env_value = os.environ.get(env_key)
        if env_value:
            return env_value

    return None


def set_provider_api_key(provider_id: str, api_key: str) -> Tuple[bool, Optional[str]]:
    key = credential_key_for_provider(provider_id)
    if not key:
        return False, None
    ok = get_keychain().save_credential(key, api_key)
    if not ok:
        return False, None
    return True, f"__keychain__:{key}"


def has_provider_api_key(
    provider_id: str,
    provider_cfg: Mapping[str, object] | None,
) -> bool:
    return bool(resolve_provider_api_key(provider_id, provider_cfg))


def sanitize_ai_config(ai_cfg: Dict[str, Any]) -> Dict[str, Any]:
    sanitized = dict(ai_cfg or {})
    providers = dict(sanitized.get("providers") or {})
    sanitized_providers: Dict[str, Any] = {}

    for provider_id, provider_cfg in providers.items():
        cfg = dict(provider_cfg or {})
        cfg.pop("api_key", None)
        cfg["credential_ref"] = normalize_credential_ref(provider_id, cfg)
        cfg["has_api_key"] = has_provider_api_key(provider_id, provider_cfg)
        cfg["enabled"] = cfg.get("enabled", True)
        sanitized_providers[provider_id] = cfg

    sanitized["providers"] = sanitized_providers
    return sanitized


def sanitize_ai_config_concurrently(ai_cfg: Dict[str, Any]) -> Dict[str, Any]:
    """Sanitize providers while resolving independent credential flags in parallel.

    System credential stores are blocking APIs. A Settings response must retain
    the exact ``has_api_key`` semantics, but it need not wait for each provider
    serially.
    """
    sanitized = dict(ai_cfg or {})
    providers = dict(sanitized.get("providers") or {})

    def sanitize_provider(item: Tuple[str, Any]) -> Tuple[str, Dict[str, Any]]:
        provider_id, provider_cfg = item
        cfg = dict(provider_cfg or {})
        cfg.pop("api_key", None)
        cfg["credential_ref"] = normalize_credential_ref(provider_id, cfg)
        cfg["has_api_key"] = has_provider_api_key(provider_id, provider_cfg)
        cfg["enabled"] = cfg.get("enabled", True)
        return provider_id, cfg

    items = list(providers.items())
    if len(items) < 2:
        sanitized_providers = dict(map(sanitize_provider, items))
    else:
        workers = min(8, len(items))
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="config-keychain") as pool:
            sanitized_providers = dict(pool.map(sanitize_provider, items))
    sanitized["providers"] = sanitized_providers
    return sanitized


def migrate_ai_provider_secrets(ai_cfg: Dict[str, Any]) -> Tuple[Dict[str, Any], bool]:
    updated_ai = dict(ai_cfg or {})
    providers = dict(updated_ai.get("providers") or {})
    changed = False

    for provider_id, provider_cfg in providers.items():
        cfg = dict(provider_cfg or {})
        inline_key = cfg.get("api_key")
        if isinstance(inline_key, str) and inline_key.strip() and inline_key.strip() != "********":
            ok, credential_ref = set_provider_api_key(provider_id, inline_key.strip())
            if ok and credential_ref:
                cfg.pop("api_key", None)
                cfg["credential_ref"] = credential_ref
                changed = True
        elif "api_key" in cfg:
            # Empty/masked leftovers (the edit modal posts api_key: "") must
            # not be persisted to params.yaml — plaintext key fields never
            # belong there, not even blank ones.
            cfg.pop("api_key", None)
            changed = True

        if "credential_ref" not in cfg:
            default_ref = normalize_credential_ref(provider_id, cfg)
            if default_ref:
                cfg["credential_ref"] = default_ref
                changed = True

        providers[provider_id] = cfg

    updated_ai["providers"] = providers
    return updated_ai, changed


def is_provider_connected(provider_id: str, provider_cfg: Optional[Dict[str, Any]]) -> bool:
    """Whether the router could actually use this provider right now.

    A provider the user toggled OFF is not connected, whatever credentials it
    has — same semantics as the router's availability check, so the UI never
    shows "connected" for a provider whose rows would be silently skipped.
    Local providers need no key. Configured providers go through the full
    resolution (keychain + env). UNconfigured providers only check env vars:
    keys saved from the UI always write a config entry too, so skipping the
    keychain there avoids ~160 keychain hits when annotating the full catalog.
    """
    normalized = (provider_id or "").strip().lower()
    if provider_cfg is not None and not provider_cfg.get("enabled", True):
        return False
    if normalized in LOCAL_PROVIDER_IDS:
        return True
    if provider_cfg is not None:
        return has_provider_api_key(normalized, provider_cfg)
    return any(os.environ.get(k) for k in env_keys_for_provider(normalized))


def get_ai_catalog_with_status(ai_cfg: Dict[str, Any]) -> Dict[str, Any]:
    """Provider list for the connect UI: the live model catalog (models.dev,
    ALL providers) annotated with local connection status. Providers that only
    exist in the legacy hardcoded map or in the user's config are appended so
    nothing previously offered disappears. Blocking (catalog may hit
    disk/network): call via asyncio.to_thread from async endpoints.
    """
    providers_cfg = dict((ai_cfg or {}).get("providers") or {})

    catalog_providers: List[Dict[str, Any]] = []
    try:
        from backend.agent.model_catalog import load_catalog

        catalog_providers = list(load_catalog().get("providers") or [])
    except Exception:
        catalog_providers = []

    providers: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for entry in catalog_providers:
        provider_id = entry.get("id") or ""
        if not provider_id:
            continue
        seen.add(provider_id)
        cfg = dict(providers_cfg.get(provider_id) or {})
        configured = provider_id in providers_cfg
        meta = PROVIDER_METADATA.get(provider_id, {})
        model_ids = [m.get("id") for m in (entry.get("models") or []) if m.get("id")]
        providers.append(
            {
                "id": provider_id,
                "name": entry.get("name") or meta.get("name") or provider_id.capitalize(),
                "icon": meta.get("icon", ""),
                "models": model_ids,
                "models_count": len(model_ids),
                "is_local": bool(entry.get("is_local")),
                "live": bool(entry.get("live")),
                "env": list(entry.get("env") or []),
                "doc": entry.get("doc") or "",
                "base_url": cfg.get("base_url", ""),
                "base_url_hint": entry.get("api") or "",
                "model_name": cfg.get("model_name", ""),
                "credential_ref": normalize_credential_ref(provider_id, cfg),
                "has_api_key": has_provider_api_key(provider_id, cfg)
                if configured
                else any(os.environ.get(k) for k in env_keys_for_provider(provider_id)),
                "connected": is_provider_connected(provider_id, cfg if configured else None),
                "configured": configured,
                "enabled": cfg.get("enabled", True),
            }
        )

    # Legacy/hand-configured providers missing from the catalog (e.g. generic,
    # voyage) keep their old hardcoded entry.
    for provider_id in sorted(set(list(PROVIDER_MODELS.keys()) + list(providers_cfg.keys()))):
        if provider_id in seen:
            continue
        cfg = dict(providers_cfg.get(provider_id) or {})
        configured = provider_id in providers_cfg
        meta = PROVIDER_METADATA.get(provider_id, {"name": provider_id.capitalize(), "icon": ""})
        model_ids = PROVIDER_MODELS.get(provider_id, [])
        providers.append(
            {
                "id": provider_id,
                "name": meta.get("name") or provider_id.capitalize(),
                "icon": meta.get("icon", ""),
                "models": model_ids,
                "models_count": len(model_ids),
                "is_local": provider_id in LOCAL_PROVIDER_IDS,
                "live": False,
                "env": env_keys_for_provider(provider_id),
                "doc": "",
                "base_url": cfg.get("base_url", ""),
                "base_url_hint": "",
                "model_name": cfg.get("model_name", ""),
                "credential_ref": normalize_credential_ref(provider_id, cfg),
                "has_api_key": has_provider_api_key(provider_id, cfg),
                "connected": is_provider_connected(provider_id, cfg if configured else None),
                "configured": configured,
                "enabled": cfg.get("enabled", True),
            }
        )

    return {"providers": providers}
