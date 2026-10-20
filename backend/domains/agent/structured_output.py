"""Provider-enforced JSON for OpenRouter operations, with local validation retained."""
from __future__ import annotations

from copy import deepcopy
from typing import Any


def _has_dynamic_object(schema: Any) -> bool:
    """Strict provider schemas cannot represent arbitrary concept-map keys."""
    if isinstance(schema, list):
        return any(_has_dynamic_object(item) for item in schema)
    if not isinstance(schema, dict):
        return False
    if any(key in schema for key in ("oneOf", "allOf", "if", "then", "else", "prefixItems")):
        # These local contracts are outside the provider's strict subset.
        return True
    if schema.get("type") == "object" and (
        "properties" not in schema or isinstance(schema.get("additionalProperties"), dict)
    ):
        return True
    return any(_has_dynamic_object(value) for value in schema.values())


def constrain_output(model: Any, provider: str, schema: dict[str, Any] | None) -> Any:
    """Keep routing preferences and refuse silent parameter-dropping upstream."""
    if provider != "openrouter" or schema is None:
        return model
    from backend.agent.json_tool_model import JsonToolModel
    if isinstance(model, JsonToolModel):
        # The fallback tool protocol wraps the final answer in a JSON string.
        # Constrain the outer transport; validate the extracted answer locally.
        transport_schema = {"type": "object"} if model.schemas else schema
        return JsonToolModel(constrain_output(model.model, provider, transport_schema), model.schemas)
    if not callable(getattr(model, "bind", None)):
        raise ValueError("This model transport cannot enforce structured output")
    base = getattr(model, "bound", model)
    extra = deepcopy(getattr(base, "extra_body", None) or {})
    bound_extra = deepcopy(getattr(model, "kwargs", {}).get("extra_body", {}))
    preferences = {**extra.get("provider", {}), **bound_extra.get("provider", {})}
    extra.update(bound_extra)
    extra["provider"] = {**preferences, "require_parameters": True}
    # Dynamic dictionaries are valid JSON Schema but cannot be represented by
    # strict provider schemas. Keep the complete contract in the operation
    # envelope and validate/repair locally; constrain the transport to JSON.
    response_format = {"type": "json_object"} if _has_dynamic_object(schema) else {
        "type": "json_schema",
        "json_schema": {"name": "gnosi_operation", "strict": True, "schema": deepcopy(schema)},
    }
    return model.bind(response_format=response_format, extra_body=extra)
