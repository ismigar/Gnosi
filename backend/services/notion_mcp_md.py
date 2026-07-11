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
- indentation with tabs → Markdown indentation (list nesting is preserved).
- ``` ``` ``` code blocks are protected (nothing inside is touched).

PURE (no network) → testable with the MCP's real markdown.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple

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
# {k="v" ...} annotation at the END of the line
_ANNOT_RE = re.compile(r'\s*\{([a-zA-Z_]+="[^"]*"(?:\s+[a-zA-Z_]+="[^"]*")*)\}\s*$')
# Markdown prefix (heading/list/quote) to wrap only the content with color
_MD_PREFIX_RE = re.compile(r'^(\s*(?:#{1,6}\s+|[-*]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+|>\s+)?)(.*)$', re.DOTALL)


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

    # 1) embedded views → neutral placeholder (relabeled at the end)
    text = _DB_RE.sub(lambda mm: f"§§GNOSIDB:{mm.group(1)}§§", text)
    text = _DB_SELFCLOSE_RE.sub(lambda mm: f"§§GNOSIDB:{mm.group(1)}§§", text)

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
