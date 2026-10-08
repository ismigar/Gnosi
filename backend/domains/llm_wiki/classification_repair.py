"""Bounded, resumable classification of existing notes through the principal agent."""

from __future__ import annotations

import json
from collections.abc import Callable

import jsonschema

from backend.domains.llm_wiki.idea_classification import IDEA_DESCRIPTION
from backend.domains.vault.registry.records import is_record
from backend.services.agent_behavior import task_input


def batches(notes: list[dict[str, object]], maximum: int = 15) -> list[list[dict[str, object]]]:
    groups: list[list[dict[str, object]]] = []
    for note in notes:
        if len(json.dumps(note, ensure_ascii=False).encode()) > 24000:
            raise ValueError(
                "A note exceeds the bounded classification input; inspect it separately"
            )
        if (
            not groups
            or len(groups[-1]) >= maximum
            or len(json.dumps([*groups[-1], note], ensure_ascii=False).encode()) > 24000
        ):
            groups.append([])
        groups[-1].append(note)
    return groups


def output_schema(notes: list[dict[str, object]], labels: list[str]) -> dict[str, object]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["classifications"],
        "properties": {
            "classifications": {
                "type": "array",
                "minItems": len(notes),
                "maxItems": len(notes),
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["id", "values", "reason"],
                    "properties": {
                        "id": {"type": "string", "enum": [str(n["id"]) for n in notes]},
                        "values": {
                            "type": "array",
                            "maxItems": 1,
                            "items": {"type": "string", "enum": labels},
                        },
                        "reason": {"type": "string", "minLength": 1},
                    },
                },
            }
        },
    }


def classify(
    notes: list[dict[str, object]],
    labels: list[str],
    generate: Callable[[str, dict[str, object]], str],
) -> dict[str, dict[str, object]]:
    schema = output_schema(notes, labels)
    prompt = task_input(
        "knowledge.classify", methodology=IDEA_DESCRIPTION, allowed_labels=labels, notes=notes
    )
    raw = generate(prompt, schema)
    payload = json.loads(
        raw.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    )
    jsonschema.validate(payload, schema)
    result: dict[str, dict[str, object]] = {}
    for row in payload["classifications"]:
        if not is_record(row) or str(row["id"]) in result:
            raise ValueError("Repeated note classification")
        values = row["values"]
        assert isinstance(values, list)
        result[str(row["id"])] = {
            "value": values[0] if values else None,
            "reason": str(row["reason"]),
        }
    if set(result) != {str(n["id"]) for n in notes}:
        raise ValueError("Missing note classification")
    return result
