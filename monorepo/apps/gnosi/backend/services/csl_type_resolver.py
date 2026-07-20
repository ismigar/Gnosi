"""Resolves the Vault's "Item Type" field to a CSL type.

Isolated from `vault_routes.py` so it can be imported from tests without
dragging in all the FastAPI routers. Exact mirror of `resolveCslType`
from the frontend ([cslEngine.js]).

Resolution order (first hit wins):
  1. Legacy alias (historical Catalan synonyms not covered by the schema)
  2. Canonical Zotero key (`journalArticle`, `book`, `preprint`, ...)
  3. Label translated in any locale (`"Article de revista acadèmica"` → ca-AD → journalArticle)
  4. Fallback `'document'`
"""
from __future__ import annotations

from backend.services.zotero_schema import (
    LABEL_TO_ZOTERO_TYPE,
    ZOTERO_TO_CSL_TYPE,
)

# EXACT MIRROR of `LEGACY_TYPE_ALIASES` in `cslEngine.js`. If they diverge, a
# page with a legacy type gets cited with a different CSL type on the frontend (live,
# via citeproc-js) and on the backend (reference export). It was out of sync:
# 'Vídeo'→motion_picture and 'Entrevista/testimoni'→interview were missing (and the
# no-op to 'document'), so these types were being exported as
# generic 'document' while the frontend cited them correctly.
LEGACY_TYPE_ALIASES: dict[str, str] = {
    'Article científic': 'article-journal',
    'Article de revista': 'article-journal',
    'Article divulgatiu': 'article-magazine',
    'Tesis': 'thesis',
    'Manual': 'book',
    # Legacy spelling of the canonical "Capítol d'un llibre" label. Without it a
    # book chapter resolved to 'document' and APA dropped the whole
    # "In <Editor> (Ed.), <Book title> (pp. x–y)" container.
    'Secció de Llibre': 'chapter',
    'Ponència': 'paper-conference',
    'Curs': 'document',
    'Relat': 'document',
    'Document': 'document',
    'Vídeo': 'motion_picture',
    'Entrevista/testimoni': 'interview',
}


# Same legacy synonyms, resolved to the canonical ZOTERO key instead of the CSL
# type. Needed by the BibTeX/RIS export maps in `references_io`, which are keyed
# by Zotero keys. Every entry must satisfy
# `ZOTERO_TO_CSL_TYPE[LEGACY_TYPE_TO_ZOTERO[k]] == LEGACY_TYPE_ALIASES[k]`
# (covered by a unit test), so the two tables cannot drift apart.
LEGACY_TYPE_TO_ZOTERO: dict[str, str] = {
    'Article científic': 'journalArticle',
    'Article de revista': 'journalArticle',
    'Article divulgatiu': 'magazineArticle',
    'Tesis': 'thesis',
    'Manual': 'book',
    'Secció de Llibre': 'bookSection',
    'Ponència': 'conferencePaper',
    'Curs': 'document',
    'Relat': 'document',
    'Document': 'document',
    'Vídeo': 'videoRecording',
    'Entrevista/testimoni': 'interview',
}


def resolve_csl_type(raw: str) -> str:
    if not raw or not isinstance(raw, str):
        return 'document'
    if raw in LEGACY_TYPE_ALIASES:
        return LEGACY_TYPE_ALIASES[raw]
    if raw in ZOTERO_TO_CSL_TYPE:
        return ZOTERO_TO_CSL_TYPE[raw]
    for loc_labels in LABEL_TO_ZOTERO_TYPE.values():
        zot = loc_labels.get(raw)
        if zot and zot in ZOTERO_TO_CSL_TYPE:
            return ZOTERO_TO_CSL_TYPE[zot]
    return 'document'


def resolve_zotero_item_type(raw: str) -> str:
    """`Item Type` (canonical Zotero key, legacy synonym or translated label)
    → canonical Zotero key.

    The BibTeX/RIS export tables in `references_io` are keyed by Zotero keys,
    but the vault mostly stores translated labels ('Llibre', 'Article de
    revista acadèmica'); only records that came IN through a BibTeX/RIS import
    hold canonical keys. Resolving nothing meant every native record exported
    as `@misc` / `TY - GEN`. Same resolution order as `resolve_csl_type`."""
    if not raw or not isinstance(raw, str):
        return 'document'
    if raw in LEGACY_TYPE_TO_ZOTERO:
        return LEGACY_TYPE_TO_ZOTERO[raw]
    if raw in ZOTERO_TO_CSL_TYPE:
        return raw
    for loc_labels in LABEL_TO_ZOTERO_TYPE.values():
        zot = loc_labels.get(raw)
        if zot and zot in ZOTERO_TO_CSL_TYPE:
            return zot
    return 'document'
