from typing import Dict, List, Optional


def _parse_ref(ref: str) -> Dict[str, Optional[str]]:
    if "/" in ref:
        provider, model = ref.split("/", 1)
        return {"provider": provider.strip().lower(), "model": model.strip().lower()}
    return {"provider": None, "model": ref.strip().lower()}


def _is_allowed(provider: str, model: str, allowlist: List[str]) -> bool:
    if not allowlist:
        return True
    return f"{provider}/{model}" in allowlist or model in allowlist


def select_model(catalog: Dict, requested: Optional[str] = None, context_id: Optional[str] = None,
                 fallback: Optional[str] = None, allowlist: Optional[List[str]] = None) -> Dict:
    allowlist = allowlist or []
    defaults = catalog.get("defaults", {})
    context_defaults = defaults.get("by_context", {}).get(context_id or "", {})

    primary_ref = requested or (
        f"{context_defaults.get('provider')}/{context_defaults.get('model')}"
        if context_defaults.get("provider") and context_defaults.get("model")
        else context_defaults.get("model")
    ) or (
        f"{defaults.get('provider')}/{defaults.get('model')}"
        if defaults.get("provider") and defaults.get("model")
        else defaults.get("model")
    )

    fallback_ref = fallback or context_defaults.get("fallback")

    attempted = []
    for ref in [primary_ref, fallback_ref]:
        if not ref:
            continue
        parsed = _parse_ref(ref)
        for model in catalog.get("models", []):
            model_provider = model.get("provider_id") or model.get("providerId")
            if parsed["provider"] and model_provider != parsed["provider"]:
                continue
            if model.get("id") != parsed["model"]:
                continue
            attempted.append({"provider": model_provider, "model": model.get("id")})
            if not _is_allowed(model_provider, model.get("id"), allowlist):
                continue
            return {
                "provider": model_provider,
                "model": model.get("id"),
                "fallback_used": ref == fallback_ref,
                "allowlist": allowlist,
                "attempted": attempted,
            }

    raise ValueError("No model could be selected with current defaults/fallback/allowlist rules")
