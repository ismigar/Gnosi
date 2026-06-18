from typing import Dict


def normalize_catalog(catalog: Dict) -> Dict:
    provider_map = {}
    for provider in catalog.get("providers", []):
        normalized_id = provider["id"].strip().lower()
        provider_map[normalized_id] = {**provider, "id": normalized_id}

    defaults = catalog.get("defaults", {})
    default_provider = defaults.get("provider", "").strip().lower()

    model_map = {}
    for model in catalog.get("models", []):
        provider_id = (model.get("provider_id") or model.get("providerId") or default_provider).strip().lower()
        model_id = model["id"].strip().lower()
        key = f"{provider_id}/{model_id}"
        model_map[key] = {**model, "provider_id": provider_id, "id": model_id}

    return {
        **catalog,
        "providers": sorted(provider_map.values(), key=lambda p: p["id"]),
        "models": sorted(model_map.values(), key=lambda m: (m.get("provider_id", ""), m["id"])),
    }
