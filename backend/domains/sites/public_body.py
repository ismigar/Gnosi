"""Publish authored Markdown while omitting native embedded work views/cache."""
from __future__ import annotations

import json
import re
from html.parser import HTMLParser
from typing import NoReturn

from fastapi import HTTPException
from markdown_it import MarkdownIt
from markdown_it.rules_inline.backticks import backtick
from markdown_it.rules_inline.state_inline import StateInline

from backend.domains.vault.views.snapshot_markup import DEF_COMMENT_RE, RESULT_TRUNC_RE


_RESERVED = re.compile(r'<!--\s*/?gnosi-(?:view|database)|gnosi-view-snapshot|data-gnosi-view', re.I)
_COLUMN_MARKER = re.compile(r'(?m)^[ \t]*:::+column(?:-list)?\b')
_HTML_MARKER = re.compile(r'<[^>]*\bgnosi-(?:view|database)\b', re.I)
_FENCE_MARKER = re.compile(r'(?:`+|~+)[ \t]*gnosi-(?:view|database)\b', re.I)


_RESULT_BOUNDARY = re.compile(r'<!--\s*(?P<closing>/?)gnosi-view:result(?=\s|-->)', re.I)

def _invalid(message: str = 'An embedded work view is malformed or unsupported; correct it before publishing') -> NoReturn:
    raise HTTPException(422, message)


def _payload(raw: str) -> None:
    def invalid_constant(_value: str) -> NoReturn:
        _invalid()
    try:
        value = json.loads(raw, parse_constant=invalid_constant)
    except (ValueError, TypeError, RecursionError):
        _invalid()
    if not isinstance(value, dict):
        _invalid()


def _cache_boundaries(body: str) -> None:
    # Legacy row values were written verbatim. A row can forge complete close,
    # definition and reopen sequences, including standalone lines and IDs.
    # With multiple raw pairs no reader can distinguish a private cache gap
    # from authored text: reject rather than publish or silently delete either.
    markers = list(_RESULT_BOUNDARY.finditer(body))
    if markers and (len(markers) != 2 or markers[0].group('closing') or not markers[1].group('closing')):
        _invalid('Embedded work-view cache boundaries are ambiguous; remove the cached results before publishing authored text')


class _ViewComments(HTMLParser):
    """Match owning comment tokens and balanced nested result regions."""

    def __init__(self, body: str, offsets: list[int]) -> None:
        super().__init__(convert_charrefs=False)
        self.body = body
        self.offsets = offsets
        self.results: list[int] = []
        self.removals: list[tuple[int, int, str]] = []

    def _standalone(self, start: int, end: int) -> None:
        line_start = self.body.rfind('\n', 0, start) + 1
        line_end = self.body.find('\n', end)
        if line_end < 0:
            line_end = len(self.body)
        if self.body[line_start:start].strip() or self.body[end:line_end].strip():
            _invalid()

    def handle_comment(self, data: str) -> None:
        text = data.strip()
        if not re.match(r'/?gnosi-(?:view|database)', text, re.I):
            return
        line, column = self.getpos()
        start = self.offsets[line - 1] + column
        closing = self.body.find('-->', start)
        if closing < 0:
            _invalid()
        end = closing + 3
        raw = self.body[start:end]
        definition = DEF_COMMENT_RE.fullmatch(raw)
        if definition:
            self._standalone(start, end)
            _payload(definition.group('json'))
            self.removals.append((start, end, ''))
        elif re.fullmatch(r'gnosi-view:result(?:\s+view_id=[^\s<>]+)?', text):
            self._standalone(start, end)
            self.results.append(start)
        elif text == '/gnosi-view:result':
            self._standalone(start, end)
            if not self.results:
                _invalid()
            opened = self.results.pop()
            self.removals.append((opened, end, ''))
        elif RESULT_TRUNC_RE.fullmatch(raw) and self.results:
            pass
        else:
            _invalid()


def _line_offsets(body: str) -> list[int]:
    offsets = [0]
    for line in body.splitlines(keepends=True):
        offsets.append(offsets[-1] + len(line))
    return offsets


def _fences(body: str, offsets: list[int]) -> tuple[list[tuple[int, int, str]], list[tuple[int, int]]]:
    removals: list[tuple[int, int, str]] = []
    opaque: list[tuple[int, int]] = []
    # Match the actual public body renderer: an HTML-looking wrapper must not
    # hide authored code fences from the Markdown lexer. Native view controls
    # are still recognized independently by the comment parser below.
    for token in MarkdownIt('commonmark', {'html': False, 'linkify': False}).parse(body):
        if token.map is None:
            continue
        start, end = token.map
        language = token.info.strip().lower()
        if token.type == 'fence' and language.startswith(('gnosi-view', 'gnosi-database')):
            if language not in {'gnosi-view', 'gnosi-database'}:
                _invalid()
            # MarkdownIt's map includes a closing fence only when the source
            # region has two boundary lines beyond the actual content lines.
            if end - start != len(token.content.splitlines()) + 2:
                _invalid()
            _payload(token.content)
            removals.append((offsets[start], offsets[end], ''))
        elif token.type == 'fence':
            opaque.append((offsets[start], offsets[end]))
        elif token.type == 'code_block' and (_RESERVED.search(token.content) or _FENCE_MARKER.search(token.content)):
            # Editor structural containers can indent an embedded work view.
            # Parse the dedented code content rather than treating it as public
            # code or searching for a guessed matching triple-backtick line.
            if not _FENCE_MARKER.search(token.content):
                _invalid('Work-view syntax inside indented code is ambiguous; use a fenced code example before publishing')
            projected = public_markdown(token.content)
            replacement = ''.join('    ' + line if line.strip() else line for line in projected.splitlines(keepends=True))
            removals.append((offsets[start], offsets[end], replacement))
    return removals, opaque


def _mask(body: str, ranges: list[tuple[int, int]]) -> str:
    masked = list(body)
    for start, end in ranges:
        masked[start:end] = ['\n' if char == '\n' else ' ' for char in body[start:end]]
    return ''.join(masked)


def _inline_code(body: str) -> list[tuple[int, int]]:
    ranges: list[tuple[int, int]] = []
    parser = MarkdownIt('commonmark', {'html': False, 'linkify': False})

    def capture(state: StateInline, silent: bool) -> bool:
        start, count = state.pos, len(state.tokens)
        matched = backtick(state, silent)
        if not silent and len(state.tokens) > count and state.tokens[-1].type == 'code_inline':
            raw = state.src[start:state.pos]
            if '\n' in raw or '\r' in raw:
                # A whole-source inline scan cannot prove paragraph/container
                # boundaries. Do not mask a real view/cache across those lines.
                if _RESERVED.search(raw) or _FENCE_MARKER.search(raw) or _HTML_MARKER.search(raw):
                    _invalid('Multiline work-view examples require an ordinary fenced code block before publishing')
            else:
                ranges.append((start, state.pos))
        return matched

    parser.inline.ruler.at('backticks', capture)
    parser.inline.parse(body, parser, {}, [])
    return ranges


def _apply(body: str, edits: list[tuple[int, int, str]]) -> str:
    output: list[str] = []
    position = 0
    # Wider enclosing private result regions win over definitions within them.
    for start, end, replacement in sorted(edits, key=lambda edit: (edit[0], -edit[1])):
        if start < position:
            if end > position:
                _invalid()
            continue
        output.extend([body[position:start], replacement])
        position = end
    return ''.join(output) + body[position:]


def public_markdown(body: str) -> str:
    """No note writes, view evaluation, snapshots, or fallback content sources."""
    _cache_boundaries(body)
    offsets = _line_offsets(body)
    fences, opaque = _fences(body, offsets)
    fence_ranges = [(start, end) for start, end, _replacement in fences]
    masked = _mask(body, fence_ranges + opaque)
    opaque += _inline_code(masked)
    # Opaque authored code cannot be used to hide true cached-result boundaries.
    # Global boundary counting above still runs over the original source.
    if any(_RESULT_BOUNDARY.search(body[start:end]) for start, end in opaque):
        _invalid('Cached work-view results inside code are ambiguous; remove the cached results before publishing')
    masked = _mask(body, fence_ranges + opaque)
    comments = _ViewComments(masked, offsets)
    comments.feed(masked)
    comments.close()
    if comments.results:
        _invalid()
    edits = fences + comments.removals
    visible = _mask(body, [(start, end) for start, end, _replacement in edits] + opaque)
    if _RESERVED.search(visible) or _FENCE_MARKER.search(visible) or _COLUMN_MARKER.search(visible) or _HTML_MARKER.search(visible):
        _invalid()
    return _apply(body, edits)
