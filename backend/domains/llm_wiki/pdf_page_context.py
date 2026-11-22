"""Keep the two original passages at a physical PDF page break separately attributable."""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from backend.domains.llm_wiki.chunking import record, records
from backend.domains.llm_wiki.semantic_context import source_view
from backend.domains.llm_wiki.semantic_quote_contracts import segment_source_key, source_key

PageEdge = tuple[dict[str, object], dict[str, object]]


def _page(source: dict[str, object]) -> int:
    page = record(source.get("locator")).get("page")
    return page if type(page) is int and page > 0 else 0


def page_edges(chunks: list[dict[str, object]]) -> dict[str, list[PageEdge]]:
    edges: dict[str, list[PageEdge]] = defaultdict(list)
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
                edge = (last, current)
                edges[str(last["id"])].append(edge)
                edges[str(current["id"])].append(edge)
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


def identifies_legacy_primaries(chunks: list[dict[str, object]], request: dict[str, object]) -> bool:
    """Test provenance only when a paid, unscoped checkpoint actually exists."""
    primaries = records(request.get("primary_passages")) or [
        record(n["primary"]) for n in records(request.get("notes")) if n.get("primary")]
    if not primaries and request.get("original"):
        primaries = [record(request["original"])]
    owners: dict[str, set[str]] = {source_key(p): set() for p in primaries}
    labels = {p.get("document") for p in primaries}
    for chunk in chunks:
        label = chunk.get("origin_label", "")
        if label in labels:
            for raw in records(chunk.get("segments")):
                key = source_key(source_view({**raw, "origin_label": label}))
                if key in owners:
                    owners[key].add(str(chunk["origin_id"]))
    return bool(owners) and all(len(origins) == 1 for origins in owners.values())


def _overlap(anchor: dict[str, object], original: dict[str, object]) -> bool:
    """A compact preview must overlap the real page edge at its exact character offsets."""
    if anchor["id"] != original["id"] or anchor.get("origin_label") != original.get("origin_label"):
        return False
    left, right = (dict(record(s.get("locator"))) for s in (anchor, original))
    a, b = (str(s["text"]) for s in (anchor, original))
    start_a, start_b = left.pop("char_start", 0), right.pop("char_start", 0)
    if type(start_a) is not int or type(start_b) is not int or min(start_a, start_b) < 0:
        return False
    end_a, end_b = start_a + len(a), start_b + len(b)
    if left.pop("char_end", end_a) != end_a or right.pop("char_end", end_b) != end_b or left != right:
        return False
    start, stop = max(start_a, start_b), min(end_a, end_b)
    return start < stop and a[start - start_a:stop - start_a] == b[start - start_b:stop - start_b]


@dataclass(frozen=True)
class PageContext:
    additions: list[dict[str, object]]
    pairs: list[tuple[int, int]]
    bindings: tuple[tuple[str, str], ...] = ()
    audit_sources: tuple[tuple[str, str], ...] = ()

    def prompt(self, payload: dict[str, object], *, audit: bool = False) -> dict[str, object]:
        if not self.pairs:
            return payload
        field = "support" if audit else "retrieved_originals"
        return {**payload, field: [*records(payload.get(field)), *(source_view(s) for s in self.additions)],
                **({"pdf_quote_sources": self.audit_sources} if audit else {}),
                "pdf_page_pairs": self.pairs,
                "instruction": str(payload.get("instruction", "")) + (
                    " Each pdf_page_pairs entry lists the last supplied passage of one physical page and the"
                    " first of the next in the same PDF, in reading order. Read both before deciding whether"
                    " wording, attribution or a qualification continues. A page edge alone does not prove the"
                    " sentences belong together. Cite each supporting original separately, preserving its exact"
                    " wording and locator. Explain the substantive claims retained in the assessment or reason."
                    " Report any missing evidence that prevents a supported interpretation.")
                + (" The numbers refer to the original (1) followed by the support entries." if audit else "")}


def page_context(edges: dict[str, list[PageEdge]], evidence: list[dict[str, object]],
                 anchors: list[dict[str, object]]) -> PageContext:
    """Include only edges of the cited/primary originals, once, without walking the book."""
    if not edges:
        return PageContext([], [])
    positions = {segment_source_key(s): i for i, s in enumerate(evidence, 1)}
    extra: list[dict[str, object]] = []
    pairs: dict[tuple[int, int], None] = {}
    for anchor in anchors:
        if segment_source_key(anchor) not in positions:
            continue
        for before, after in edges.get(str(anchor["id"]), []):
            if not (_overlap(anchor, before) or _overlap(anchor, after)):
                continue
            left, right = segment_source_key(before), segment_source_key(after)
            for key, source in ((left, before), (right, after)):
                if key not in positions:
                    extra.append(source)
                    positions[key] = len(evidence) + len(extra)
            pairs[positions[left], positions[right]] = None
    originals = [*evidence, *extra]
    bindings = tuple((segment_source_key(originals[a - 1]), segment_source_key(originals[b - 1])) for a, b in pairs)
    audit_sources = tuple((source_key(source_view(s)), segment_source_key(s)) for s in originals) if pairs else ()
    return PageContext(extra, list(pairs), bindings, audit_sources)
