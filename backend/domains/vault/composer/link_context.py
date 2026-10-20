"""Expose genuine CommonMark destinations separately from literal wiki text."""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass

from markdown_it import MarkdownIt
from markdown_it.rules_inline import autolink, backtick, html_inline, image, link
from markdown_it.rules_inline.state_inline import StateInline
from markdown_it.token import Token
from markdown_it.utils import EnvType

from .link_definitions import Destination, reference_rule
from .references import _inline_offsets


@dataclass(frozen=True)
class LinkTarget:
    start: int
    end: int
    value: str
    markdown: bool = True


def _normalized_source(text: str) -> tuple[str, list[int]]:
    characters: list[str] = []
    positions: list[int] = []
    index = 0
    while index < len(text):
        positions.append(index)
        character = text[index]
        characters.append(
            "\n" if character == "\r" else "\ufffd" if character == "\0" else character
        )
        index += 1
        if character == "\r" and index < len(text) and text[index] == "\n":
            index += 1
    return "".join(characters), positions


class _InlineTargets:
    def __init__(self) -> None:
        self.base = 0
        self.image_depth = 0
        self.masks: list[tuple[int, int]] = []
        self.targets: list[Destination] = []

    def label(self, state: StateInline, silent: bool, *, is_image: bool) -> bool:
        rule = image if is_image else link
        if silent:
            return rule(state, silent)
        start, base, count = state.pos, self.base, len(state.tokens)
        prefix = "![" if is_image else "["
        if state.src[start : start + len(prefix)] != prefix:
            return False
        end_label = state.md.helpers.parseLinkLabel(state, start + int(is_image), not is_image)
        visible_target = self.image_depth == 0
        if is_image:
            self.base += start + 2
            self.image_depth += 1
        try:
            matched = rule(state, False)
        finally:
            self.base = base
            if is_image:
                self.image_depth -= 1
        if matched:
            self.masks.append((base + start, base + state.pos))
            if visible_target:
                self._destination(state, count, base, end_label, is_image)
        return matched

    def _destination(
        self, state: StateInline, count: int, base: int, end_label: int, is_image: bool
    ) -> None:
        kind = "image" if is_image else "link_open"
        token = next(item for item in state.tokens[count:] if item.type == kind)
        if token.meta.get("label") or state.src[end_label + 1 : end_label + 2] != "(":
            return
        cursor = end_label + 2
        while cursor < state.posMax and state.src[cursor] in " \t\n":
            cursor += 1
        result = state.md.helpers.parseLinkDestination(state.src, cursor, state.posMax)
        if result.ok and result.pos > cursor:
            value = str(token.attrGet("src" if is_image else "href") or "")
            self.targets.append((base + cursor, base + result.pos, value))

    def literal(
        self,
        state: StateInline,
        silent: bool,
        rule: Callable[[StateInline, bool], bool],
        *,
        is_autolink: bool = False,
    ) -> bool:
        if silent:
            return rule(state, silent)
        start, count = state.pos, len(state.tokens)
        matched = rule(state, False)
        if matched and len(state.tokens) > count:
            self.masks.append((self.base + start, self.base + state.pos))
            if is_autolink and self.image_depth == 0:
                token = next(item for item in state.tokens[count:] if item.type == "link_open")
                self.targets.append(
                    (self.base + start, self.base + state.pos, str(token.attrGet("href")))
                )
        return matched


def _mask_positions(masked: list[str], positions: list[int]) -> None:
    for position in positions:
        if masked[position] not in "\r\n":
            masked[position] = " "


def literal_wiki_prefix(start: int, wiki_start: int, text: str, visible: str) -> bool:
    """An escaped embed bang makes its immediately adjacent wiki text literal."""
    return (
        wiki_start - start == 2
        and start > 0
        and text[start - 1] == "!"
        and visible[start - 1] == " "
    )


def _inline_targets(
    source: str,
    raw_positions: list[int],
    masked: list[str],
    token: Token,
    parser: MarkdownIt,
    environment: EnvType,
    tracker: _InlineTargets,
) -> list[LinkTarget]:
    tracker.masks.clear()
    tracker.targets.clear()
    parser.inline.parse(token.content, parser, environment, [])
    if not tracker.masks:
        return []
    positions = [raw_positions[index] for index in _inline_offsets(source, token)]
    for start, end in tracker.masks:
        _mask_positions(masked, positions[start:end])
    return [
        LinkTarget(positions[start], positions[end - 1] + 1, value)
        for start, end, value in tracker.targets
    ]


def link_targets(text: str) -> tuple[str, list[LinkTarget]]:
    """Return literal-safe wiki source and exact parsed Markdown destinations."""
    source, raw_positions = _normalized_source(text)
    parser = MarkdownIt("commonmark", {"inline_definitions": True, "store_labels": True})
    definitions: list[Destination] = []
    definition_masks: list[tuple[int, int]] = []
    parser.block.ruler.at("reference", reference_rule(definitions, definition_masks))
    environment: EnvType = {}
    tokens = parser.parse(source, environment)
    tracker = _InlineTargets()
    parser.inline.ruler.at(
        "link", lambda state, silent: tracker.label(state, silent, is_image=False)
    )
    parser.inline.ruler.at(
        "image", lambda state, silent: tracker.label(state, silent, is_image=True)
    )
    parser.inline.ruler.at(
        "backticks", lambda state, silent: tracker.literal(state, silent, backtick)
    )
    parser.inline.ruler.at(
        "autolink", lambda state, silent: tracker.literal(state, silent, autolink, is_autolink=True)
    )
    parser.inline.ruler.at(
        "html_inline", lambda state, silent: tracker.literal(state, silent, html_inline)
    )
    masked = list(text)
    for match in re.finditer(r"\\[\\`!\[\]()]", text):
        _mask_positions(masked, list(range(match.start(), match.end())))
    line_offsets = [0]
    for line in source.split("\n")[:-1]:
        line_offsets.append(line_offsets[-1] + len(line) + 1)
    line_offsets.append(len(source))
    targets = [
        LinkTarget(raw_positions[start], raw_positions[end - 1] + 1, value)
        for start, end, value in definitions
    ]
    for start, end in definition_masks:
        _mask_positions(masked, raw_positions[start:end])
    for token in tokens:
        if token.type in {"fence", "code_block", "html_block"} and token.map is not None:
            _mask_positions(
                masked, raw_positions[line_offsets[token.map[0]] : line_offsets[token.map[1]]]
            )
        if token.type == "inline":
            targets.extend(
                _inline_targets(source, raw_positions, masked, token, parser, environment, tracker)
            )
    return "".join(masked), targets
