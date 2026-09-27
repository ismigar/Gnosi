"""Normalize model registry budget settings."""
from typing import Any

JsonObject = dict[str, Any]


def sanitize_budget(raw: JsonObject) -> JsonObject:
    """Keep only known budget keys, safely typed; drop everything else."""
    budget: JsonObject = {
        "prefer_local": bool(raw.get("prefer_local")),
        "prefer_local_below": int(raw.get("prefer_local_below") or 0),
        "enforce_block": bool(raw.get("enforce_block")),
    }
    if raw.get("remaining_tokens") not in (None, ""):
        try:
            budget["remaining_tokens"] = int(raw["remaining_tokens"])
        except (TypeError, ValueError):
            pass
    try:
        cap = float(raw.get("monthly_cost_cap") or 0)
        if cap > 0:
            budget["monthly_cost_cap"] = round(cap, 2)
    except (TypeError, ValueError):
        pass
    return budget
