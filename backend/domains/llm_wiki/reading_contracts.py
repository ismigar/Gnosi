"""Deterministic evidence and coverage gates for skill-generated reading plans."""

from __future__ import annotations

from backend.domains.llm_wiki.chunking import record, records


def _citations(
    note: dict[str, object], primary: list[dict[str, object]], evidence: list[dict[str, object]]
) -> None:
    raw_citations = note.get("citations")
    citations = records(raw_citations)
    if not isinstance(raw_citations, list) or not citations or len(citations) != len(raw_citations):
        raise ValueError("Every note requires original citations")
    for citation in citations:
        quote = citation.get("quote")
        if not isinstance(quote, str) or not quote.strip():
            raise ValueError("Every citation needs an exact quote")
        if not any(
            citation.get("segment_id") == s["id"] and quote in str(s["text"]) for s in evidence
        ):
            raise ValueError("Citations must be exact substrings of supplied original passages")
    if not any(
        c.get("segment_id") == note.get("source_segment_id") == s["id"]
        and str(c["quote"]) in str(s["text"])
        for c in citations
        for s in primary
    ):
        raise ValueError("Cite the primary passage where this idea originates")


def validate_notes(
    answer: dict[str, object], primary: list[dict[str, object]], evidence: list[dict[str, object]]
) -> None:
    if "requests" in answer:
        request = record(answer["requests"])
        if not any(request.get(key) for key in ("segment_ids", "queries")):
            raise ValueError("Request original segment ids or search queries")
        for key in ("segment_ids", "queries"):
            values = request.get(key, [])
            if not isinstance(values, list) or any(not isinstance(item, str) for item in values):
                raise ValueError("Evidence requests must be lists of strings")
        return
    primary_ids = {segment["id"] for segment in primary}
    coverage = records(answer.get("coverage"))
    if (
        {row.get("segment_id") for row in coverage} != primary_ids
        or len(coverage) != len(primary_ids)
        or any(not row.get("reason") for row in coverage)
    ):
        raise ValueError("Account for every primary segment with a nonempty reason")
    notes = answer.get("notes")
    if not isinstance(notes, list):
        raise ValueError("notes must be a list")
    for note in notes:
        if not isinstance(note, dict) or not note.get("title") or not note.get("body_md"):
            raise ValueError("Each note needs a title and body_md")
        if note.get("source_segment_id") not in primary_ids:
            raise ValueError("Extract only from primary segments")
        _citations(note, primary, evidence)
    warnings = answer.get("warnings", [])
    if not isinstance(warnings, list) or any(not isinstance(item, str) for item in warnings):
        raise ValueError("warnings must be a list of strings")
