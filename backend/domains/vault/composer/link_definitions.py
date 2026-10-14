"""Locate validated CommonMark reference destinations at exact source offsets."""

from __future__ import annotations

from collections.abc import Callable

from markdown_it.rules_block import reference
from markdown_it.rules_block.state_block import StateBlock

Destination = tuple[int, int, str]


def _definition_source(state: StateBlock, first: int) -> tuple[str, list[int]]:
    parts: list[str] = []
    positions: list[int] = []
    for line in range(first, state.line):
        start = state.bMarks[line] + state.tShift[line]
        end = min(state.eMarks[line] + 1, len(state.src))
        parts.append(state.src[start:end])
        positions.extend(range(start, end))
    return "".join(parts), positions


def _destination(state: StateBlock, first: int) -> Destination | None:
    source, positions = _definition_source(state, first)
    cursor = 1
    while cursor < len(source) and source[cursor] != "]":
        if source[cursor] == "\\":
            cursor += 1
        cursor += 1
    cursor += 2
    while cursor < len(source) and source[cursor] in " \t\n":
        cursor += 1
    result = state.md.helpers.parseLinkDestination(source, cursor, len(source))
    if not result.ok or result.pos <= cursor:
        return None
    return (
        positions[cursor],
        positions[result.pos - 1] + 1,
        state.md.normalizeLink(result.str),
    )


def reference_rule(
    targets: list[Destination], masks: list[tuple[int, int]]
) -> Callable[[StateBlock, int, int, bool], bool]:
    def rule(state: StateBlock, first: int, last: int, silent: bool) -> bool:
        start = state.bMarks[first] + state.tShift[first]
        matched = reference(state, first, last, silent)
        if matched and not silent:
            masks.append((start, min(state.eMarks[state.line - 1] + 1, len(state.src))))
            target = _destination(state, first)
            if target is not None:
                targets.append(target)
        return matched

    return rule
