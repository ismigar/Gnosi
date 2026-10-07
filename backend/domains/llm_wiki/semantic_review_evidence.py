"""Bounded local evidence lookup; requests never invent or shorten originals."""
from __future__ import annotations

from collections.abc import Callable
from typing import Any, cast

from backend.domains.llm_wiki.chunking import encoded, record, records
from backend.domains.llm_wiki.semantic_context import relevant, source_view
from backend.domains.llm_wiki.semantic_quote_contracts import source_key

MAX_EVIDENCE_ROUNDS = 2

REVIEW_CONTEXT_INSTRUCTION = (
    "This is one batch of a book-wide review. Assess only the supplied notes; other batches cover the other notes. "
    "The global_map and all_notes_map are fallible navigation, not claims to independently certify in this batch. "
    "An absent chapter in this request is not missing book coverage. Prior observations may concern other batches: "
    "resolve or retain only those affecting a supplied note. First apply the active skill's inclusion/exclusion "
    "policy to each note's primary passage; previously generated notes are drafts, not a reason to keep excluded material. "
    "When a particular note needs an unavailable original to settle attribution, a distant reference, or a continuation, "
    "return evidence_requests tied to that note and explain what the original must resolve. "
    "Use exact document labels (empty for all documents), concrete page numbers and/or source-language search terms. "
    "Gnosi retrieves complete local originals, then asks you to finish this same batch. "
    "There are at most two retrieval rounds. Request only evidence needed for supplied notes, not every chapter mentioned in a map. "
    "When evidence_requests is nonempty, changes are provisional and nothing is published. "
    "After retrieval, return the complete final set of changes relative to the ORIGINAL supplied notes, including any earlier "
    "provisional changes that remain valid. Empty evidence_requests ends retrieval; unresolved_issues must still identify "
    "any genuine defect preventing reliable notes. Do not claim an unfulfilled request has been resolved. "
)


def originals(chunks: list[dict[str, object]]) -> list[dict[str, object]]:
    return [{**s, "origin_label": c.get("origin_label", "")} for c in chunks for s in records(c.get("segments"))]


def catalog(sources: list[dict[str, object]], count: Callable[[str], int], limit: int) -> dict[str, object]:
    sections: dict[tuple[str, str], dict[str, object]] = {}
    for source in sources:
        location = record(source.get("locator"))
        document, section = str(source.get("origin_label", "")), str(location.get("section", ""))
        row = sections.setdefault((document, section), {"document": document, "section": section, "pages": []})
        page = location.get("page")
        if isinstance(page, int):
            pages = cast(list[int], row["pages"])
            row["pages"] = [min([page, *pages]), max([page, *pages])]
    included: list[dict[str, object]] = []
    for row in sections.values():
        if count(encoded([*included, row])) <= limit:
            included.append(row)
    return {"sections": included, "omitted_sections": len(sections) - len(included),
            "instruction": "Native section labels and inclusive page ranges for navigation only. Search queries can find originals even when a section is omitted here."}


def retrieve(sources: list[dict[str, object]], requests: list[dict[str, object]],
             existing: list[dict[str, object]], count: Callable[[str], int], limit: int) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    """Explicit pages are all-or-error; lexical searches return bounded complete passages."""
    selected: dict[str, dict[str, object]] = {}
    present = {str(s["id"]) for s in existing}
    reports = []
    for request in requests:
        document, pages, query = str(request["document"]), cast(list[int], request["pages"]), str(request["query"]).strip()
        scope = [s for s in sources if not document or s.get("origin_label", "") == document]
        matches = [s for s in scope if record(s.get("locator")).get("page") in pages] if pages else []
        for source in matches:
            selected[str(source["id"])] = source
        if count(encoded(list(selected.values()))) > limit:
            raise RuntimeError("reading_quality_unresolved: requested complete pages exceed the evidence budget")
        if query:
            candidates = [dict(s, search_text=encoded(source_view(s))) for s in scope
                          if str(s["id"]) not in present | selected.keys()]
            found = relevant(candidates, query, count, max(0, limit - count(encoded(list(selected.values())))), text_key="search_text")[:6]
            selected.update((str(s["id"]), {k: v for k, v in s.items() if k != "search_text"}) for s in found)
            matches.extend(found)
        available_pages = {record(s.get("locator")).get("page") for s in scope}
        reports.append({"request": request, "matched_passages": len(matches),
                        "missing_pages": [p for p in pages if p not in available_pages],
                        "search_scope": "New complete passages ranked by lexical relevance; search results are not exhaustive."})
    return list(selected.values()), reports


def references(sources: list[dict[str, object]]) -> list[dict[str, object]]:
    return [{"id": s["id"], "key": source_key(source_view(s))} for s in sources]


def restore(sources: list[dict[str, object]], saved: Any) -> list[dict[str, object]]:
    index = {str(s["id"]): s for s in sources}
    result = []
    for ref in records(saved):
        source = index.get(str(ref["id"]))
        if source is None or source_key(source_view(source)) != ref["key"]:
            raise RuntimeError("reading_quality_unresolved: saved review evidence changed")
        result.append(source)
    return result
