"""Conservative Markdown selections and links; never rewrite literal examples."""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import unquote

from fastapi import HTTPException

from .link_context import LinkTarget, link_targets, literal_wiki_prefix
from .schemas import ComposerRequest


def visible_markdown(text: str) -> str:
    """Mask fenced/indented/inline code, comments and escaped syntax at fixed offsets."""
    lines = text.splitlines(keepends=True)
    result: list[str] = []
    fence = ""
    for line in lines:
        marker = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", line.rstrip("\r\n"))
        literal = bool(fence) or line.startswith(("    ", "\t"))
        if marker:
            run, rest = marker.groups()
            if not fence and (run[0] != "`" or "`" not in rest):
                fence = run
                literal = True
            elif fence and run[0] == fence[0] and len(run) >= len(fence) and not rest.strip():
                fence = ""
        result.append(re.sub(r"[^\r\n]", " ", line) if literal else line)
    masked = "".join(result)
    for pattern in (r"<!--[\s\S]*?(?:-->|$)", r"(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)", r"\\[\\`!\[\]()]"):
        masked = re.sub(pattern, lambda m: re.sub(r"[^\r\n]", " ", m[0]), masked)
    return masked


def anchor(value: str) -> str:
    value = unquote(value).strip().lstrip("#")
    if value.startswith("^"):
        return value.casefold()
    value = re.sub(r"[\[\]*_`~]", "", value)
    return re.sub(r"\s+", " ", value).casefold()


def heading_anchors(name: str) -> set[str]:
    normalized = anchor(name)
    return {normalized, re.sub(r"[^\w\s-]", "", normalized).replace(" ", "-")}


@dataclass(frozen=True)
class Heading:
    name: str
    level: int
    start: int
    content_start: int


def headings(text: str) -> list[Heading]:
    masked = visible_markdown(text)
    lines = masked.splitlines(keepends=True)
    source_lines = text.splitlines(keepends=True)
    result: list[Heading] = []
    offset = 0
    for index, line in enumerate(lines):
        atx = re.match(r"^ {0,3}(#{1,6})(?:[ \t]+|$)(.*)", line.rstrip("\r\n"))
        if atx:
            original = re.match(
                r"^ {0,3}#{1,6}(?:[ \t]+|$)(.*)", source_lines[index].rstrip("\r\n")
            )
            name = re.sub(r"[ \t]+#+[ \t]*$", "", original[1] if original else atx[2]).strip()
            result.append(Heading(name, len(atx[1]), offset, offset + len(line)))
        elif (
            index + 1 < len(lines)
            and line.strip()
            and re.fullmatch(r" {0,3}(=+|-+)[ \t]*\r?\n?", lines[index + 1])
        ):
            result.append(
                Heading(
                    source_lines[index].strip(),
                    1 if lines[index + 1].lstrip()[0] == "=" else 2,
                    offset,
                    offset + len(line) + len(lines[index + 1]),
                )
            )
        offset += len(line)
    return result


def anchors(text: str) -> set[str]:
    result = {name for h in headings(text) for name in heading_anchors(h.name)}
    result.update(
        "^" + match[1].casefold()
        for match in re.finditer(r"(?:^|\s)\^([\w-]+)[ \t]*(?:\n|$)", visible_markdown(text))
    )
    return result


def select(text: str, request: ComposerRequest) -> tuple[int, int]:
    if request.selection == "note":
        bounds = (0, len(text))
    elif request.selection == "heading":
        items = headings(text)
        matches = [
            i for i, h in enumerate(items) if anchor(request.heading) in heading_anchors(h.name)
        ]
        if len(matches) != 1:
            raise HTTPException(409, "Choose a heading that occurs exactly once")
        index = matches[0]
        heading = items[index]
        end = next((h.start for h in items[index + 1 :] if h.level <= heading.level), len(text))
        bounds = (heading.start, end)
    else:
        lines = text.splitlines(keepends=True)
        start, end = request.start_line or 1, request.end_line or 1
        if end > len(lines):
            raise HTTPException(409, "The selected lines no longer exist")
        bounds = (sum(map(len, lines[: start - 1])), sum(map(len, lines[:end])))
        # Whole Markdown blocks avoid breaking fences, lists or paragraphs in either note.
        if (bounds[0] and lines[start - 2].strip()) or (end < len(lines) and lines[end].strip()):
            raise HTTPException(409, "Select complete Markdown blocks, separated by blank lines")
        prefix = text[: bounds[0]]
        selected = text[bounds[0] : bounds[1]]
        if (
            visible_markdown(prefix + "\nCOMPOSER_BOUNDARY\n").find("COMPOSER_BOUNDARY") < 0
            or visible_markdown(selected + "\nCOMPOSER_BOUNDARY\n").find("COMPOSER_BOUNDARY") < 0
        ):
            raise HTTPException(409, "The selection must include complete code fences")
    if not text[bounds[0] : bounds[1]].strip():
        raise HTTPException(409, "The selection is empty")
    return bounds


# Ordinary Markdown destinations are supplied by the parser; wiki text remains raw.
LINKS = re.compile(r"!?\[\[(?P<wiki>[^\]\n|]+)(?:\|[^\]\n]*)?\]\]")


def _destination_text(raw: str, replacement: str, *, markdown: bool) -> str:
    if not markdown:
        return replacement
    # Preserve the effective URI when emitting it back into Markdown syntax.
    value = replacement.replace("&", "&amp;").replace("\\", "&#92;")
    if raw.startswith("<") and raw.endswith(">"):
        return f"<{value.replace('<', '&lt;').replace('>', '&gt;')}>"
    return value.replace("(", "\\(").replace(")", "\\)")


def rewrite_links(text: str, resolve: Callable[[str], str | None]) -> tuple[str, int]:
    edits: list[tuple[int, int, str]] = []
    masked, targets = link_targets(text)
    for match in LINKS.finditer(masked):
        start, end = match.span("wiki")
        if not literal_wiki_prefix(match.start(), start, text, masked):
            targets.append(LinkTarget(start, end, text[start:end], markdown=False))
    for target in targets:
        replacement = resolve(target.value)
        if replacement is None:
            continue
        raw = text[target.start : target.end]
        changed = _destination_text(raw, replacement, markdown=target.markdown)
        if changed != raw:
            edits.append((target.start, target.end, changed))
    for start, end, replacement in sorted(edits, reverse=True):
        text = text[:start] + replacement + text[end:]
    return text, len(edits)
