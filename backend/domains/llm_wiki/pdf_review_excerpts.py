"""Propose source-bound, literal excerpts for a specialist reviewing a PDF."""
from __future__ import annotations

import re
from collections.abc import Callable
from itertools import islice

from backend.domains.llm_wiki.semantic_context import source_view
from backend.domains.llm_wiki.semantic_quote_contracts import source_key
from backend.domains.llm_wiki.semantic_repairs import original_spans


# A word broken by a discretionary or line-end hyphen can render differently
# in the two PDF decoders. Leave that word in the original shown to the reviewer.
_BROKEN_WORD = re.compile(r"\S*[\u00ad-]\s+\S+|\S*\u00ad\S*")
_CLAUSE = re.compile(r"(?<=[,;:!?，；：。！？])\s*|\s+[–—]\s+")


def _excerpts(sentence: str) -> list[str]:
    runs = [part.strip() for part in _BROKEN_WORD.split(sentence) if part.strip()]
    clauses = [part.strip() for run in runs for part in _CLAUSE.split(run)]
    # Also cover passages without punctuation or a visible hyphen. Slice the
    # original characters, including internal whitespace, at word boundaries.
    windows = []
    for run in runs:
        words = list(re.finditer(r"\S+", run))
        width = min(8, max(2, (len(words) + 1) // 2))
        if len(words) > width:
            last = len(words) - width
            stride = max(1, width // 2, last // 12)
            starts = [*range(0, last, stride), last]
            windows.extend(run[words[i].start():words[i + width - 1].end()] for i in starts)
    unique = dict.fromkeys([*runs, *clauses, *windows])
    return list(islice((s for s in unique if s != sentence.strip() and len(s) >= 12), 32))


def verified_excerpts(
    evidence: list[dict[str, object]],
    locate: Callable[[list[tuple[str, str]]], list[bool | None]],
) -> dict[str, dict[str, list[tuple[int, int]]]]:
    """None denotes a non-PDF or unknown source. Only positive geometry is offered."""
    spans = [(source_key(source_view(segment)), str(segment["id"]), str(i), span)
             for segment in evidence for i, span in enumerate(original_spans(str(segment["text"])))]
    full = locate([(segment, span) for _, segment, _, span in spans])
    proposals = [(key, segment, number, span, excerpt)
                 for (key, segment, number, span), located in zip(spans, full, strict=True)
                 if located is False for excerpt in _excerpts(span)]
    if not proposals:
        return {}
    checked = locate([(segment, excerpt) for _, segment, _, _, excerpt in proposals])
    results: dict[str, dict[str, list[tuple[int, int]]]] = {}
    for (key, _, number, span, excerpt), located in zip(proposals, checked, strict=True):
        if located is True:
            ranges = results.setdefault(key, {}).setdefault(number, [])
            if len(ranges) < 8:
                start = span.index(excerpt)
                ranges.append((start, start + len(excerpt)))
    return results
