"""Deterministic evidence and coverage gates for skill-generated reading plans."""

from __future__ import annotations

from collections import Counter

from backend.domains.llm_wiki.chunking import record, records


class ReadingPlanError(ValueError):
    """Keep repair evidence in memory, never in the persisted error message."""
    def __init__(self, errors: list[str], note_indices: list[int], coverage_invalid: bool,
                 primary: list[dict[str, object]], evidence: list[dict[str, object]]) -> None:
        super().__init__("Invalid reading plan: " + "; ".join(errors))
        self.batch_index: int | None = None
        self.note_indices = note_indices
        self.coverage_invalid = coverage_invalid
        self.primary = primary
        self.evidence = evidence


def _citations(
    note: dict[str, object], primary: list[dict[str, object]], evidence: list[dict[str, object]]
) -> list[str]:
    raw_citations = note.get("citations")
    citations = records(raw_citations)
    if not isinstance(raw_citations, list) or not citations or len(citations) != len(raw_citations):
        return ["Every note requires original citations"]
    errors = []
    for index, citation in enumerate(citations):
        quote = citation.get("quote")
        if not isinstance(quote, str) or not quote.strip():
            errors.append(f"citations[{index}]: Every citation needs an exact quote")
        elif not any(
            citation.get("segment_id") == s["id"] and quote in str(s["text"]) for s in evidence
        ):
            errors.append(f"citations[{index}]: Citations must be exact substrings of supplied original passages")
    if not any(
        c.get("segment_id") == note.get("source_segment_id") == s["id"]
        and isinstance(c.get("quote"), str) and str(c["quote"]) in str(s["text"])
        for c in citations
        for s in primary
    ):
        errors.append("Cite the primary passage where this idea originates: source_segment_id must "
                      "match a citation's segment_id, with an exact quote from that primary passage")
    return errors


def _coverage_errors(answer: dict[str, object], primary_ids: set[str]) -> list[str]:
    coverage = records(answer.get("coverage"))
    malformed = not isinstance(answer.get("coverage"), list) or coverage != answer["coverage"]
    malformed = malformed or any(not isinstance(row.get("segment_id"), str) for row in coverage)
    counts = Counter(str(row["segment_id"]) for row in coverage if isinstance(row.get("segment_id"), str))
    covered_ids = set(counts)
    missing, unknown = sorted(primary_ids - covered_ids), sorted(covered_ids - primary_ids)
    duplicates = sorted(key for key, count in counts.items() if count > 1)
    if not (malformed or missing or unknown or duplicates or any(not str(row.get("reason") or "").strip() for row in coverage)):
        return []
    # Reference samples make one repair actionable without echoing source text.
    samples = "; ".join(f"{name}={values[:12]}" for name, values in
                        (("missing", missing), ("unknown", unknown), ("duplicates", duplicates)) if values)
    return ["Account for every primary segment with a nonempty reason "
            f"(expected {len(primary_ids)} unique segments; missing {len(missing)}, unknown {len(unknown)}); {samples}"]


def _note_errors(note: object, primary: list[dict[str, object]], evidence: list[dict[str, object]]) -> list[str]:
    if not isinstance(note, dict) or not note.get("title") or not note.get("body_md"):
        return ["Each note needs a title and body_md"]
    errors = []
    if note.get("source_segment_id") not in [segment["id"] for segment in primary]:
        errors.append("Extract only from primary segments")
    return [*errors, *_citations(note, primary, evidence)]


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
    errors = _coverage_errors(answer, {str(segment["id"]) for segment in primary})
    coverage_invalid = bool(errors)
    note_indices = []
    notes = answer.get("notes")
    if not isinstance(notes, list):
        errors.append("notes must be a list")
    else:
        for index, note in enumerate(notes):
            note_errors = _note_errors(note, primary, evidence)
            if note_errors:
                note_indices.append(index)
            errors.extend(f"notes[{index}]: {error}" for error in note_errors)
    warnings = answer.get("warnings", [])
    if not isinstance(warnings, list) or any(not isinstance(item, str) for item in warnings):
        errors.append("warnings must be a list of strings")
    if errors:
        raise ReadingPlanError(errors, note_indices, coverage_invalid, primary, evidence)
