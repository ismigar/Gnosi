"""Offer a reviewer highlightable excerpts for individual rejected citations."""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from backend.domains.llm_wiki.chunking import record, records
from backend.domains.llm_wiki.pdf_review_excerpts import quote_bindings
from backend.domains.llm_wiki.reading_batch_recovery import PassageReviewIssue
from backend.domains.llm_wiki.semantic_context import source_view
from backend.domains.llm_wiki.semantic_contracts import bind_note_sources
from backend.domains.llm_wiki.semantic_quote_contracts import segment_source_key
from backend.domains.llm_wiki.semantic_repairs import quote_choices

if TYPE_CHECKING:
    from backend.domains.llm_wiki.contextual_reading import ContextualReader
    from backend.domains.llm_wiki.semantic_quote_selection import QuoteSelection

CitationCheck = Callable[[list[dict[str, object]], list[dict[str, object]]], list[list[str]]]
CitationRef = tuple[int, int, dict[str, object], dict[str, object]]


@dataclass(frozen=True)
class CitationSlot:
    change: int
    quote: int
    choices: tuple[str, ...]

    @property
    def name(self) -> str:
        return f"change_{self.change + 1}_quote_{self.quote + 1}"


class AuditCitationIssue(PassageReviewIssue):
    def __init__(self, alternatives: Callable[[], list[CitationSlot]]) -> None:
        super().__init__("Review corrections must use valid source citations")
        self.alternatives = alternatives


@dataclass(frozen=True)
class SourceAuditValidator:
    """Keep the actual originals available when a paired literal fails before binding."""
    validate: Callable[[dict[str, object]], None]
    worker: ContextualReader
    sources: list[dict[str, object]]

    def __call__(self, answer: dict[str, object]) -> None:
        self.validate(answer)

    def unbound_slots(self, selection: QuoteSelection, proposed: dict[str, Any]) -> list[CitationSlot]:
        check = getattr(self.worker.dependencies, "citation_issues", None)
        if not check or not selection.quote_sources:
            return []
        originals = {segment_source_key(s): s for s in self.sources}
        refs: list[CitationRef] = []
        for i, change in enumerate(proposed["changes"]):
            note = change["replacement"]
            if note is None:
                continue
            if not any(q["source"] == 1 for q in note["quotes"]):
                return []
            for j, quote in enumerate(note["quotes"]):
                source = originals.get(selection.quote_sources[int(quote["source"])])
                if source is None:
                    return []
                refs.append((i, j, {"segment_id": source["id"], "quote": quote["text"]}, source))
        if not any(str(c["quote"]) not in str(s["text"]) or not str(c["quote"]).strip() for _, _, c, s in refs):
            return []
        return _verified_slots(self.worker, refs, self.sources, check, bound=True)


def citation_slots(worker: ContextualReader, answer: dict[str, object], primary: dict[str, object],
                   sources: list[dict[str, object]], check: CitationCheck) -> list[CitationSlot]:
    refs: list[CitationRef] = []
    bound = True
    for i, change in enumerate(records(answer["changes"])):
        if change["replacement"] is None:
            continue
        replacement = record(change["replacement"])
        bound = bound and "quote_source_keys" in replacement
        ids = replacement.get("quote_segment_ids")
        note, owners = bind_note_sources(replacement, primary, sources, worker.dimensions,
                                         verified_segment_ids=ids if isinstance(ids, list) else None)
        for j, (citation, owner) in enumerate(zip(records(note["citations"]), owners, strict=True)):
            refs.append((i, j, citation, owner))
    return _verified_slots(worker, refs, [primary, *sources], check, bound=bound)


def _verified_slots(worker: ContextualReader, refs: list[CitationRef], sources: list[dict[str, object]],
                    check: CitationCheck, *, bound: bool) -> list[CitationSlot]:
    finder = getattr(worker.dependencies, "pdf_quote_excerpts", None)
    if finder is None:
        return []
    primary = sources[0]
    errors = check([{"citations": [citation]} for _, _, citation, _ in refs], worker.origins)
    rejected = [ref for ref, error in zip(refs, errors, strict=True) if error or
                not str(ref[2]["quote"]).strip() or str(ref[2]["quote"]) not in str(ref[3]["text"])]
    by_owner: dict[str, tuple[str, ...]] = {}
    result = []
    for i, j, _, owner in rejected:
        key = segment_source_key(owner)
        if key not in by_owner:
            retained = [(str(c["segment_id"]), str(c["quote"])) for _, _, c, s in refs
                        if segment_source_key(s) == key and str(c["quote"]).strip() and str(c["quote"]) in str(s["text"])]
            ranges = finder([owner], worker.origins, retained)
            _, candidates, _ = quote_choices([source_view(owner)], pdf_excerpts=ranges, bindings=quote_bindings([owner]))
            choices = list(dict.fromkeys(candidates.values()))
            # The finder records a retained range only after a positive match.
            # An absent PDF and an unchecked whole span must not supply a fix.
            verified = finder([owner], worker.origins, [(str(owner["id"]), q) for q in choices])
            text = str(owner["text"])
            located = {text[start:end] for start, end in verified.get(key, {}).get("retained", [])}
            by_owner[key] = tuple(q for q in choices if q in located)
        choices_for_slot = by_owner[key]
        if not bound and key != segment_source_key(primary):
            # Plain-text audit transports cannot identify a support passage by
            # number. A shorter quote must still bind to this exact original.
            choices_for_slot = tuple(q for q in choices_for_slot if q not in str(primary["text"]) and
                                     {segment_source_key(s) for s in sources if q in str(s["text"])} == {key})
        if not choices_for_slot:
            return []
        result.append(CitationSlot(i, j, choices_for_slot))
    return result
