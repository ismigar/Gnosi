"""Direct OpenAI models used by the Knowledge plugin, verified 2026-11-20.

https://developers.openai.com/api/docs/models/gpt-5.6-luna
https://developers.openai.com/api/docs/models/gpt-6.2-sol
"""
from __future__ import annotations

from typing import Any

DEFAULT_OFFERS: dict[str, tuple[str, float, float]] = {
    "gpt-5.6-luna": ("GPT-5.6 Luna", 0.20, 1.20),
    "gpt-6.2-sol": ("GPT-6.2 Sol", 2.00, 10.00),
}


def supply_reading_models(catalog: dict[str, Any]) -> None:
    for provider in catalog.get("providers", []):
        if provider.get("id") != "openai":
            continue
        models = provider.setdefault("models", [])
        known = {row.get("id") for row in models}
        for identifier, (name, inputs, outputs) in DEFAULT_OFFERS.items():
            if identifier not in known:
                models.append({"id": identifier, "name": name, "cost_in": inputs, "cost_out": outputs,
                               "pricing_known": True, "context_window": 1_050_000, "modes": ["text", "image"],
                               "tags": ["reasoning", "tools", "vision", "long"]})
