"""Converter from Notion MCP's rich Markdown → Gnosi Markdown (for the exact CLONE).

The hosted MCP returns the content faithfully (columns, colors, embedded views,
toggles, mentions) in a «Notion-flavored» Markdown with its own tags and annotations
`{color=...}`/`{toggle=...}`. This module converts it to Gnosi Markdown WHILE PRESERVING IT:
- `<database url=".../<id>" inline>` → `<!-- gnosi-notion-db:<id> -->` (the orchestrator
  replaces it with the `gnosi-view` resolved via `notion_view_recreator`).
- `<mention-page url=".../<id>">Text</mention-page>` → `[[Text]]` (or `[[<id>]]`).
- `<columns>/<column>` → `:::column-list` / `:::column` (Gnosi DOES have columns).
- `{color="X"}`/`{color="X_bg"}` → `<span style="color|background-color:#hex">…</span>`.
- `{toggle="true"}` → `:::toggle` / `:::toggle-heading{level=N}` with the children INSIDE.
- `<details><summary>…</summary>…</details>` (block toggles, new MCP format) → `:::toggle`.
- `<file|pdf|audio|video|embed src="file://{json}">` (Notion-hosted attachments) →
  `<!-- gnosi-notion-file:<block_id>:<filename> -->` (the orchestrator downloads the real
  file via REST and rewrites it as a local link; cf. `notion_attachments.resolve_file_markers`).
  External `http(s)` sources become plain Markdown links.
- `<empty-block/>` (intentional empty line, always alone on its line) → dropped; block
  spacing already renders the gap, and left raw the editor's unknown-tag defense
  (markdown-mapper.js `wrapUnknownHtmlTags`) would show it as a code chip.
- indentation with tabs → Markdown indentation (list nesting is preserved).
- ``` ``` ``` code blocks are protected (nothing inside is touched).

PURE (no network) → testable with the MCP's real markdown.
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Tuple
from urllib.parse import quote, unquote

# Notion color palette → hex (text and background)
_TEXT_HEX = {
    "gray": "#787774", "brown": "#9f6b53", "orange": "#d9730d", "yellow": "#cb912f",
    "green": "#448361", "blue": "#337ea9", "purple": "#9065b0", "pink": "#c14d8a", "red": "#d44c47",
}
_BG_HEX = {
    "gray": "#f1f1ef", "brown": "#f3eeee", "orange": "#fbecdd", "yellow": "#fbf3db",
    "green": "#edf3ec", "blue": "#e7f3f8", "purple": "#f6f3f9", "pink": "#faf1f8", "red": "#fdebec",
}

# inline="true" might NOT be the last attribute: the MCP's new format adds
# data-source-url="collection://…" afterward → later attributes must be tolerated ([^>]*).
_DB_RE = re.compile(
    r'<database\s+url="[^"]*?([0-9a-f]{32})"[^>]*\binline="true"[^>]*>.*?</database>', re.DOTALL)
_DB_SELFCLOSE_RE = re.compile(
    r'<database\s+url="[^"]*?([0-9a-f]{32})"[^>]*\binline="true"[^>]*/?>')
_MENTION_RE = re.compile(
    r'<mention-page\s+url="[^"]*?([0-9a-f]{32})"\s*>(.*?)</mention-page>', re.DOTALL)
_MENTION_SELF_RE = re.compile(r'<mention-page\s+url="[^"]*?([0-9a-f]{32})"\s*/>')
# Sub-pages: the MCP lists them as <page url=".../<id>">Title</page> → wikilink (by title, which
# resolves in the clone; the clone already follows sub-pages as their own pages).
_PAGE_RE = re.compile(r'<page\s+url="[^"]*?([0-9a-f]{32})"\s*>(.*?)</page>', re.DOTALL)
_PAGE_SELF_RE = re.compile(r'<page\s+url="[^"]*?([0-9a-f]{32})"\s*/>')
_CODE_RE = re.compile(r"```.*?```", re.DOTALL)
# Attachment/media blocks share one shape: <file|pdf|audio|video|embed src="…">Caption</…>.
# A Notion-hosted file has NO public URL: src is `file://{urlencoded json}` whose JSON carries
# `source: "attachment:<uuid>:<filename>"` and `permissionRecord.id` = the Notion BLOCK id —
# the only key the REST API can turn into a fresh signed URL. Left raw, these tags reach the
# vault and BlockNote silently drops them on the first save (171 attachments lost on
# «Curs de narrativa i conte I, II», 2026-07-19) → they always become a marker or plain text.
_FILE_TAG_RE = re.compile(
    r'<(file|pdf|audio|video|embed)\s+src="([^"]*)"[^>]*>(.*?)</\1>', re.DOTALL)
_FILE_SELF_RE = re.compile(r'<(file|pdf|audio|video|embed)\s+src="([^"]*)"[^>]*/>')
# Block toggles, new MCP format (block-level, unindented children — cf. enhanced-markdown spec):
# <details color?="X">\n<summary>Title</summary>\n…children…\n</details> → :::toggle fence.
_DETAILS_SUMMARY_RE = re.compile(r'<details([^>]*)>\s*<summary>(.*?)</summary>', re.DOTALL)
_DETAILS_LONE_RE = re.compile(r'<details[^>]*>')
_DETAILS_CLOSE_RE = re.compile(r'</details>')
# Intentional empty line («Empty line: <empty-block/>» in the enhanced-markdown spec), always
# alone on its own line, tab-indented when nested. No children by definition → the whole line
# can be dropped without reshaping the indentation tree.
_EMPTY_BLOCK_RE = re.compile(r'^[ \t]*<empty-block\s*/>[ \t]*$', re.MULTILINE)

# Marker emitted for Notion-hosted attachments; resolved by the clone orchestrator
# (`notion_attachments.resolve_file_markers`). Filename is percent-encoded (no spaces/`>`).
FILE_MARKER_RE = re.compile(r'<!--\s*gnosi-notion-file:([0-9a-f]{32}):([^\s>]*)\s*-->')
# {k="v" ...} annotation at the END of the line
_ANNOT_RE = re.compile(r'\s*\{([a-zA-Z_]+="[^"]*"(?:\s+[a-zA-Z_]+="[^"]*")*)\}\s*$')
# Markdown prefix (heading/list/quote) to wrap only the content with color
_MD_PREFIX_RE = re.compile(r'^(\s*(?:#{1,6}\s+|[-*]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+|>\s+)?)(.*)$', re.DOTALL)


def file_marker(block_id: str, filename: str) -> str:
    """Stable marker for a Notion-hosted attachment (resolved by the clone orchestrator)."""
    bid = str(block_id or "").replace("-", "").lower()
    return f"<!-- gnosi-notion-file:{bid}:{quote(filename or '', safe='')} -->"


def _parse_file_src(src: str) -> Tuple[str, str]:
    """(block_id, filename) from the MCP's `file://{urlencoded json}` src ('' when missing)."""
    try:
        obj = json.loads(unquote(src[len("file://"):]))
        source = str(obj.get("source") or "")
        fname = source.split(":", 2)[2] if source.startswith("attachment:") else ""
        bid = str((obj.get("permissionRecord") or {}).get("id") or "")
        return bid, fname
    except Exception:  # noqa: BLE001 — malformed src → readable fallback downstream
        return "", ""


def _basename_from_url(url: str) -> str:
    return unquote((url.split("?")[0].rstrip("/").rsplit("/", 1)[-1]) or "").strip()


def _file_tag_to_md(src: str, caption: str) -> str:
    """One `<file|pdf|audio|video|embed>` tag → marker (Notion-hosted), link (external URL)
    or readable plain text. Never returns the raw tag."""
    src, caption = (src or "").strip(), " ".join((caption or "").split())
    if src.startswith("file://"):
        bid, fname = _parse_file_src(src)
        label = fname or caption or "fitxer adjunt"
        if re.fullmatch(r"[0-9a-f]{32}", bid.replace("-", "").lower()):
            marker = file_marker(bid, label)
            return f"{marker} {caption}" if caption and caption != label else marker
        return f"📎 {label}"
    if src.lower().startswith(("http://", "https://")):
        label = caption or _basename_from_url(src) or src
        return f"[{label}]({src})"
    # file-upload:// or an unresolved compressed src → keep at least a readable trace
    return f"📎 {caption or 'fitxer adjunt'}"


def _details_to_fences(text: str) -> str:
    """`<details><summary>T</summary>…</details>` → `:::toggle T` … `:::` (line-level, so the
    indentation-tree serializer sees plain fence lines; nested details keep working)."""
    def _open(m: "re.Match[str]") -> str:
        cm = re.search(r'color="([^"]*)"', m.group(1) or "")
        title = " ".join((m.group(2) or "").split())
        if cm and title:
            title = _color_inline(title, {"color": cm.group(1)})
        return f":::toggle {title}".rstrip()

    text = _DETAILS_SUMMARY_RE.sub(_open, text)
    text = _DETAILS_LONE_RE.sub(":::toggle", text)   # details without summary (rare)
    return _DETAILS_CLOSE_RE.sub(":::", text)


def extract_db_ids(page_md: str) -> List[str]:
    """ids (32-hex) of the embedded views, in order of appearance."""
    return [m.group(1) for m in re.finditer(
        r'<database\s+url="[^"]*?([0-9a-f]{32})"[^>]*\binline="true"', page_md or "")]


def _color_style(token: str) -> str:
    token = (token or "").strip()
    if token in ("", "default"):
        return ""
    if token.endswith("_background"):
        token = token[:-len("_background")] + "_bg"
    if token.endswith("_bg"):
        h = _BG_HEX.get(token[:-3])
        return f"background-color:{h}" if h else ""
    h = _TEXT_HEX.get(token)
    return f"color:{h}" if h else ""


def _parse_annot(line: str) -> Tuple[str, Dict[str, str]]:
    """Removes `{k="v" ...}` from the end and returns (text_net, {k:v})."""
    m = _ANNOT_RE.search(line)
    if not m:
        return line, {}
    attrs = dict(re.findall(r'([a-zA-Z_]+)="([^"]*)"', m.group(1)))
    return line[:m.start()].rstrip(), attrs


def _color_inline(content: str, attrs: Dict[str, str]) -> str:
    style = _color_style(attrs.get("color", ""))
    if not style or not content.strip():
        return content
    return f'<span style="{style}">{content}</span>'


def _apply_color(text: str, attrs: Dict[str, str]) -> str:
    """Wraps the line's CONTENT with the color (preserving the md prefix `# `, `- `…)."""
    style = _color_style(attrs.get("color", ""))
    if not style or not text.strip():
        return text
    m = _MD_PREFIX_RE.match(text)
    prefix, content = m.group(1), m.group(2)
    if not content.strip():
        return text
    return f'{prefix}{_color_inline(content, attrs)}'


def _indent_and_text(line: str) -> Tuple[int, str]:
    n = 0
    for ch in line:
        if ch == "\t":
            n += 1
        else:
            break
    return n, line[n:]


def _build_tree(pairs: List[Tuple[int, str]]) -> List[list]:
    """[(indent, text)] → tree [[text, [children…]], …] according to indentation (tabs)."""
    root: List[list] = []
    stack: List[Tuple[int, list]] = [(-1, root)]
    for indent, text in pairs:
        node = [text, []]
        while stack and stack[-1][0] >= indent:
            stack.pop()
        stack[-1][1].append(node)
        stack.append((indent, node[1]))
    return root


def _is_list_item(text: str) -> bool:
    return bool(re.match(r'^\s*(?:[-*]\s+|\d+\.\s+)', text))


def _serialize(nodes: List[list], out: List[str]) -> None:
    for text, children in nodes:
        low = text.strip().lower()
        if low.startswith("<columns"):
            out.append(":::column-list")
            _serialize(children, out)
            out.append(":::")
        elif low.startswith("<column"):
            out.append(":::column")
            _serialize(children, out)
            out.append(":::")
        elif low.startswith("</column"):
            continue  # closers: the tree already nests
        else:
            clean, attrs = _parse_annot(text.strip())
            if attrs.get("toggle") == "true":
                hm = re.match(r'^(#{1,6})\s+(.*)$', clean)
                if hm:
                    title = _color_inline(hm.group(2), attrs)
                    out.append(f":::toggle-heading{{level={len(hm.group(1))}}} {title}")
                else:
                    out.append(f":::toggle {_color_inline(clean, attrs)}")
                _serialize(children, out)
                out.append(":::")
            else:
                out.append(_apply_color(clean, attrs))
                if children:
                    sub: List[str] = []
                    _serialize(children, sub)
                    indent = "  " if _is_list_item(text) else ""
                    out.extend((indent + s) if s else s for s in sub)


def mcp_to_markdown(page_md: str) -> str:
    """Converts the MCP's markdown to Gnosi Markdown (clone fidelity)."""
    m = re.search(r"<content>(.*)</content>", page_md or "", re.DOTALL)
    text = m.group(1) if m else (page_md or "")

    # 0) protect code blocks (leave untouched: they may have <, tabs, {…})
    codes: List[str] = []

    def _stash(mm):
        codes.append(mm.group(0))
        return f"§§CODE{len(codes) - 1}§§"
    text = _CODE_RE.sub(_stash, text)

    # 0b) `<empty-block/>` (intentional empty line) → dropped: the blank line it stands for
    # is already rendered by block spacing, and the raw tag would surface as a code chip in
    # the editor (markdown-mapper.js `wrapUnknownHtmlTags`)
    text = _EMPTY_BLOCK_RE.sub("", text)

    # 1) embedded views → neutral placeholder (relabeled at the end)
    text = _DB_RE.sub(lambda mm: f"§§GNOSIDB:{mm.group(1)}§§", text)
    text = _DB_SELFCLOSE_RE.sub(lambda mm: f"§§GNOSIDB:{mm.group(1)}§§", text)

    # 1b) attachment/media tags → marker (Notion-hosted), link (external) or plain text
    text = _FILE_TAG_RE.sub(lambda mm: _file_tag_to_md(mm.group(2), mm.group(3)), text)
    text = _FILE_SELF_RE.sub(lambda mm: _file_tag_to_md(mm.group(2), ""), text)

    # 1c) block toggles <details>/<summary> → :::toggle fences (before the indentation tree)
    text = _details_to_fences(text)

    # 2) mentions and sub-pages → wikilinks (by title when available → resolves in the clone)
    text = _MENTION_RE.sub(lambda mm: f"[[{(mm.group(2).strip() or mm.group(1))}]]", text)
    text = _MENTION_SELF_RE.sub(lambda mm: f"[[{mm.group(1)}]]", text)
    text = _PAGE_RE.sub(lambda mm: f"[[{(mm.group(2).strip() or mm.group(1))}]]", text)
    text = _PAGE_SELF_RE.sub(lambda mm: f"[[{mm.group(1)}]]", text)

    # 3) tree by indentation → serialization (columns, toggles, colors, nested lists)
    pairs = [_indent_and_text(ln) for ln in text.splitlines() if ln.strip()]
    out: List[str] = []
    _serialize(_build_tree(pairs), out)
    cleaned = "\n".join(out)

    # 4) block equations $$…$$ → `latex` code block (Gnosi has no native equations)
    cleaned = re.sub(r"\$\$(.+?)\$\$", lambda mm: f"```latex\n{mm.group(1).strip()}\n```",
                     cleaned, flags=re.DOTALL)

    # 5) placeholders → marcadors finals
    cleaned = re.sub(r"§§GNOSIDB:([0-9a-f]{32})§§",
                     lambda mm: f"<!-- gnosi-notion-db:{mm.group(1)} -->", cleaned)
    cleaned = re.sub(r"§§CODE(\d+)§§", lambda mm: codes[int(mm.group(1))], cleaned)

    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned
