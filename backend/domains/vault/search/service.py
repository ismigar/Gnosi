"""Search complete Markdown documents without reading personal data globally."""

from __future__ import annotations

import re
import time
from collections.abc import Iterable, Mapping
from dataclasses import dataclass

from markdown_it import MarkdownIt
from pydantic import BaseModel, ConfigDict, Field

from backend.domains.vault.search.query import (
    Expression,
    Scope,
    SearchQueryError,
    Term,
    normalize_text,
    parse_query,
)


class VaultSearchHit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    title: str
    path: str
    excerpt: str
    line: int | None = None
    tags: list[str] = Field(default_factory=list)


class VaultSearchResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    results: list[VaultSearchHit]
    total: int
    offset: int
    limit: int


@dataclass(frozen=True)
class SearchDocument:
    id: str
    title: str
    path: str
    body: str
    metadata: Mapping[str, object]


@dataclass(frozen=True)
class Unit:
    text: str
    offset: int | None = None
    weight: int = 1


@dataclass(frozen=True)
class Match:
    score: int
    offset: int | None = None


def text_value(value: object) -> str:
    if isinstance(value, (list, tuple)):
        return " ".join(text_value(item) for item in value)
    if isinstance(value, dict):
        return " ".join(text_value(item) for item in value.values())
    return "" if value is None else str(value)


def document_tags(document: SearchDocument) -> list[str]:
    raw = document.metadata.get("tags", [])
    values = raw if isinstance(raw, list) else re.split(r"[,\s]+", str(raw))
    return list(dict.fromkeys(str(value).lstrip("#") for value in values if value))


def body_units(body: str, field: str) -> Iterable[Unit]:
    if field == "content":
        yield Unit(body, 0)
        return
    offsets = [0]
    for line in body.splitlines(keepends=True):
        if field == "line":
            yield Unit(line, offsets[-1])
        offsets.append(offsets[-1] + len(line))
    if field == "line":
        return
    # The same CommonMark parse handles Setext headings, variable fences,
    # indented code, nested lists and literal task examples consistently.
    tokens = MarkdownIt("commonmark").parse(body)
    if field == "section":
        starts = sorted(
            {
                0,
                *(
                    offsets[token.map[0]]
                    for token in tokens
                    if token.type == "heading_open" and token.map
                ),
            }
        )
        for start, end in zip(starts, [*starts[1:], len(body)]):
            if end > start:
                yield Unit(body[start:end], start)
        return
    for index, token in enumerate(tokens):
        if not token.map:
            continue
        start, end = token.map
        if field == "block" and token.type in {
            "paragraph_open",
            "heading_open",
            "fence",
            "code_block",
            "html_block",
        }:
            yield Unit(body[offsets[start] : offsets[end]], offsets[start])
        if token.type != "list_item_open" or index + 2 >= len(tokens):
            continue
        paragraph, inline = tokens[index + 1 : index + 3]
        task = (
            re.match(r"^\[([ xX])\]\s", inline.content)
            if paragraph.type == "paragraph_open" and inline.type == "inline"
            else None
        )
        if task and (field == "task" or field == ("task-todo" if task[1] == " " else "task-done")):
            task_end = paragraph.map[1] if paragraph.map else end
            yield Unit(body[offsets[start] : offsets[task_end]], offsets[start])


def field_units(document: SearchDocument, field: str) -> Iterable[Unit]:
    if field == "title":
        yield Unit(document.title, weight=10)
        yield Unit(
            text_value(document.metadata.get("aliases", document.metadata.get("alias", ""))),
            weight=5,
        )
    elif field in {"path", "file"}:
        yield Unit(document.path if field == "path" else document.path.rsplit("/", 1)[-1], weight=2)
    elif field == "tag":
        for tag in document_tags(document):
            yield Unit(normalize_text(tag), weight=3)
    elif field == "is":
        yield Unit("table database" if document.metadata.get("is_database") else "page note")
    elif field.startswith("property:"):
        key = field.removeprefix("property:").casefold()
        for name, value in document.metadata.items():
            if name.casefold() == key:
                yield Unit(text_value(value))
    else:
        yield from body_units(document.body, field)


def _evaluate_term(
    expression: Term, document: SearchDocument, deadline: float, unit: Unit | None
) -> Match | None:
    units = (
        [unit]
        if unit is not None
        else [
            Unit(document.title, weight=10),
            Unit(
                text_value(document.metadata.get("aliases", document.metadata.get("alias", ""))),
                weight=5,
            ),
            Unit(" ".join(document_tags(document)), weight=3),
            Unit(document.body, 0),
        ]
    )
    best: Match | None = None
    for candidate in units:
        try:
            haystack = (
                normalize_text(candidate.text) if expression.literal is not None else candidate.text
            )
            found = expression.pattern.search(
                haystack, timeout=min(0.025, max(0.001, deadline - time.monotonic()))
            )
        except TimeoutError as error:
            raise SearchQueryError("Regular expression exceeded its time budget") from error
        if found:
            position = found.start()
            if (
                expression.literal is not None
                and candidate.offset is not None
                and not candidate.text.isascii()
            ):
                normalized_length = 0
                for original_position, character in enumerate(candidate.text):
                    if normalized_length >= position:
                        position = original_position
                        break
                    normalized_length += len(normalize_text(character))
            offset = None if candidate.offset is None else candidate.offset + position
            if best is None:
                best = Match(candidate.weight, offset)
            elif offset is not None and best.offset is None:
                best = Match(best.score, offset)
    return best


def evaluate(
    expression: Expression, document: SearchDocument, deadline: float, unit: Unit | None = None
) -> Match | None:
    if time.monotonic() >= deadline:
        raise SearchQueryError("Search exceeded its time budget; narrow the query")
    if isinstance(expression, Term):
        return _evaluate_term(expression, document, deadline, unit)
    if isinstance(expression, Scope):
        for candidate in field_units(document, expression.field):
            result = evaluate(expression.child, document, deadline, candidate)
            if result is not None:
                return result
        return None
    if expression.operator == "NOT":
        return (
            Match(0) if evaluate(expression.children[0], document, deadline, unit) is None else None
        )
    matches: list[Match] = []
    for child in expression.children:
        result = evaluate(child, document, deadline, unit)
        if expression.operator == "AND" and result is None:
            return None
        if result is not None:
            matches.append(result)
    if not matches:
        return None
    offsets = [match.offset for match in matches if match.offset is not None]
    return Match(sum(match.score for match in matches), min(offsets) if offsets else None)


def search_documents(
    documents: Iterable[SearchDocument],
    query: str,
    *,
    limit: int = 50,
    offset: int = 0,
    budget_seconds: float = 2.0,
) -> VaultSearchResponse:
    expression = parse_query(query)
    if expression is None:
        return VaultSearchResponse(results=[], total=0, offset=offset, limit=limit)
    deadline = time.monotonic() + budget_seconds
    hits: list[tuple[int, VaultSearchHit]] = []
    for document in documents:
        matched = evaluate(expression, document, deadline)
        if matched is None:
            continue
        position = matched.offset or 0
        start = max(0, position - 90)
        end = min(len(document.body), position + 190)
        excerpt = (
            ("…" if start else "")
            + document.body[start:end].strip()
            + ("…" if end < len(document.body) else "")
        )
        hits.append(
            (
                matched.score,
                VaultSearchHit(
                    id=document.id,
                    title=document.title,
                    path=document.path,
                    excerpt=excerpt,
                    line=document.body.count("\n", 0, position) + 1
                    if matched.offset is not None
                    else None,
                    tags=document_tags(document),
                ),
            )
        )
    hits.sort(key=lambda hit: (-hit[0], hit[1].title.casefold(), hit[1].id))
    return VaultSearchResponse(
        results=[hit for _, hit in hits[offset : offset + limit]],
        total=len(hits),
        offset=offset,
        limit=limit,
    )
