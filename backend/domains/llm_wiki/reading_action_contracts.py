"""Typed action payloads; source identity, coverage and citations are checked locally."""

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
