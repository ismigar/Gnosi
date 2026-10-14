"""Move document-scoped references without changing links or literal examples."""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass

from fastapi import HTTPException
from markdown_it import MarkdownIt
from markdown_it.rules_block import reference
from markdown_it.rules_block.state_block import StateBlock
from markdown_it.rules_inline import image, link
from markdown_it.rules_inline.state_inline import StateInline
from markdown_it.token import Token


@dataclass(frozen=True)
class Reference:
    label: str
    href: str
    title: str
    first_line: int


def _definition(label: str, ref: Reference) -> str:
    # Entities keep destinations/titles on one line without interpreting their
    # quotes, backslashes, angle brackets or literal entity-looking text again.
    def escape(value: str) -> str:
        return (
            value.replace("&", "&amp;")
            .replace("\\", "&#92;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
            .replace("\n", "&#10;")
        )

    title = f' "{escape(ref.title)}"' if ref.title else ""
    return f"[{label}]: <{escape(ref.href)}>{title}"


def _inline_line_offsets(line: str, part: str, start: int) -> list[int] | None:
    content = line.rstrip("\r\n")
    found = content.rfind(part)
    if found >= 0:
        return list(range(start + found, start + found + len(part)))
    stripped = part.lstrip(" \t")
    found = content.rfind(stripped)
    if not stripped or stripped == part or found < 0 or "\t" not in content[:found]:
        return None
    # Container indentation can consume part of a tab and insert virtual spaces.
    # Those spaces map to the original tab; actual inline characters stay exact.
    padding = len(part) - len(stripped)
    tab = start + content[:found].rfind("\t")
    return [tab] * padding + list(range(start + found, start + found + len(stripped)))


def _inline_offsets(text: str, token: Token) -> list[int]:
    """Map parser-stripped container prefixes back to their source positions."""
    if token.map is None:
        raise HTTPException(409, "The selected Markdown reference could not be located safely")
    lines = re.split(r"(?<=\n)|(?<=\r)(?!\n)", text)
    line_offsets = [0]
    for line in lines:
        line_offsets.append(line_offsets[-1] + len(line))
    line_index, limit = token.map
    positions: list[int] = []
    for index, part in enumerate(token.content.split("\n")):
        located = None
        while line_index < limit:
            located = _inline_line_offsets(lines[line_index], part, line_offsets[line_index])
            if located is not None:
                break
            line_index += 1
        if located is None or line_index >= limit:
            raise HTTPException(409, "The selected Markdown reference could not be located safely")
        if index:
            positions.append(line_offsets[line_index] - 1)
        positions.extend(located)
        line_index += 1
    return positions


def _reference_definition_rule(
    names: dict[str, str], labels: set[str], edits: list[tuple[int, int, str]]
) -> Callable[[StateBlock, int, int, bool], bool]:
    def definition_rule(state: StateBlock, first: int, last: int, silent: bool) -> bool:
        start = state.bMarks[first] + state.tShift[first]
        matched = reference(state, first, last, silent)
        if matched and not silent:
            label = str(state.tokens[-1].meta["id"])
            if label not in names:
                raise HTTPException(409, "Select complete Markdown blocks before moving references")
            labels.add(label)
            # The block rule already validated this label, including escapes and
            # multiline labels. Container prefixes within it are discarded when
            # the entire label is replaced with a single-line private name.
            end = start + 1
            while end < len(state.src):
                if state.src[end] == "\\":
                    end += 2
                elif state.src[end] == "]":
                    break
                else:
                    end += 1
            edits.append((start + 1, end, names[label]))
        return matched

    return definition_rule


def _namespace_fragment(
    fragment: str, references: dict[str, Reference], names: dict[str, str], external: set[str]
) -> str:
    """Rewrite only reference syntax recognized by the CommonMark parser."""
    fragment = re.sub(r"\r\n?", "\n", fragment)
    parser = MarkdownIt("commonmark", {"store_labels": True, "inline_definitions": True})
    edits: list[tuple[int, int, str]] = []
    labels: set[str] = set()

    parser.block.ruler.at("reference", _reference_definition_rule(names, labels, edits))
    # Supply the original document's effective definitions before parsing the
    # fragment: a duplicate inside it must not override an earlier outside one.
    env = {
        "references": {
            label: {"href": ref.href, "title": ref.title} for label, ref in references.items()
        }
    }
    tokens = parser.parse(fragment, env)
    uses: list[tuple[int, int, str]] = []
    inline_base = 0

    def reference_rule(state: StateInline, silent: bool, *, is_image: bool) -> bool:
        nonlocal inline_base
        rule = image if is_image else link
        if silent:
            return rule(state, silent)
        start, base, token_count = state.pos, inline_base, len(state.tokens)
        if state.src[start : start + (2 if is_image else 1)] != ("![" if is_image else "["):
            return False
        end_label = state.md.helpers.parseLinkLabel(
            state, start + (1 if is_image else 0), not is_image
        )
        # Image alt text is parsed in a nested StateInline; link labels reuse
        # their enclosing state. Keep nested image/reference offsets exact.
        if is_image:
            inline_base += start + 2
        matched = rule(state, False)
        inline_base = base
        if matched:
            kind = "image" if is_image else "link_open"
            token = next(item for item in state.tokens[token_count:] if item.type == kind)
            label = token.meta.get("label")
            if label:
                labels.add(str(label))
                uses.append((base + end_label + 1, base + state.pos, f"[{names[str(label)]}]"))
        return matched

    parser.inline.ruler.at(
        "link", lambda state, silent: reference_rule(state, silent, is_image=False)
    )
    parser.inline.ruler.at(
        "image", lambda state, silent: reference_rule(state, silent, is_image=True)
    )
    for token in tokens:
        if token.type != "inline":
            continue
        uses.clear()
        parser.inline.parse(token.content, parser, env, [])
        if not uses:
            continue
        positions = _inline_offsets(fragment, token)
        for start, end, replacement in uses:
            # Replacing the suffix also expands collapsed/shortcut references;
            # text, image alt text and all surrounding formatting stay verbatim.
            begin = positions[start - 1] + 1
            finish = positions[end - 1] + 1 if end > start else begin
            edits.append((begin, finish, replacement))
    for start, end, replacement in sorted(edits, reverse=True):
        fragment = fragment[:start] + replacement + fragment[end:]
    context = "\n".join(
        _definition(names[label], ref)
        for label, ref in references.items()
        if label in labels & external
    )
    return context + "\n\n" + fragment if context else fragment


def _references(text: str) -> dict[str, Reference]:
    parser = MarkdownIt("commonmark", {"inline_definitions": True})
    references: dict[str, Reference] = {}
    for token in parser.parse(text):
        if token.type == "definition" and token.map is not None:
            references.setdefault(
                str(token.meta["id"]),
                Reference(
                    label=str(token.meta["label"]),
                    href=str(token.meta["url"]),
                    title=str(token.meta["title"]),
                    first_line=token.map[0],
                ),
            )
    return references


def preserve_reference_context(
    source: str, start: int, end: int, destination: str
) -> tuple[str, str, str]:
    """Return the independent selection, retained definitions and destination.

    Private labels prevent both collisions with destination links and accidental
    activation of its previously literal, unresolved bracketed text. Only parsed
    reference uses/definitions are renamed; fences, code and HTML remain intact.
    """
    references = _references(source)
    target_references = _references(destination)
    occupied = (source + "\n" + destination).casefold()

    def names_for(definitions: dict[str, Reference], role: str) -> dict[str, str]:
        nonlocal occupied
        names: dict[str, str] = {}
        for label in definitions:
            candidate = f"gnosi-composer-{role}-{len(names) + 1}"
            while candidate in occupied:
                candidate += "-moved"
            names[label] = candidate
            occupied += "\n" + candidate
        return names

    source_names = names_for(references, "source")
    target_names = names_for(target_references, "target")
    line_offsets = [0]
    for line in re.split(r"(?<=\n)|(?<=\r)(?!\n)", source):
        line_offsets.append(line_offsets[-1] + len(line))
    retained = "\n".join(
        _definition(ref.label, ref)
        for ref in references.values()
        if start <= line_offsets[ref.first_line] < end
    )
    external = {
        label
        for label, ref in references.items()
        if not start <= line_offsets[ref.first_line] < end
    }
    selected = (
        _namespace_fragment(source[start:end], references, source_names, external)
        if references
        else source[start:end]
    )
    target = (
        _namespace_fragment(destination, target_references, target_names, set())
        if target_references
        else destination
    )
    return selected, retained, target
