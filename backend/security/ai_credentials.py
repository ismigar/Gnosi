import os
from typing import Any, Dict, List, Optional, Tuple

from backend.security.keychain_manager import get_keychain


PROVIDER_CREDENTIAL_KEYS = {
    "groq": "groq_api_key",
    "openai": "openai_api_key",
    "anthropic": "anthropic_api_key",
    "openrouter": "openrouter_api_key",
    "google": "google_api_key",
}

PROVIDER_ENV_KEYS = {
    "groq": "GROQ_API_KEY",
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
    "google": "GOOGLE_API_KEY",
}

PROVIDER_MODELS = {
    "groq": ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
    "openai": ["gpt-4o", "gpt-4o-mini", "gpt-4.1-mini"],
    "anthropic": ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest", "claude-3-opus-latest"],
    "openrouter": ["openai/gpt-4o-mini", "anthropic/claude-3.5-sonnet", "meta-llama/llama-3.1-70b-instruct"],
    "google": ["gemini-1.5-pro", "gemini-1.5-flash"],
    "ollama": ["llama3.2", "qwen2.5", "mistral"],
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


def normalize_credential_ref(provider_id: str, provider_cfg: Dict[str, Any]) -> Optional[str]:
    ref = (provider_cfg or {}).get("credential_ref")
    if isinstance(ref, str) and ref.strip():
        return ref.strip()
    key = credential_key_for_provider(provider_id)
    if not key:
        return None
    return f"__keychain__:{key}"


def resolve_provider_api_key(provider_id: str, provider_cfg: Optional[Dict[str, Any]]) -> Optional[str]:
    cfg = provider_cfg or {}
    inline_key = cfg.get("api_key")
    if isinstance(inline_key, str) and inline_key.strip() and inline_key.strip() != "********":
        return inline_key.strip()

    ref = normalize_credential_ref(provider_id, cfg)
    if ref and ref.startswith("__keychain__:"):
        key = ref.split(":", 1)[1]
    else:
        key = ref or credential_key_for_provider(provider_id)

    if key:
        secure = get_keychain().get_credential(key)
        if secure:
            return secure

    env_key = env_key_for_provider(provider_id)
    if env_key:
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


def has_provider_api_key(provider_id: str, provider_cfg: Optional[Dict[str, Any]]) -> bool:
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
        sanitized_providers[provider_id] = cfg

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

        if "credential_ref" not in cfg:
            default_ref = normalize_credential_ref(provider_id, cfg)
            if default_ref:
                cfg["credential_ref"] = default_ref
                changed = True

        providers[provider_id] = cfg

    updated_ai["providers"] = providers
    return updated_ai, changed


def get_ai_catalog_with_status(ai_cfg: Dict[str, Any]) -> Dict[str, Any]:
    providers_cfg = dict((ai_cfg or {}).get("providers") or {})
    provider_ids = sorted(set(list(PROVIDER_MODELS.keys()) + list(providers_cfg.keys())))

    providers: List[Dict[str, Any]] = []
    for provider_id in provider_ids:
        cfg = dict(providers_cfg.get(provider_id) or {})
        providers.append(
            {
                "id": provider_id,
                "models": PROVIDER_MODELS.get(provider_id, []),
                "base_url": cfg.get("base_url", ""),
                "model_name": cfg.get("model_name", ""),
                "credential_ref": normalize_credential_ref(provider_id, cfg),
                "has_api_key": has_provider_api_key(provider_id, cfg),
            }
        )

    return {"providers": providers}