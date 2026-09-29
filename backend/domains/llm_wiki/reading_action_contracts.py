"""Typed action payloads; source identity, coverage and citations are checked locally."""

from copy import deepcopy
from typing import Any


def _object(properties: dict[str, Any], required: list[str]) -> dict[str, Any]:
    return {"type": "object", "properties": properties, "required": required, "additionalProperties": False}


TEXT = {"type": "string", "minLength": 1}
OFFSET = {"type": "integer", "minimum": 0}
CITATION = _object({"segment_id": TEXT, "quote": TEXT}, ["segment_id", "quote"])
NOTE = {
    "type": "object", "required": ["title", "body_md", "source_segment_id", "citations"],
    "properties": {"title": TEXT, "body_md": TEXT, "source_segment_id": TEXT,
                   "citations": {"type": "array", "minItems": 1, "items": CITATION}},
}
PLAN = {
    "type": "object", "required": ["notes", "coverage"],
    "properties": {
        "notes": {"type": "array", "items": NOTE},
        "coverage": {"type": "array", "items": _object({"segment_id": TEXT, "reason": TEXT}, ["segment_id", "reason"])},
        "warnings": {"type": "array", "items": {"type": "string"}},
        "reviewed": {"type": "boolean"},
    },
}
ARGUMENT_SCHEMAS = {
    "index": _object({"offset": OFFSET, "limit": {"type": "integer", "minimum": 1, "maximum": 100}}, []),
    "read": _object({"chunk_id": TEXT}, ["chunk_id"]),
    "search": _object({"query": {**TEXT, "pattern": r"\S"}, "offset": OFFSET}, ["query"]),
    "remember": _object({"text": TEXT}, ["text"]),
    "save_plan": _object({"chunk_id": TEXT, "plan": PLAN}, ["chunk_id", "plan"]),
    "recall": _object({"chunk_id": TEXT}, ["chunk_id"]),
    "finish": _object({"summary": {"type": "string"}}, ["summary"]),
}
ACTION_SCHEMA = _object({
    "action": {"type": "string", "enum": list(ARGUMENT_SCHEMAS)},
    "arguments": {"anyOf": list(ARGUMENT_SCHEMAS.values())},
}, ["action", "arguments"])


def dimension_schema(dimensions: list[dict[str, object]]) -> dict[str, Any]:
    """Expose every configured AI field and its existing labels to the provider."""
    properties: dict[str, Any] = {}
    for spec in dimensions:
        labels = spec.get("allowed_labels")
        if not isinstance(labels, list) or not labels:
            continue
        value: dict[str, Any] = {
            "type": "array", "items": {"type": "string", "enum": labels},
        }
        if not spec.get("multiple"):
            value["maxItems"] = 1
        properties[str(spec["field_id"])] = value
    return _object(properties, list(properties))


def action_schemas(
    dimensions: list[dict[str, object]],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Keep static actions compatible while making configured classification explicit."""
    arguments = deepcopy(ARGUMENT_SCHEMAS)
    if dimensions:
        note = arguments["save_plan"]["properties"]["plan"]["properties"]["notes"]["items"]
        note["properties"]["dimensions"] = dimension_schema(dimensions)
        note["required"].append("dimensions")
    action = deepcopy(ACTION_SCHEMA)
    action["properties"]["arguments"]["anyOf"] = list(arguments.values())
    return action, arguments


def validate_note_dimensions(
    answer: dict[str, object], dimensions: list[dict[str, object]],
) -> None:
    """Reject omitted or invented classification before any note can be persisted."""
    if not dimensions or "requests" in answer:
        return
    import jsonschema  # type: ignore[import-untyped]
    notes = answer.get("notes")
    schema = dimension_schema(dimensions)
    for index, note in enumerate(notes if isinstance(notes, list) else []):
        if not isinstance(note, dict):
            continue  # The reading contract reports malformed notes.
        try:
            jsonschema.validate(note.get("dimensions"), schema)
        except jsonschema.ValidationError as error:
            raise ValueError(
                f"notes[{index}].dimensions: {error.message}. Return every configured field "
                "with existing labels; use [] only when no category is supported by the evidence."
            ) from error
