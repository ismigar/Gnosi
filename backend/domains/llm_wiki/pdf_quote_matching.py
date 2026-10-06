"""Full-span PDF matching with explicit ambiguity; never accept a quote prefix."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


class TextPage(Protocol):
    def count_chars(self) -> int: ...
    def get_text_range(self, index: int = 0, count: int = -1) -> str: ...


def compact(text: str) -> str:
    """Ignore layout whitespace, retaining every letter, accent and punctuation."""
    return "".join(char.casefold() for char in text if not char.isspace() and char != "\u00ad")


def occurrences(text: str, query: str) -> list[tuple[int, int]]:
    if not query:
        return []
    result = []
    start = text.find(query)
    while start >= 0:
        result.append((start, start + len(query)))
        start = text.find(query, start + 1)
    return result


def unique_span(text: str, quote: str, context: str = "") -> tuple[int, int] | None:
    matches = occurrences(text, compact(quote))
    if len(matches) == 1:
        return matches[0]
    anchors = occurrences(text, compact(context))
    if len(anchors) == 1:
        left, right = anchors[0]
        matches = [(a, b) for a, b in matches if left <= a and b <= right]
    return matches[0] if len(matches) == 1 else None


@dataclass(frozen=True)
class PageTextIndex:
    text: str
    indices: tuple[int, ...]

    def find(self, quote: str, context: str = "") -> tuple[int, int] | None:
        span = unique_span(self.text, quote, context)
        if span is None:
            return None
        first, last = self.indices[span[0]], self.indices[span[1] - 1]
        return first, last - first + 1


def index_page(page: TextPage) -> PageTextIndex:
    # PDFium text-string offsets can differ from character-list offsets.
    # Read individual native characters so rectangle indices stay exact.
    text, indices = [], []
    for index in range(page.count_chars()):
        value = compact(page.get_text_range(index, 1))
        text.append(value)
        indices.extend([index] * len(value))
    return PageTextIndex("".join(text), tuple(indices))


def normalized_pdf_span(page: TextPage, quote: str, context: str = "") -> tuple[int, int] | None:
    return index_page(page).find(quote, context)
