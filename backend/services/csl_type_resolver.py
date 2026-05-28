"""Resol el camp "Item Type" del Vault a un tipus CSL.

Aïllat de `vault_routes.py` perquè es pugui importar des de tests sense
arrossegar tots els routers FastAPI. Mirall exacte de `resolveCslType`
del frontend ([cslEngine.js]).

Ordre de resolució (primer hit guanya):
  1. Alies legacy (sinònims catalans històrics que el schema no cobreix)
  2. Clau Zotero canònica (`journalArticle`, `book`, `preprint`, ...)
  3. Label traduït a qualsevol locale (`"Article de revista acadèmica"` → ca-AD → journalArticle)
  4. Fallback `'document'`
"""
from __future__ import annotations

from backend.services.zotero_schema import (
    LABEL_TO_ZOTERO_TYPE,
    ZOTERO_TO_CSL_TYPE,
)

LEGACY_TYPE_ALIASES: dict[str, str] = {
    'Article científic': 'article-journal',
    'Article de revista': 'article-journal',
    'Article divulgatiu': 'article-magazine',
    'Tesis': 'thesis',
    'Manual': 'book',
    'Ponència': 'paper-conference',
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
