from typing import Dict, List


def run_provider_discovery(plugins: List, context: Dict | None = None) -> Dict:
    context = context or {}
    ordered = sorted(plugins, key=lambda plugin: (plugin.order, plugin.id))

    providers = []
    models = []

    for plugin in ordered:
        result = plugin.discover(context)
        providers.extend(result.get("providers", []))
        models.extend(result.get("models", []))

    return {"providers": providers, "models": models}
