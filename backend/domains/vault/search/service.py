"""Search complete Markdown documents without reading personal data globally."""

from __future__ import annotations

import json
import re
from html import unescape
import time
from collections.abc import Iterable, Mapping
from dataclasses import dataclass

from markdown_it import MarkdownIt
from markdown_it.token import Token
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


def _preview_source(body: str) -> str:
    # Keep line breaks intact: token maps and navigation refer to source lines.
    text = re.sub(r"(?m)^[ \t]*:::(?:column(?:-list)?(?:\{[^\n]*\})?)?[ \t]*$", "", body)
    text = re.sub(r"(?m)^[ \t]*:::callout(?:\{[^\n]*\})?[ \t]*$", "", text)
    text = re.sub(r"(?m)^[ \t]*:::toggle(?:-heading\{[^\n]*\})?[ \t]+", "", text)
    text = re.sub(r"(?m)^[ \t]*\{\{[^\n]*\}\}[ \t]*$", "", text)
    return re.sub(r"!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]", lambda m: m[2] or m[1], text)


def _serialized_preview(text: str) -> bool:
    try:
        return isinstance(json.loads(text), (dict, list))
    except (ValueError, RecursionError):
        return bool(re.match(r'^\s*\{\s*"[^"\n]+"\s*:', text))


def _preview_inline(token: Token) -> str:
    text = "".join(
        child.content
        if child.type in {"text", "code_inline"} and not _serialized_preview(child.content)
        else " "
        if child.type in {"softbreak", "hardbreak", "html_inline"}
        else ""
        for child in token.children or []
    )
    text = re.sub(r"^\[[ xX]\][ \t]+", "", text)
    return re.sub(r"\s+", " ", unescape(text)).strip()


def search_excerpt(body: str, position: int) -> str:
    """Build readable context before clipping, never a slice of serialized Markdown."""
    parser = MarkdownIt("commonmark", {"html": True}).enable(["table", "strikethrough"])
    tokens = parser.parse(_preview_source(body))
    offsets = [0]
    for line in body.splitlines(keepends=True):
        offsets.append(offsets[-1] + len(line))
    parts: list[str] = []
    anchor = 0
    length = 0
    for token in tokens:
        if token.type != "inline" or not token.map:
            continue
        # Fenced/indented code and configuration blocks are not prose. Avoid
        # treating ordinary unchecked task items as serialized JSON arrays.
        if _serialized_preview(token.content):
            continue
        text = _preview_inline(token)
        if not text:
            continue
        start, end = token.map
        if offsets[start] <= position:
            anchor = length
            if position < offsets[end]:
                prefix = _preview_source(body[offsets[start] : position])
                visible_prefix = " ".join(
                    _preview_inline(part) for part in parser.parse(prefix) if part.type == "inline"
                )
                anchor += min(len(text), len(visible_prefix))
        parts.append(text)
        length += len(text) + 1
    plain = " ".join(parts)
    start = max(0, anchor - 90)
    end = min(len(plain), anchor + 190)
    return ("…" if start else "") + plain[start:end].strip() + ("…" if end < len(plain) else "")


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
    remaining_budget = budget_seconds
    hits: list[tuple[int, SearchDocument, Match]] = []
    for document in documents:
        # Loading the next document may hydrate cloud files or refresh the Vault
        # inventory. Charge only query evaluation to the shared safety budget.
        started = time.monotonic()
        matched = evaluate(expression, document, started + remaining_budget)
        remaining_budget -= time.monotonic() - started
        if remaining_budget <= 0:
            raise SearchQueryError("Search exceeded its time budget; narrow the query")
        if matched is None:
            continue
        hits.append((matched.score, document, matched))
    hits.sort(key=lambda hit: (-hit[0], hit[1].title.casefold(), hit[1].id))
    results = []
    for _, document, matched in hits[offset : offset + limit]:
        position = matched.offset or 0
        results.append(VaultSearchHit(
            id=document.id,
            title=document.title,
            path=document.path,
            excerpt=search_excerpt(document.body, position),
            line=document.body.count("\n", 0, position) + 1
            if matched.offset is not None else None,
            tags=document_tags(document),
        ))
    return VaultSearchResponse(
        results=results,
        total=len(hits),
        offset=offset,
        limit=limit,
    )
