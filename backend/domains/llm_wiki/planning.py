"""Typed planning and grounding rules for LLM Wiki ingestion."""

from __future__ import annotations

import hashlib
import json
import logging
import re
from collections.abc import Callable

from backend.utils.open_values import integer_value

LocatorLabel = Callable[[dict[str, object]], str]
NormalizeText = Callable[[object], str]
ValidateDimensions = Callable[
    [object, dict[str, dict[str, object]]],
    dict[str, object],
]


def build_chunk_prompt(
    chunk: dict[str, object],
    source_title: str,
    brain_index: list[dict[str, object]],
    language: str,
    ai_dimensions: list[dict[str, object]],
    *,
    locator_label: LocatorLabel,
) -> str:
    """Build the frozen JSON-only prompt for one ordered source chunk."""
    index_lines = (
        "\n".join(
            f"- [{item['id']}] {item['title']} ({item['type']})"
            for item in brain_index
            if item.get("title")
        )
        or "(empty Brain)"
    )
    segment_lines = "\n\n".join(
        f"[SEGMENT {segment['id']} | "
        f"{locator_label(_mapping(segment.get('locator')))}]\n{segment['text']}"
        for segment in _mapping_list(chunk.get("segments"))
    )
    dimension_lines = (
        "\n".join(
            f"- field_id={item['field_id']} name={item['name']} "
            f"allowed={json.dumps(item['allowed_labels'], ensure_ascii=False)}"
            for item in ai_dimensions
        )
        or "(no AI-classified fields)"
    )
    return f"""You maintain a persistent personal knowledge wiki using atomic Zettelkasten
reading notes. Process this ordered SOURCE CHUNK completely.

Rules:
- Write in {language}.
- Each note contains exactly ONE idea. Split distinct ideas into distinct notes.
- Preserve source order, not importance order.
- Ground every note in at least one exact source segment.
- citation.quote must be a verbatim substring of the cited segment.
- Return source_segment_id for the segment where the idea first appears.
- Never propose or create permanent notes.
- Existing Brain notes are context for wikilinks only; do not ask to overwrite them.
- For dimensions, use only the listed allowed labels. Omit a field when no label fits.

RESOURCE: {source_title}
ORIGIN: {chunk.get("origin_label")} ({chunk.get("kind")})

SOURCE SEGMENTS:
{segment_lines}

OPTIONAL AI DIMENSIONS:
{dimension_lines}

COMPACT BRAIN INDEX:
{index_lines}

Return only valid JSON:
{{
  "summary": "short chunk summary",
  "notes": [
    {{
      "title": "atomic idea title",
      "type": "entitat|concepte|resum|síntesi",
      "body_md": "one-idea markdown body with useful [[wikilinks]]",
      "tags": ["optional", "tags"],
      "source_segment_id": "exact SEGMENT id",
      "dimensions": {{"brain-field-id": ["allowed label"]}},
      "citations": [
        {{"segment_id": "exact SEGMENT id", "quote": "verbatim source substring"}}
      ]
    }}
  ]
}}"""


def parse_plan(text: str, *, logger: logging.Logger) -> dict[str, object]:
    """Parse and normalize the model's JSON write plan."""
    if not text:
        return {"summary": "", "notes": []}
    cleaned = re.sub(
        r"^```(?:json)?|```$",
        "",
        text.strip(),
        flags=re.MULTILINE,
    ).strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    candidate = cleaned[start : end + 1] if start != -1 and end > start else cleaned
    try:
        loaded: object = json.loads(candidate)
    except Exception:
        logger.warning("llm_wiki could not parse the model plan as JSON")
        return {"summary": "", "notes": []}
    if not isinstance(loaded, dict):
        return {"summary": "", "notes": []}
    data: dict[str, object] = dict(loaded)
    notes = data.get("notes")
    data["notes"] = (
        [dict(note) for note in notes if isinstance(note, dict) and note.get("title")]
        if isinstance(notes, list)
        else []
    )
    return data


def validate_and_reduce_plans(
    plans: list[tuple[dict[str, object], dict[str, object]]],
    origins: list[dict[str, object]],
    ai_dimensions: list[dict[str, object]],
    *,
    normalized_text: NormalizeText,
    validate_dimensions: ValidateDimensions,
) -> tuple[list[dict[str, object]], list[str]]:
    """Validate evidence, classify dimensions, and assign stable managed keys."""
    segments = {
        str(segment.get("id")): {
            **segment,
            "origin_id": origin["origin_id"],
            "origin_order": integer_value(origin.get("input_order") or 0),
            "origin_label": origin.get("label") or origin.get("kind"),
            "snapshot_id": origin.get("snapshot_id"),
            "source_url": origin.get("source_url"),
        }
        for origin in origins
        for segment in _mapping_list(origin.get("segments"))
    }
    allowed_by_field = {str(item["field_id"]): item for item in ai_dimensions}
    counters: dict[tuple[str, str], int] = {}
    reduced: list[dict[str, object]] = []
    warnings: list[str] = []
    seen_evidence: set[tuple[str, str, str]] = set()

    for chunk, plan in plans:
        chunk_segment_ids = {str(item.get("id")) for item in _mapping_list(chunk.get("segments"))}
        for note in _mapping_list(plan.get("notes")):
            citations = _validated_citations(
                note,
                segments,
                chunk_segment_ids,
                normalized_text,
            )
            if not citations:
                warnings.append(f"Ungrounded model note skipped: {note.get('title')}")
                continue
            first_segment_id = str(note.get("source_segment_id") or citations[0]["segment_id"])
            if first_segment_id not in segments:
                first_segment_id = str(citations[0]["segment_id"])
            first_segment = segments[first_segment_id]
            counter_key = (str(first_segment["origin_id"]), first_segment_id)
            counters[counter_key] = counters.get(counter_key, 0) + 1
            managed_key = hashlib.sha256(
                (f"{first_segment['origin_id']}|{first_segment_id}|{counters[counter_key]}").encode(
                    "utf-8"
                )
            ).hexdigest()[:24]
            evidence_key = (
                str(first_segment["origin_id"]),
                first_segment_id,
                normalized_text(note.get("title")),
            )
            if evidence_key in seen_evidence:
                continue
            seen_evidence.add(evidence_key)
            reduced.append(
                {
                    **note,
                    "managed_key": managed_key,
                    "citations": citations,
                    "dimensions": validate_dimensions(
                        note.get("dimensions"),
                        allowed_by_field,
                    ),
                    "origin_id": first_segment["origin_id"],
                    "origin_order": first_segment["origin_order"],
                    "origin_label": first_segment["origin_label"],
                    "source_segment_id": first_segment_id,
                    "segment_order": integer_value(first_segment.get("order") or 0),
                }
            )

    reduced.sort(key=_reduced_note_order)
    for position, note in enumerate(reduced, start=1):
        note["position"] = position
    return reduced, warnings


def validate_ai_dimensions(
    raw: object,
    allowed_by_field: dict[str, dict[str, object]],
) -> dict[str, object]:
    """Map model labels to the configured canonical field values."""
    if not isinstance(raw, dict):
        return {}
    output: dict[str, object] = {}
    for raw_field_id, values in raw.items():
        field_id = str(raw_field_id)
        spec = allowed_by_field.get(field_id)
        if not spec:
            continue
        candidates = values if isinstance(values, list) else [values]
        labels = spec.get("by_label")
        by_label = labels if isinstance(labels, dict) else {}
        mapped = [
            by_label[str(value).strip().casefold()]
            for value in candidates
            if str(value).strip().casefold() in by_label
        ]
        if mapped:
            output[field_id] = mapped if bool(spec.get("multiple")) else mapped[0]
    return output


def _validated_citations(
    note: dict[str, object],
    segments: dict[str, dict[str, object]],
    chunk_segment_ids: set[str],
    normalized_text: NormalizeText,
) -> list[dict[str, object]]:
    citations: list[dict[str, object]] = []
    for citation in _mapping_list(note.get("citations")):
        segment_id = str(citation.get("segment_id") or note.get("source_segment_id") or "")
        segment = segments.get(segment_id)
        quote = " ".join(str(citation.get("quote") or "").split()).strip()
        if not segment or segment_id not in chunk_segment_ids or not quote:
            continue
        if normalized_text(quote) not in normalized_text(segment.get("text")):
            continue
        citations.append(
            {
                "segment_id": segment_id,
                "quote": quote,
                "locator": segment.get("locator") or {},
                "origin_id": segment["origin_id"],
                "origin_label": segment["origin_label"],
                "snapshot_id": segment["snapshot_id"],
                "source_url": segment["source_url"],
            }
        )
    return citations


def _reduced_note_order(note: dict[str, object]) -> tuple[int, int, str]:
    return (
        integer_value(note.get("origin_order") or 0),
        integer_value(note.get("segment_order") or 0),
        str(note.get("managed_key") or ""),
    )


def _mapping(value: object) -> dict[str, object]:
    return dict(value) if isinstance(value, dict) else {}


def _mapping_list(value: object) -> list[dict[str, object]]:
    return (
        [dict(item) for item in value if isinstance(item, dict)] if isinstance(value, list) else []
    )


__all__ = [
    "build_chunk_prompt",
    "parse_plan",
    "validate_ai_dimensions",
    "validate_and_reduce_plans",
]
