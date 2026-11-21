"""Carry a passage's supported notes across an independent correction."""
from __future__ import annotations

from typing import Any

from backend.domains.llm_wiki.chunking import records
from backend.domains.llm_wiki.reading_quality import validate_boundary_coverage
from backend.domains.llm_wiki.semantic_contracts import TEXT, obj


def amendment_schema(count: int) -> dict[str, Any]:
    return {"type": "array", "maxItems": count, "items": obj({
        "retained_note": {"type": "integer", "minimum": 1, "maximum": count},
        "replacement_note": {"type": "integer", "minimum": 0},
        "reason": TEXT, "evidence_quote": TEXT})}


def amended_passage(answer: dict[str, object], retained: list[dict[str, object]],
                    primary: dict[str, object]) -> dict[str, object]:
    passage = records(answer["passages"])[0]
    proposed = records(passage["notes"])
    amended: set[int] = set()
    replacements: set[int] = set()
    for change in records(answer.get("amendments")):
        original, replacement = int(str(change["retained_note"])), int(str(change["replacement_note"]))
        quote, reason = str(change["evidence_quote"]), str(change["reason"])
        if original in amended or (replacement and (replacement in replacements or replacement > len(proposed))):
            raise ValueError("Each amendment must identify a distinct retained note and an existing replacement or zero")
        if not reason.strip() or not quote.strip() or quote not in str(primary["text"]):
            raise ValueError("Explain each changed or excluded draft note with an exact primary quotation")
        validate_boundary_coverage(reason)
        amended.add(original)
        if replacement:
            replacements.add(replacement)
    kept = [note for i, note in enumerate(retained, 1) if i not in amended]
    return {**passage, "notes": [*kept, *(note for note in proposed if note not in kept)]}
