"""Minimize planning metadata without removing executable constraints."""
from __future__ import annotations

from copy import deepcopy
from typing import Any

from backend.services.agent_team_contracts import explicit_output_keys, initial_greeting


def economical_planning(data: dict[str, Any]) -> bool:
    """Reduce effort only after the current text operation is unambiguous."""
    return initial_greeting(data) or (
        data.get("required_operation") in {"writing", "translation"}
        and not data.get("authorized_tool_names")
        and not explicit_output_keys(str(data.get("request") or "")))


def compact_plan_schema(schema: dict[str, Any], *, temporary: bool) -> dict[str, Any]:
    result = deepcopy(schema)
    if not temporary:
        result["$defs"]["TeamTask"]["properties"]["temporary"] = {"type": "null"}
        result["$defs"].pop("TemporaryAgentSpec", None)

    def compact(node: dict[str, Any]) -> None:
        for annotation in ("title", "default"):
            node.pop(annotation, None)
        for key in ("properties", "$defs", "patternProperties", "dependentSchemas"):
            for child in node.get(key, {}).values():
                if isinstance(child, dict):
                    compact(child)
        for key in ("items", "additionalProperties", "not", "if", "then", "else"):
            if isinstance(node.get(key), dict):
                compact(node[key])
        for key in ("anyOf", "oneOf", "allOf", "prefixItems"):
            for child in node.get(key, []):
                if isinstance(child, dict):
                    compact(child)
    compact(result)
    return result
