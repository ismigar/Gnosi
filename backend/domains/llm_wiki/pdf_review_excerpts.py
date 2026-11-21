"""Propose source-bound, literal excerpts for a specialist reviewing a PDF."""
from __future__ import annotations

import re
from collections.abc import Callable
from itertools import islice

from backend.domains.llm_wiki.semantic_context import source_view
from backend.domains.llm_wiki.semantic_quote_contracts import segment_source_key, source_key
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
    return list(islice((s for s in unique if s != sentence.strip() and s and
                        (len(s.split()) >= 2 or len(s) >= 12)), 32))


def _word_pairs(span: str, covered: list[str]) -> list[str]:
    """Check the gaps left by longer candidates, including both sides of an OCR fault."""
    words = list(re.finditer(r"\S+", span))
    pairs = dict.fromkeys(span[left.start():right.end()] for left, right in zip(words, words[1:]))
    return [pair for pair in pairs if pair != span.strip() and not any(pair in text for text in covered)]


def quote_bindings(evidence: list[dict[str, object]]) -> list[tuple[str, str]]:
    return [(source_key(source_view(s)), segment_source_key(s)) for s in evidence]


def verified_excerpts(
    evidence: list[dict[str, object]],
    locate: Callable[[list[tuple[str, str]]], list[bool | None]],
) -> dict[str, dict[str, list[tuple[int, int]]]]:
    """None denotes a non-PDF or unknown source. Only positive geometry is offered."""
    segments = {segment_source_key(segment): segment for segment in evidence}
    spans = [(key, str(segment["id"]), str(i), span) for key, segment in segments.items()
             for i, span in enumerate(original_spans(str(segment["text"])))]
    full = locate([(segment, span) for _, segment, _, span in spans])
    failed = [row for row, located in zip(spans, full, strict=True) if located is False]
    confirmed: dict[tuple[str, str], list[str]] = {}
    for shorter in (False, True):
        proposals = [(key, segment, number, excerpt) for key, segment, number, span in failed
                     for excerpt in (_word_pairs(span, confirmed.get((key, number), [])) if shorter else _excerpts(span))]
        if proposals:
            checked = locate([(segment, excerpt) for _, segment, _, excerpt in proposals])
            for (key, _, number, excerpt), located in zip(proposals, checked, strict=True):
                if located is True:
                    confirmed.setdefault((key, number), []).append(excerpt)
    results: dict[str, dict[str, list[tuple[int, int]]]] = {}
    for key, _, number, span in failed:
        for excerpt in confirmed.get((key, number), [])[:8]:
            start = span.index(excerpt)
            results.setdefault(key, {}).setdefault(number, []).append((start, start + len(excerpt)))
    return results
