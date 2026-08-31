"""Markdown-aware translation for the `translate_page` skill.

Public surface (consumed by `backend.api.vault_routes`):

    translate_markdown(body, src, tgt, *, deepl_api_key=None, softcatala_url=None,
                       translate_fn=None) -> (str, set[str])   # (translated_md, providers)
    translate_title(title, src, tgt, *, ...) -> (str, str)     # (translated, provider)

The provider routing lives in the `translate_row` skill and is reused verbatim via
``translate()``; this module only adds the markdown-aware *segmentation* that protects
Gnosi's enriched directives so the translated markdown still re-parses cleanly with the
frontend's ``richMarkdownToBlocks``.

The canonical grammar of what must NOT be translated lives in
``frontend/src/components/Vault/markdown-mapper.js``; this module is its Python mirror.
See ``docs/dev_memory/directives/translate_page_skill.md`` for the full contract.

Note on acronyms: ``translate()`` already protects acronyms internally for the rule-based
providers, so this module does NOT re-protect them — it only tokenises markdown inline
constructs. The neutral token form ``XSEGnnnZZZ`` mirrors ``translate_row``'s
``XACRNnnnZZZ`` (no diacritics/spaces, survives most MT pipelines, restored
case-insensitively).
"""
from __future__ import annotations

import re
from typing import Callable, Optional

from pipeline.skills.translate_row.scripts.translate_text import (
    detect_source_lang as detect_source_lang,
)

# Reuse the translation primitives from the translate_row skill. `translate()` returns
# (text, provider); `detect_source_lang` is re-exported for the endpoint's convenience.
from pipeline.skills.translate_row.scripts.translate_text import (  # noqa: F401
    translate as _default_translate,
)

# ---------------------------------------------------------------------------
# Block-level patterns (matched against the *stripped* line)
# ---------------------------------------------------------------------------

_FENCE_RE = re.compile(r"^(`{3,}|~{3,})")
_GNOSI_IGNORE_RE = re.compile(r"^:{3,}gnosi-ignore\b")
_DIRECTIVE_CLOSE_RE = re.compile(r"^:{3,}\s*$")
_DIRECTIVE_OPEN_RE = re.compile(r"^:{3,}")
_TOGGLE_RE = re.compile(r"^(\s*)(:{3,}toggle)(\s+)(\S.*)$")
_BIBLIOGRAPHY_RE = re.compile(
    r"^\{\{bibliography(?::[a-z][a-z0-9-]*)?(?::[a-zA-Z-]+)?\}\}$"
)
_TRANSCLUSION_LINE_RE = re.compile(
    r"^!\[\[[^\]|#]+(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]$"
)
_HR_RE = re.compile(r"^-{3,}$")
_TABLE_SEP_RE = re.compile(r"^\|?\s*[:\- ]+\s*(\|?\s*[:\- ]+\s*)*\|?$")
_TABLE_CELL_SPLIT_RE = re.compile(r"(?<!\\)\|")

# ---------------------------------------------------------------------------
# Line-marker patterns (prefix preserved, only the trailing text translated).
# Order matters: checklist before bullet (a checklist is a bullet + "[ ]").
# ---------------------------------------------------------------------------

_LINE_MARKERS = (
    re.compile(r"^(\s*#{1,6}\s+)(.*)$"),                       # heading
    re.compile(r"^(\s*>(?:\s*>)*\s*(?:\[![^\]]+\]\s*)?)(.*)$"),  # blockquote / callout
    re.compile(r"^(\s*[-*+]\s+\[[ xX]\]\s+)(.*)$"),           # checklist
    re.compile(r"^(\s*[-*+]\s+)(.*)$"),                       # bullet
    re.compile(r"^(\s*\d+\.\s+)(.*)$"),                       # numbered
)

# ---------------------------------------------------------------------------
# Inline patterns (Phase C — protected with neutral tokens before translation)
# ---------------------------------------------------------------------------

_URL_PART = r"\((?:<[^>]*>|[^)]*)\)"
_INLINE_CODE_RE = re.compile(r"`[^`]+`")
_HTML_TAG_RE = re.compile(r"</?[a-zA-Z][^>]*>")
_IMAGE_RE = re.compile(r"!\[[^\]]*\]" + _URL_PART)
_WIKILINK_RE = re.compile(r"\[\[[^\]]*\]\]")
_CITE_BRACKET_RE = re.compile(r"\[@[^\]]*\]")
_LINK_RE = re.compile(r"(?<!\!)\[([^\]]*)\]\((<[^>]*>|[^)]*)\)")
_CITE_NAKED_RE = re.compile(r"(^|[\s(])@([a-z][a-z0-9_:-]*)\b", re.IGNORECASE)
_HAS_WORD_RE = re.compile(r"[^\W\d_]{2,}", re.UNICODE)


def _new_token(counter: list[int]) -> str:
    token = f"XSEG{counter[0]:03d}ZZZ"
    counter[0] += 1
    return token


def _restore_tokens(text: str, mapping: dict[str, str]) -> str:
    """Reverse the inline-token protection. Tolerant to MT case mangling."""
    out = text
    for token, original in mapping.items():
        def restore(_match: re.Match[str], value: str = original) -> str:
            return value

        out = re.sub(
            re.escape(token),
            restore,  # A callable replacement avoids backreference interpolation.
            out,
            flags=re.IGNORECASE,
        )
    return out


def _translate_inline_text(text: str, tr: Callable[[str], str]) -> str:
    """Translate one natural-language fragment, protecting inline markdown.

    ``tr`` is a ``str -> str`` translator (provider tracking happens in the caller).
    Returns the original text untouched when there is nothing translatable left after
    protection (e.g. a line that is just an image or a bare link).
    """
    if not text or not text.strip():
        return text

    mapping: dict[str, str] = {}
    counter = [0]

    def protect(pattern: re.Pattern[str], s: str) -> str:
        return pattern.sub(lambda m: _stash(m.group(0), mapping, counter), s)

    def _stash(value: str, mp: dict[str, str], cnt: list[int]) -> str:
        token = _new_token(cnt)
        mp[token] = value
        return token

    protected = text
    protected = protect(_INLINE_CODE_RE, protected)
    protected = protect(_HTML_TAG_RE, protected)
    protected = protect(_IMAGE_RE, protected)
    protected = protect(_WIKILINK_RE, protected)
    protected = protect(_CITE_BRACKET_RE, protected)
    # Links: keep the visible [text], protect only the (url).
    protected = _LINK_RE.sub(
        lambda m: f"[{m.group(1)}]({_stash(m.group(2), mapping, counter)})",
        protected,
    )
    # Naked citations: keep the leading whitespace/paren, protect "@key".
    protected = _CITE_NAKED_RE.sub(
        lambda m: m.group(1) + _stash("@" + m.group(2), mapping, counter),
        protected,
    )

    # Skip the network round-trip when nothing translatable remains.
    residual = protected
    for token in mapping:
        residual = residual.replace(token, " ")
    if not _HAS_WORD_RE.search(residual):
        return text

    translated = tr(protected)
    return _restore_tokens(translated, mapping)


def _translate_table_row(line: str, tr: Callable[[str], str]) -> str:
    """Translate a GFM table data row cell-by-cell, leaving the pipes intact."""
    raw = line.rstrip("\n")
    lead = raw[: len(raw) - len(raw.lstrip())]
    core = raw.strip()
    if not core.startswith("|"):
        return line
    parts = _TABLE_CELL_SPLIT_RE.split(core)
    inner = parts[1:-1] if len(parts) >= 2 else parts
    out_cells = []
    for cell in inner:
        txt = cell.strip()
        if txt:
            translated = _translate_inline_text(txt, tr).replace("|", "\\|")
        else:
            translated = txt
        out_cells.append(translated)
    return f"{lead}| " + " | ".join(out_cells) + " |"


def _translate_line(line: str, tr: Callable[[str], str]) -> str:
    """Translate a normal (non-directive) line, preserving any list/heading marker."""
    if not line.strip():
        return line
    if _HR_RE.match(line.strip()):
        return line
    for marker in _LINE_MARKERS:
        m = marker.match(line)
        if m:
            return m.group(1) + _translate_inline_text(m.group(2), tr)
    return _translate_inline_text(line, tr)


def _make_translator(
    src: str,
    tgt: str,
    deepl_api_key: Optional[str],
    softcatala_url: Optional[str],
    translate_fn: Optional[Callable[[str, str, str], str | tuple[str, str]]],
    providers: set[str],
) -> Callable[[str], str]:
    """Build a ``str -> str`` translator that records each provider used."""

    def _tr(text: str) -> str:
        if translate_fn is not None:
            res = translate_fn(text, src, tgt)
            out, provider = res if isinstance(res, tuple) else (res, "fake")
        else:
            out, provider = _default_translate(
                text, src, tgt, deepl_api_key=deepl_api_key, softcatala_url=softcatala_url
            )
        providers.add(provider)
        return out

    return _tr


def _copy_ignored_block(lines: list[str], i: int, out: list[str]) -> int:
    """Copy one gnosi-ignore block, including nested blocks and its close."""
    out.append(lines[i])
    i += 1
    depth = 1
    while i < len(lines) and depth > 0:
        s = lines[i].strip()
        if _GNOSI_IGNORE_RE.match(s):
            depth += 1
        elif _DIRECTIVE_CLOSE_RE.match(s):
            depth -= 1
        out.append(lines[i])
        i += 1
    return i


def translate_markdown(
    body: str,
    src: str,
    tgt: str,
    *,
    deepl_api_key: Optional[str] = None,
    softcatala_url: Optional[str] = None,
    translate_fn: Optional[Callable[[str, str, str], str | tuple[str, str]]] = None,
) -> tuple[str, set[str]]:
    """Translate the natural-language text of an enriched-markdown body.

    Returns ``(translated_markdown, providers)``. Structure (code fences, ``:::``
    directives, ``gnosi-database``/``gnosi-view`` blocks, ``{{bibliography}}``,
    transclusions, wikilinks, citations, links/images, HTML tags) is preserved so the
    result re-parses cleanly. ``translate_fn`` is injectable for tests.
    """
    providers: set[str] = set()
    if not body or src == tgt:
        return body, providers

    tr = _make_translator(src, tgt, deepl_api_key, softcatala_url, translate_fn, providers)

    lines = body.split("\n")
    out: list[str] = []
    i = 0
    n = len(lines)

    while i < n:
        line = lines[i]
        stripped = line.strip()

        # 1. Code fence — passthrough verbatim until the matching close.
        fence = _FENCE_RE.match(stripped)
        if fence:
            fence_char = fence.group(1)[0]
            close_re = re.compile(r"^" + re.escape(fence_char) + r"{3,}\s*$")
            out.append(line)
            i += 1
            while i < n:
                out.append(lines[i])
                closed = bool(close_re.match(lines[i].strip()))
                i += 1
                if closed:
                    break
            continue

        # 2. gnosi-ignore — passthrough the whole block (with nesting).
        if _GNOSI_IGNORE_RE.match(stripped):
            i = _copy_ignored_block(lines, i, out)
            continue

        # 3. Other ::: directive lines (column-list, column, toggle, close).
        if _DIRECTIVE_OPEN_RE.match(stripped):
            toggle = _TOGGLE_RE.match(line)
            if toggle:
                label = _translate_inline_text(toggle.group(4), tr)
                out.append(toggle.group(1) + toggle.group(2) + toggle.group(3) + label)
            else:
                out.append(line)
            i += 1
            continue

        # 4. Bibliography placeholder on its own line.
        if _BIBLIOGRAPHY_RE.match(stripped):
            out.append(line)
            i += 1
            continue

        # 5. Transclusion on its own line (target/section/alias untouched in v1).
        if _TRANSCLUSION_LINE_RE.match(stripped):
            out.append(line)
            i += 1
            continue

        # 6. GFM table — translate cells, keep the separator row intact.
        if (
            stripped.startswith("|")
            and i + 1 < n
            and _TABLE_SEP_RE.match(lines[i + 1].strip())
        ):
            out.append(_translate_table_row(line, tr))
            out.append(lines[i + 1])  # separator row
            i += 2
            while i < n and lines[i].strip().startswith("|"):
                out.append(_translate_table_row(lines[i], tr))
                i += 1
            continue

        # 7. Normal line — preserve marker, translate the text.
        out.append(_translate_line(line, tr))
        i += 1

    return "\n".join(out), providers


def translate_title(
    title: str,
    src: str,
    tgt: str,
    *,
    deepl_api_key: Optional[str] = None,
    softcatala_url: Optional[str] = None,
    translate_fn: Optional[Callable[[str, str, str], str | tuple[str, str]]] = None,
) -> tuple[str, str]:
    """Translate a page title (plain text). Returns ``(translated, provider)``."""
    if not title or not title.strip() or src == tgt:
        return title, "noop"
    providers: set[str] = set()
    tr = _make_translator(src, tgt, deepl_api_key, softcatala_url, translate_fn, providers)
    translated = _translate_inline_text(title, tr)
    provider = "mixed" if len(providers) > 1 else next(iter(providers), "noop")
    return translated, provider
