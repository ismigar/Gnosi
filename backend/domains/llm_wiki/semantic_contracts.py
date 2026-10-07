"""Small interpretation contracts; the application binds all persistent identities."""
from __future__ import annotations

from copy import deepcopy
from typing import Any

import jsonschema

from backend.domains.llm_wiki.chunking import record, records
from backend.domains.llm_wiki.reading_action_contracts import dimension_schema, validate_note_dimensions
from backend.domains.llm_wiki.reading_contracts import validate_notes
from backend.domains.llm_wiki.semantic_context import source_view
from backend.domains.llm_wiki.semantic_quote_contracts import source_key
from backend.domains.llm_wiki.reading_quality import validate_reviewed_prose


def obj(properties: dict[str, Any]) -> dict[str, Any]:
    return {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False}


TEXT = {"type": "string", "minLength": 1}
TEXTS = {"type": "array", "items": TEXT}
MAP_SCHEMA = obj({"summary": TEXT})


def fields(dimensions: list[dict[str, object]]) -> list[dict[str, object]]:
    return [{**{key: spec[key] for key in ("name", "type", "multiple", "allowed_labels", "value_schema") if key in spec},
             "field_id": f"property_{i + 1}"} for i, spec in enumerate(dimensions)]


def note_schema(dimensions: list[dict[str, object]]) -> dict[str, Any]:
    result = obj({"title": TEXT, "body_md": TEXT,
                  "quotes": {"type": "array", "minItems": 1, "items": TEXT},
                  "properties": dimension_schema(fields(dimensions))})
    # Application-owned provenance; optional for older literal checkpoints and
    # stripped from model-facing contracts before ID selection is requested.
    result["properties"]["quote_source_keys"] = {"type": "array", "items": TEXT}
    return result


def interpretation_schema(size: int, dimensions: list[dict[str, object]]) -> dict[str, Any]:
    return obj({"passages": {"type": "array", "minItems": size, "maxItems": size,
                            "items": obj({"reason": TEXT, "notes": {"type": "array", "items": note_schema(dimensions)}})},
                "themes": TEXTS, "questions": TEXTS, "contradictions": TEXTS, "warnings": TEXTS})


def review_schema(size: int, dimensions: list[dict[str, object]], *, require_resolution: bool = False,
                  allow_requests: bool = False) -> dict[str, Any]:
    replacement = note_schema(dimensions)
    change = obj({"note": {"type": "integer", "minimum": 1, "maximum": size},
                  "replacement": replacement, "omit_reason": TEXT})
    change["required"] = ["note"]
    change["oneOf"] = [{"required": ["replacement"], "not": {"required": ["omit_reason"]}},
                       {"required": ["omit_reason"], "not": {"required": ["replacement"]}}]
    result = obj({"assessment": TEXT, "changes": {"type": "array", "maxItems": size,
                "items": change}, "warnings": TEXTS,
                **({"unresolved_issues": TEXTS} if require_resolution else {})})
    if allow_requests:
        # Optional for literal adapters; the model-facing contract requires it.
        result["properties"]["evidence_requests"] = {"type": "array", "maxItems": 8, "items": obj({
            "note": {"type": "integer", "minimum": 1, "maximum": size}, "reason": TEXT,
            "document": {"type": "string"}, "query": {"type": "string"},
            "pages": {"type": "array", "maxItems": 4, "uniqueItems": True,
                      "items": {"type": "integer", "minimum": 1}}})}
    return result


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
    keys = value.get("quote_source_keys")
    if keys is not None and (not isinstance(keys, list) or not isinstance(quotes, list) or len(keys) != len(quotes)):
        raise ValueError("Each selected quote must retain its supplied source")
    for index, quote in enumerate(quotes if isinstance(quotes, list) else []):
        if isinstance(keys, list):
            matches = [s for s in [primary, *evidence] if source_key(source_view(s)) == keys[index]
                       and isinstance(quote, str) and quote in str(s["text"])]
        elif isinstance(quote, str) and quote in str(primary["text"]):
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
        validate_reviewed_prose(notes, evidence)
        validate_notes(plan, records(chunk.get("segments")), evidence)
        plans[str(chunk["id"])] = plan
    return plans


def semantic_note(note: dict[str, object], dimensions: list[dict[str, object]]) -> dict[str, object]:
    stored = record(note.get("dimensions"))
    return {"title": note["title"], "body_md": note["body_md"],
            "quotes": [c["quote"] for c in records(note.get("citations"))],
            "properties": {f"property_{i + 1}": stored.get(str(spec["field_id"]), []) for i, spec in enumerate(dimensions)}}


def bind_review(answer: dict[str, object], targets: list[tuple[dict[str, object], dict[str, object], list[dict[str, object]]]],
                dimensions: list[dict[str, object]], *, shared_evidence: list[dict[str, object]] | None = None) -> list[dict[str, object]]:
    validate_schema(answer, review_schema(len(targets), dimensions, require_resolution="unresolved_issues" in answer,
                                          allow_requests="evidence_requests" in answer))
    result = [deepcopy(note) for note, _, _ in targets]
    seen = set()
    for change in records(answer["changes"]):
        index = int(str(change["note"])) - 1
        if index in seen:
            raise ValueError("Review each changed note once")
        seen.add(index)
        if "omit_reason" in change:
            result[index]["_review_omission"] = change["omit_reason"]
            continue
        _, primary, evidence = targets[index]
        replacement = record(change["replacement"])
        # Keep the original evidence scope for already validated literal caches.
        # New selected citations can use the whole catalog with explicit binding.
        if "quote_source_keys" in replacement and shared_evidence is not None:
            evidence = shared_evidence
        result[index] = bind_note(replacement, primary, evidence, dimensions)
    return result
