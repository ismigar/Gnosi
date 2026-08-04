import json
from typing import Dict


def build_catalog_snapshot(catalog: Dict) -> str:
    stable = {
        **catalog,
        "providers": sorted(catalog.get("providers", []), key=lambda p: p["id"]),
        "models": sorted(catalog.get("models", []), key=lambda m: (m.get("provider_id", ""), m["id"])),
    }
    return json.dumps(stable, indent=2, sort_keys=True)
