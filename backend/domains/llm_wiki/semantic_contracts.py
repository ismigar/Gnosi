"""Small interpretation contracts; the application binds all persistent identities."""
from __future__ import annotations

from copy import deepcopy
from typing import Any

import jsonschema

from backend.domains.llm_wiki.chunking import record, records
from backend.domains.llm_wiki.reading_action_contracts import dimension_schema, validate_note_dimensions
from backend.domains.llm_wiki.reading_contracts import validate_notes


def obj(properties: dict[str, Any]) -> dict[str, Any]:
    return {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False}


TEXT = {"type": "string", "minLength": 1}
TEXTS = {"type": "array", "items": TEXT}
MAP_SCHEMA = obj({"summary": TEXT})


def fields(dimensions: list[dict[str, object]]) -> list[dict[str, object]]:
    return [{**{key: spec[key] for key in ("name", "type", "multiple", "allowed_labels", "value_schema") if key in spec},
             "field_id": f"property_{i + 1}"} for i, spec in enumerate(dimensions)]


def note_schema(dimensions: list[dict[str, object]]) -> dict[str, Any]:
    return obj({"title": TEXT, "body_md": TEXT,
                "quotes": {"type": "array", "minItems": 1, "items": TEXT},
                "properties": dimension_schema(fields(dimensions))})


def interpretation_schema(size: int, dimensions: list[dict[str, object]]) -> dict[str, Any]:
    return obj({"passages": {"type": "array", "minItems": size, "maxItems": size,
                            "items": obj({"reason": TEXT, "notes": {"type": "array", "items": note_schema(dimensions)}})},
                "themes": TEXTS, "questions": TEXTS, "contradictions": TEXTS, "warnings": TEXTS})


def review_schema(size: int, dimensions: list[dict[str, object]]) -> dict[str, Any]:
    return obj({"assessment": TEXT, "changes": {"type": "array", "maxItems": size,
                "items": obj({"note": {"type": "integer", "minimum": 1, "maximum": size},
                              "replacement": note_schema(dimensions)})}, "warnings": TEXTS})


def validate_schema(answer: dict[str, object], schema: dict[str, Any]) -> None:
    try:
        jsonschema.validate(answer, schema, format_checker=jsonschema.FormatChecker())
    except jsonschema.ValidationError as error:
        path = ".".join(map(str, error.absolute_path)) or "response"
        raise ValueError(f"{path}: {error.message[:500]}") from error


def bind_note(value: dict[str, object], primary: dict[str, object], evidence: list[dict[str, object]],
              dimensions: list[dict[str, object]]) -> dict[str, object]:
    """Never fix or guess a quote. Prefer its known primary; reject ambiguous support."""
    citations = []
    quotes = value.get("quotes", [])
    for quote in quotes if isinstance(quotes, list) else []:
        if isinstance(quote, str) and quote in str(primary["text"]):
            matches = [primary]
        else:
            matches = [s for s in evidence if isinstance(quote, str) and quote in str(s["text"])]
        identifiers = {str(s["id"]) for s in matches}
        if len(identifiers) != 1:
            raise ValueError("Quote must occur verbatim in the supplied original and identify one source passage")
        citations.append({"segment_id": next(iter(identifiers)), "quote": quote})
    properties = record(value.get("properties"))
    note = {"title": value.get("title"), "body_md": value.get("body_md"),
            "source_segment_id": primary["id"], "citations": citations,
            "dimensions": {str(spec["field_id"]): properties.get(f"property_{i + 1}") for i, spec in enumerate(dimensions)}}
    plan: dict[str, object] = {"notes": [note], "coverage": [{"segment_id": primary["id"], "reason": "interpreted"}]}
    validate_notes(plan, [primary], evidence)
    validate_note_dimensions(plan, dimensions)
    return note


def bind_interpretation(answer: dict[str, object], chunks: list[dict[str, object]],
                        evidence: list[dict[str, object]], dimensions: list[dict[str, object]]) -> dict[str, Any]:
    primary = [s for c in chunks for s in records(c.get("segments"))]
    validate_schema(answer, interpretation_schema(len(primary), dimensions))
    passages = iter(records(answer["passages"]))
    plans = {}
    for chunk in chunks:
        notes: list[dict[str, object]] = []
        coverage = []
        for segment in records(chunk.get("segments")):
            passage = next(passages)
            notes.extend(bind_note(n, segment, evidence, dimensions) for n in records(passage["notes"]))
            coverage.append({"segment_id": segment["id"], "reason": passage["reason"]})
        plan: dict[str, object] = {"notes": notes, "coverage": coverage, "warnings": answer["warnings"], "evidence_segments": evidence}
        validate_notes(plan, records(chunk.get("segments")), evidence)
        plans[str(chunk["id"])] = plan
    return plans


def semantic_note(note: dict[str, object], dimensions: list[dict[str, object]]) -> dict[str, object]:
    stored = record(note.get("dimensions"))
    return {"title": note["title"], "body_md": note["body_md"],
            "quotes": [c["quote"] for c in records(note.get("citations"))],
            "properties": {f"property_{i + 1}": stored.get(str(spec["field_id"]), []) for i, spec in enumerate(dimensions)}}


def bind_review(answer: dict[str, object], targets: list[tuple[dict[str, object], dict[str, object], list[dict[str, object]]]],
                dimensions: list[dict[str, object]]) -> list[dict[str, object]]:
    validate_schema(answer, review_schema(len(targets), dimensions))
    result = [deepcopy(note) for note, _, _ in targets]
    seen = set()
    for change in records(answer["changes"]):
        index = int(str(change["note"])) - 1
        if index in seen:
            raise ValueError("Review each changed note once")
        seen.add(index)
        _, primary, evidence = targets[index]
        result[index] = bind_note(record(change["replacement"]), primary, evidence, dimensions)
    return result
