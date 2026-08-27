from typing import Dict


def _normalize(value):
    return (value or "").strip().lower()


def _merge_provider_maps(explicit_catalog: Dict, implicit_catalog: Dict):
    provider_map = {}

    for provider in explicit_catalog.get("providers", []):
        provider_map[_normalize(provider.get("id"))] = provider

    for provider in implicit_catalog.get("providers", []):
        key = _normalize(provider.get("id"))
        current = provider_map.get(key)
        if not current:
            provider_map[key] = provider
            continue

        current_auth = current.get("auth", {})
        provider_auth = provider.get("auth", {})
        merged_auth = {
            **current_auth,
            **provider_auth,
            "value": provider_auth.get("value") if provider_auth.get("value") is not None else current_auth.get("value"),
            "token": provider_auth.get("token") if provider_auth.get("token") is not None else current_auth.get("token"),
            "ref": provider_auth.get("ref") if provider_auth.get("ref") is not None else current_auth.get("ref"),
        }

        provider_map[key] = {
            **current,
            **provider,
            "auth": merged_auth,
        }

    return list(provider_map.values())


def _merge_model_maps(explicit_catalog: Dict, implicit_catalog: Dict):
    model_map = {}

    for model in explicit_catalog.get("models", []):
        provider_id = model.get("provider_id") or model.get("providerId")
        key = f"{_normalize(provider_id)}/{_normalize(model.get('id'))}"
        model_map[key] = model

    for model in implicit_catalog.get("models", []):
        provider_id = model.get("provider_id") or model.get("providerId")
        key = f"{_normalize(provider_id)}/{_normalize(model.get('id'))}"
        model_map[key] = model

    return list(model_map.values())


def merge_catalogs(explicit_catalog: Dict, implicit_catalog: Dict) -> Dict:
    mode = explicit_catalog.get("mode", "replace")
    providers = _merge_provider_maps(explicit_catalog, implicit_catalog)
    models = _merge_model_maps(explicit_catalog, implicit_catalog)

    if mode == "merge":
        return {
            **explicit_catalog,
            "providers": providers,
            "models": models,
            "defaults": {
                **implicit_catalog.get("defaults", {}),
                **explicit_catalog.get("defaults", {}),
            },
        }

    return {
        **explicit_catalog,
        "providers": implicit_catalog.get("providers", explicit_catalog.get("providers", [])),
        "models": implicit_catalog.get("models", explicit_catalog.get("models", [])),
    }
