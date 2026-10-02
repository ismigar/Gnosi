"""Frozen destination candidates for generated relations, checked before save."""

from dataclasses import dataclass
import hashlib
import json
from typing import Any

from fastapi import HTTPException

from backend.services.agent_execution_scope import current_scope, revalidate_scope
from backend.services.button_field_execution import relation_title_candidates

MAX_RELATION_CONTEXT_CHARS = 180_000


def _encoded(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str, allow_nan=False)


@dataclass(frozen=True)
class ButtonRelationContext:
    fields: tuple[dict[str, Any], ...]
    candidates: tuple[dict[str, object], ...]
    revision: str

    def validate(self) -> None:
        if not self.fields:
            return
        revalidate_scope(current_scope())
        latest = build_button_relation_context(list(self.fields))
        if latest.revision != self.revision:
            raise HTTPException(409, "Relation candidates changed while generating field values")


def build_button_relation_context(fields: list[dict[str, Any]]) -> ButtonRelationContext:
    relations = [dict(field) for field in fields if field.get("type") == "relation"]
    if not relations:
        return ButtonRelationContext((), (), "")
    revalidate_scope(current_scope())
    destinations = {}
    context: list[dict[str, object]] = []
    for field in sorted(relations, key=lambda item: str(item.get("id") or item["name"])):
        target = field.get("relation_database_id")
        if not isinstance(target, str) or not target:
            raise HTTPException(422, "Relation context requires a destination table")
        if target not in destinations:
            destinations[target] = relation_title_candidates(field, include_context=True)
        context.append({"field": field["name"], "destination_table": target,
                        "candidate_count": len(destinations[target]), "complete_indexed_candidates": True, "complete_candidate_content": True,
                        "candidates": destinations[target]})
        if len(_encoded(context)) > MAX_RELATION_CONTEXT_CHARS:
            raise HTTPException(413, "Relation context exceeds the operation budget; narrow the destination table")
    encoded = _encoded(context)
    # Expose only JSON-safe values to the model, including dates in metadata.
    return ButtonRelationContext(tuple(relations), tuple(json.loads(encoded)), hashlib.sha256(encoded.encode()).hexdigest())
