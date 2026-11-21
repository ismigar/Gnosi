"""Keep the two original passages at a physical PDF page break separately attributable."""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from backend.domains.llm_wiki.chunking import record, records
from backend.domains.llm_wiki.semantic_context import source_view
from backend.domains.llm_wiki.semantic_quote_contracts import segment_source_key, source_key


def _page(source: dict[str, object]) -> int:
    page = record(source.get("locator")).get("page")
    return page if type(page) is int and page > 0 else 0


def page_edges(chunks: list[dict[str, object]]) -> dict[str, list[dict[str, object]]]:
    edges: dict[str, list[dict[str, object]]] = defaultdict(list)
    previous: dict[str, dict[str, object]] = {}
    for chunk in chunks:
        origin = str(chunk.get("origin_id") or "")
        if not origin or str(chunk.get("kind", "")).lower() != "pdf":
            continue
        for raw in records(chunk.get("segments")):
            current = {**raw, "origin_label": chunk.get("origin_label", "")}
            last = previous.get(origin)
            previous[origin] = current
            if last is None:
                continue
            left = _page(last)
            if left and _page(current) == left + 1:
                edges[segment_source_key(last)].append(current)
                edges[segment_source_key(current)].append(last)
    return dict(edges)


def ambiguous_pdf_segments(chunks: list[dict[str, object]]) -> set[str]:
    """Only same-labelled PDFs can supply an identical visible passage from different files."""
    origins: dict[str, set[str]] = defaultdict(set)
    for c in chunks:
        if c.get("kind") == "pdf":
            origins[str(c.get("origin_label", ""))].add(str(c["origin_id"]))
    duplicates = {label for label, ids in origins.items() if len(ids) > 1}
    owners: dict[str, set[str]] = defaultdict(set)
    for c in chunks:
        label = str(c.get("origin_label", ""))
        if label in duplicates and c.get("kind") == "pdf":
            for raw in records(c.get("segments")):
                s = {**raw, "origin_label": label}
                owners[source_key(source_view(s))].add(segment_source_key(s))
    return {key for keys in owners.values() if len(keys) > 1 for key in keys}


@dataclass(frozen=True)
class PageContext:
    additions: list[dict[str, object]]
    pairs: list[tuple[int, int]]
    bindings: tuple[tuple[str, str], ...] = ()

    def prompt(self, payload: dict[str, object], *, audit: bool = False) -> dict[str, object]:
        if not self.pairs:
            return payload
        field = "support" if audit else "retrieved_originals"
        return {**payload, field: [*records(payload.get(field)), *(source_view(s) for s in self.additions)],
                "pdf_page_pairs": self.pairs,
                "instruction": str(payload.get("instruction", "")) + (
                    " Each pdf_page_pairs entry lists the last supplied passage of one physical page and the"
                    " first of the next in the same PDF, in reading order. Read both before deciding whether"
                    " wording, attribution or a qualification continues. A page edge alone does not prove the"
                    " sentences belong together. Cite each supporting original separately, preserving its exact"
                    " wording and locator. Explain the substantive claims retained in the assessment or reason."
                    " Report any missing evidence that prevents a supported interpretation.")
                + (" The numbers refer to the original (1) followed by the support entries." if audit else "")}


def page_context(edges: dict[str, list[dict[str, object]]], evidence: list[dict[str, object]],
                 anchors: list[dict[str, object]]) -> PageContext:
    """Include only edges of the cited/primary originals, once, without walking the book."""
    if not edges:
        return PageContext([], [])
    positions = {segment_source_key(s): i for i, s in enumerate(evidence, 1)}
    extra: list[dict[str, object]] = []
    pairs: dict[tuple[int, int], None] = {}
    for anchor in anchors:
        key = segment_source_key(anchor)
        if key not in positions:
            continue
        for other in edges.get(key, []):
            other_key = segment_source_key(other)
            if other_key not in positions:
                extra.append(other)
                positions[other_key] = len(evidence) + len(extra)
            pair = (positions[key], positions[other_key])
            if _page(anchor) > _page(other):
                pair = (pair[1], pair[0])
            pairs[pair] = None
    originals = [*evidence, *extra]
    bindings = tuple((segment_source_key(originals[a - 1]), segment_source_key(originals[b - 1])) for a, b in pairs)
    return PageContext(extra, list(pairs), bindings)
