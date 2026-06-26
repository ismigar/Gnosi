"""Conversor del Markdown ric de l'MCP de Notion → Markdown de Gnosi (per al CLON exacte).

L'MCP allotjat retorna el contingut amb fidelitat (columnes, colors, vistes incrustades,
mencions) en un Markdown «de Notion» amb etiquetes pròpies. Aquest mòdul el converteix a
Markdown de Gnosi:
- `<database url=".../<id>" inline>` → marcador `<!-- gnosi-notion-db:<id> -->` (l'orquestrador
  el reemplaça per la `gnosi-view` resolta amb `notion_view_recreator`).
- `<mention-page url=".../<id>">Text</mention-page>` → `[[Text]]` (o `[[<id>]]` si és buida).
- `<columns>/<column>` → aplanat (contingut seqüencial; Gnosi no té columnes al Markdown v1).
- `{color=...}`/`{toggle=...}` → tret. Tabs d'indentació → desfets. Altres etiquetes → tretes.

PUR (sense xarxa) → testejable amb el markdown real de l'MCP.
"""
from __future__ import annotations

import re
from typing import List

_DB_RE = re.compile(
    r'<database\s+url="[^"]*?([0-9a-f]{32})"[^>]*\binline="true"\s*>.*?</database>',
    re.DOTALL)
_DB_SELFCLOSE_RE = re.compile(
    r'<database\s+url="[^"]*?([0-9a-f]{32})"[^>]*\binline="true"\s*/?>')
_MENTION_RE = re.compile(
    r'<mention-page\s+url="[^"]*?([0-9a-f]{32})"\s*>(.*?)</mention-page>', re.DOTALL)
_MENTION_SELF_RE = re.compile(
    r'<mention-page\s+url="[^"]*?([0-9a-f]{32})"\s*/>')
_ANNOTATION_RE = re.compile(r"\s*\{[a-zA-Z_]+=\"[^\"]*\"(?:\s+[a-zA-Z_]+=\"[^\"]*\")*\}")
_TAG_RE = re.compile(r"</?(?:columns|column|page|properties|ancestor[^>]*)\s*[^>]*>")
_ANY_TAG_RE = re.compile(r"<[^>]+>")


def extract_db_ids(page_md: str) -> List[str]:
    """ids (32-hex) de les vistes incrustades, en ordre d'aparició."""
    ids = []
    for m in re.finditer(r'<database\s+url="[^"]*?([0-9a-f]{32})"[^>]*\binline="true"', page_md or ""):
        ids.append(m.group(1))
    return ids


def mcp_to_markdown(page_md: str) -> str:
    """Converteix el markdown de l'MCP a Markdown de Gnosi (fidelitat de clon)."""
    m = re.search(r"<content>(.*)</content>", page_md or "", re.DOTALL)
    text = m.group(1) if m else (page_md or "")

    # 1) vistes incrustades → placeholder NEUTRE (no-etiqueta) perquè el pas de neteja
    #    d'etiquetes (5) no se l'emporti; es converteix al marcador final al pas 7.
    text = _DB_RE.sub(lambda mm: f"\n§§GNOSIDB:{mm.group(1)}§§\n", text)
    text = _DB_SELFCLOSE_RE.sub(lambda mm: f"\n§§GNOSIDB:{mm.group(1)}§§\n", text)

    # 2) mencions → wikilinks
    text = _MENTION_RE.sub(
        lambda mm: f"[[{(mm.group(2).strip() or mm.group(1))}]]", text)
    text = _MENTION_SELF_RE.sub(lambda mm: f"[[{mm.group(1)}]]", text)

    # 3) columnes i altres contenidors → aplanats (es treuen les etiquetes)
    text = _TAG_RE.sub("", text)

    # 4) anotacions de color/toggle a les línies → tretes
    text = _ANNOTATION_RE.sub("", text)

    # 5) qualsevol etiqueta residual
    text = _ANY_TAG_RE.sub("", text)

    # 6) desfer indentació amb tabs (l'MCP nia amb \t) + netejar línies buides múltiples
    out_lines = []
    for ln in text.splitlines():
        out_lines.append(ln.lstrip("\t").rstrip())
    cleaned = "\n".join(out_lines)
    # 7) placeholder → marcador final de vista incrustada
    cleaned = re.sub(r"§§GNOSIDB:([0-9a-f]{32})§§",
                     lambda mm: f"<!-- gnosi-notion-db:{mm.group(1)} -->", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned
