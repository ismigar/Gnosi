from typing import Dict, List, Optional

from ..catalog.merge import merge_catalogs
from ..catalog.normalize import normalize_catalog
from ..discovery.discovery_engine import run_provider_discovery
from ..io.config_loader import materialize_runtime_config
from ..secrets.resolver import resolve_auth_secret
from ..selection.selector import select_model


def resolve_effective_model(raw_config: Dict, context: Optional[Dict] = None) -> Dict:
    context = context or {}
    runtime_config = materialize_runtime_config(raw_config, env=context.get("env"))

    providers = []
    for provider in runtime_config.providers:
        resolved_auth = resolve_auth_secret(
            provider.auth,
            provider.id,
            env=context.get("env"),
            profiles=runtime_config.profiles,
            profile_name=context.get("profile_name"),
        )
        provider_dict = provider.model_dump() if hasattr(provider, "model_dump") else provider.dict()
        provider_dict["auth"] = resolved_auth.model_dump() if hasattr(resolved_auth, "model_dump") else resolved_auth.dict()
        providers.append(provider_dict)

    explicit_catalog = {
        "providers": providers,
        "models": [m.model_dump() if hasattr(m, "model_dump") else m.dict() for m in runtime_config.models],
        "mode": runtime_config.mode,
        "defaults": {
            "provider": runtime_config.defaults.provider,
            "model": runtime_config.defaults.model,
            "by_context": {
                key: value.model_dump() if hasattr(value, "model_dump") else value.dict()
                for key, value in runtime_config.defaults.by_context.items()
            },
        },
    }

    discovered = run_provider_discovery(context.get("plugins", []), {
        "profile_name": context.get("profile_name"),
        "env": context.get("env"),
    })

    merged = merge_catalogs(explicit_catalog, discovered)
    normalized = normalize_catalog(merged)

    selection = select_model(
        normalized,
        requested=context.get("requested"),
        context_id=context.get("context_id"),
        fallback=context.get("fallback"),
        allowlist=context.get("allowlist") or runtime_config.allowlist,
    )

    return {"catalog": normalized, "selection": selection}
