"""Require an explicit memory correction while preserving the original draft."""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any, cast

import jsonschema

from backend.domains.llm_wiki.reading_action_contracts import PLAN
from backend.domains.llm_wiki.reading_memory import update_memory


def _owner(answer: dict[str, Any]) -> dict[str, Any]:
    args = answer["arguments"]
    return cast(dict[str, Any], args["plan"] if answer["action"] == "save_plan" else args)


def _replace(answer: dict[str, Any], value: dict[str, Any]) -> None:
    owner = _owner(answer)
    owner.pop("memory", None)
    owner.pop("memory_updates", None)
    owner.update(value)
    if answer["action"] == "save_batch":
        for entry in owner["plans"]:
            entry["plan"].pop("memory", None)
            entry["plan"].pop("memory_updates", None)


@dataclass
class MemoryRepair:
    current: str
    schema: dict[str, Any]

    def probe(self, answer: dict[str, Any]) -> None:
        # This private placeholder only exposes other invalid fields. A required
        # model-authored patch replaces it before any result can be validated.
        _replace(answer, {"memory": self.current or "Memory correction pending"})

    def restore(self, answer: dict[str, Any], value: dict[str, Any]) -> None:
        jsonschema.validate(value, self.schema)
        update_memory(self.current, value)  # Reject missing/ambiguous anchors again.
        _replace(answer, value)


def prepare_memory_repair(answer: dict[str, Any], request: dict[str, Any]) -> MemoryRepair | None:
    """Collect misplaced, contradictory or inapplicable memory edits, not guesses."""
    if answer.get("action") not in {"save_plan", "save_batch"} or not isinstance(request.get("memory"), str):
        return None
    owner = _owner(answer)
    misplaced = answer["action"] == "save_batch" and any(
        "memory" in entry["plan"] or "memory_updates" in entry["plan"] for entry in owner["plans"])
    try:
        update_memory(request["memory"], owner)
        invalid = False
    except ValueError:
        invalid = True
    if not (misplaced or invalid):
        return None
    schema = {"type": "object", "additionalProperties": False,
              "properties": {key: deepcopy(PLAN["properties"][key]) for key in ("memory", "memory_updates")},
              "oneOf": [{"required": ["memory"]}, {"required": ["memory_updates"]}]}
    return MemoryRepair(request["memory"], schema)
