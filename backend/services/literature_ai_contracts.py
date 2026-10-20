"""Output contracts supplied to the governed literature executor."""

from __future__ import annotations

from typing import Any


def _object(properties: dict[str, Any]) -> dict[str, Any]:
    return {"type": "object", "properties": properties, "required": list(properties)}


def literature_output_schema(operation: str, works: list[dict[str, Any]]) -> dict[str, Any]:
    """Describe each public result, including the selected evidence identifiers."""
    text = {"type": "string"}
    texts = {"type": "array", "items": text}
    concepts = {
        "type": "object",
        "additionalProperties": {"anyOf": [text, texts]},
    }
    identifiers = [str(work["id"]) for work in works if work.get("id")]
    selected_id = {"type": "string", "enum": identifiers} if identifiers else False
    variants = {
        "query_strategy": _object({
            "framework": text, "concepts": concepts, "synonyms": concepts,
            "boolean_query": {"type": "string", "minLength": 1}, "cautions": texts,
        }),
        "translate_query": _object({
            "source_id": text, "original_query": text,
            "translated_query": {"type": "string", "minLength": 1}, "warnings": texts,
        }),
        "screen": _object({
            "suggestions": {"type": "array", "items": _object({
                "id": selected_id,
                "suggestion": {"enum": ["include", "exclude", "uncertain"]},
                "rationale": text,
                "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                "evidence_level": {"enum": ["title_only", "title_and_abstract", "verified_full_text"]},
            })},
        }),
        "synthesize": _object({
            "summary": text, "themes": texts, "contradictions": texts,
            "gaps": texts, "next_searches": texts,
            "citations": {"type": "array", "items": selected_id, "uniqueItems": True},
        }),
        "snowball": _object({
            "backward_queries": texts, "forward_queries": texts,
            "identifiers": texts, "cautions": texts,
        }),
        "rerank": _object({
            "ranking": {"type": "array", "items": _object({
                "id": selected_id, "score": {"type": "number"},
                "original_rank": {"type": "integer", "minimum": 1},
                "semantic_rank": {"type": "integer", "minimum": 1},
            })},
            "explanation": text,
        }),
    }
    return variants[operation]
