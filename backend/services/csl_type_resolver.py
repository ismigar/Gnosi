"""Resolves the Vault's "Item Type" field across its value spaces.

Isolated from `vault_routes.py` so it can be imported from tests without
dragging in all the FastAPI routers.

The field historically mixes TWO value spaces: translated select labels
(`'Llibre'`, `'Article de revista acadèmica'`) written by hand, and canonical
Zotero keys (`'book'`, `'journalArticle'`) produced by the import pipelines.
This module is the single brain for both directions:

  * `resolve_csl_type`  — any value → CSL type (citations). Exact mirror of
    `resolveCslType` from the frontend ([cslEngine.js]).
  * `resolve_zotero_type` — any value → canonical Zotero key, None when
    unrecognized (catalog matching). Mirror of `resolveZoteroType` from
    [MetadataLookupModal.jsx], extended with the legacy aliases.
  * `resolve_zotero_item_type` — total variant of the former ('document' for
    unrecognized values); what the BibTeX/RIS export maps consume.
  * `normalize_item_type` — canonical key → the label the table's select
    catalog uses. Write-space normalization: every registration path persists
    the catalog label, so grouping/filtering never splits `'Llibre'` vs
    `'book'`. The catalog is the authority for which label represents a type.

Resolution order (first hit wins, same for the three functions):
  1. Legacy alias (historical Catalan synonyms not covered by the schema)
  2. Canonical Zotero key (`journalArticle`, `book`, `preprint`, ...)
  3. Label translated in any locale (`"Article de revista acadèmica"` → ca-AD → journalArticle)
  4. Fallback (`'document'` for CSL, `None` for the Zotero key)
"""

from __future__ import annotations

from typing import Optional

from backend.services.zotero_schema import (
    ALL_ITEM_TYPES,
    LABEL_TO_ZOTERO_TYPE,
    ZOTERO_TO_CSL_TYPE,
    ZOTERO_TYPE_LABELS,
)

# EXACT MIRROR of `LEGACY_TYPE_ALIASES` in `cslEngine.js`. If they diverge, a
# page with a legacy type gets cited with a different CSL type on the frontend (live,
# via citeproc-js) and on the backend (reference export). It was out of sync:
# 'Vídeo'→motion_picture and 'Entrevista/testimoni'→interview were missing (and the
# no-op to 'document'), so these types were being exported as
# generic 'document' while the frontend cited them correctly.
LEGACY_TYPE_ALIASES: dict[str, str] = {
    "Article científic": "article-journal",
    "Article de revista": "article-journal",
    "Article divulgatiu": "article-magazine",
    "Tesis": "thesis",
    "Manual": "book",
    # Legacy spelling of the canonical "Capítol d'un llibre" label. Without it a
    # book chapter resolved to 'document' and APA dropped the whole
    # "In <Editor> (Ed.), <Book title> (pp. x–y)" container.
    "Secció de Llibre": "chapter",
    "Ponència": "paper-conference",
    "Curs": "document",
    "Relat": "document",
    "Document": "document",
    "Vídeo": "motion_picture",
    "Entrevista/testimoni": "interview",
}


# Same legacy synonyms, resolved to the canonical ZOTERO key instead of the CSL
# The canonical-type table uses the SAME keys as `LEGACY_TYPE_ALIASES`, and
# every entry must satisfy
# `ZOTERO_TO_CSL_TYPE[LEGACY_TYPE_TO_ZOTERO[k]] == LEGACY_TYPE_ALIASES[k]`
# (invariant enforced by test_item_type_normalization.py) — if the two tables
# drift, a legacy value would be cited with one type and exported/normalized
# with another. Note 'Article de revista': its legacy meaning (journalArticle)
# differs from the canonical ca-AD label (magazineArticle); legacy wins here
# exactly like it wins in `resolve_csl_type`.
LEGACY_TYPE_TO_ZOTERO: dict[str, str] = {
    "Article científic": "journalArticle",
    "Article de revista": "journalArticle",
    "Article divulgatiu": "magazineArticle",
    "Tesis": "thesis",
    "Manual": "book",
    "Secció de Llibre": "bookSection",
    "Ponència": "conferencePaper",
    "Curs": "document",
    "Relat": "document",
    "Document": "document",
    "Vídeo": "videoRecording",
    "Entrevista/testimoni": "interview",
}


def resolve_csl_type(raw: object) -> str:
    if not raw or not isinstance(raw, str):
        return "document"
    if raw in LEGACY_TYPE_ALIASES:
        return LEGACY_TYPE_ALIASES[raw]
    if raw in ZOTERO_TO_CSL_TYPE:
        return ZOTERO_TO_CSL_TYPE[raw]
    for loc_labels in LABEL_TO_ZOTERO_TYPE.values():
        zot = loc_labels.get(raw)
        if zot and zot in ZOTERO_TO_CSL_TYPE:
            return ZOTERO_TO_CSL_TYPE[zot]
    return "document"


def resolve_zotero_item_type(raw: str) -> str:
    """`Item Type` (canonical Zotero key, legacy synonym or translated label)
    → canonical Zotero key, `'document'` when unrecognized.

    The BibTeX/RIS export tables in `references_io` are keyed by Zotero keys,
    but the vault stores translated labels ('Llibre', 'Article de revista
    acadèmica'); resolving nothing meant every native record exported as
    `@misc` / `TY - GEN`. Thin wrapper over `resolve_zotero_type` for callers
    that need a total function (custom types degrade to 'document')."""
    return resolve_zotero_type(raw) or "document"


def resolve_zotero_type(raw: object) -> Optional[str]:
    """Canonical Zotero item-type key for a raw "Item Type" value, or None.

    Accepts the two spaces the field has historically mixed — canonical keys
    (`'journalArticle'`) and translated labels (`'Article de revista
    acadèmica'`) — plus the legacy Catalan synonyms. Precedence mirrors
    `resolve_csl_type` (legacy aliases first) so a value is exported and
    normalized with the same meaning it is cited with.

    """
    if not raw or not isinstance(raw, str):
        return None
    if raw in LEGACY_TYPE_TO_ZOTERO:
        return LEGACY_TYPE_TO_ZOTERO[raw]
    # ALL_ITEM_TYPES, not ZOTERO_TO_CSL_TYPE: 'annotation' is a valid key with
    # no CSL mapping (not citable) and must still resolve as itself here.
    if raw in ALL_ITEM_TYPES:
        return raw
    for loc_labels in LABEL_TO_ZOTERO_TYPE.values():
        zot = loc_labels.get(raw)
        if zot:
            return zot
    return None


def _infer_catalog_locale(catalog: list[str]) -> Optional[str]:
    """Locale whose canonical labels cover the most catalog options.

    Majority vote over the option names; en-US (Zotero's base locale) wins
    ties, the rest follow alphabetically. None when no option matches any
    locale (empty or fully custom catalog).

    """
    best, best_votes = None, 0
    for locale in sorted(LABEL_TO_ZOTERO_TYPE, key=lambda loc: (loc != "en-US", loc)):
        votes = sum(1 for name in catalog if name in LABEL_TO_ZOTERO_TYPE[locale])
        if votes > best_votes:
            best, best_votes = locale, votes
    return best


def normalize_item_type(value: str, catalog: Optional[list[str]] = None) -> str:
    """An "Item Type" value → the label the table's select catalog uses.

    Write-space normalization: the import pipelines produce canonical Zotero
    keys, but the select catalog (and the 277-record history) speaks translated
    labels — persisting the key would split grouping/filtering into two spaces
    (`'Llibre'` vs `'book'`). The catalog is the authority:

      1. `value` → canonical key. Unrecognized values (custom types like
         `'Ruta en bici'`) are returned unchanged — they are the user's business.
      2. First catalog option denoting that key, ranked: canonical label in the
         catalog's inferred locale > canonical label in another locale > legacy
         alias. Ties keep catalog order. (The real catalog holds e.g. both
         'Tesi' and 'Tesis' for thesis: the canonical ca-AD 'Tesi' wins.)
      3. No catalog option for the key: a bare key is translated to the
         inferred locale's label (`'preprint'` → `'Prepublicació'` in a Catalan
         catalog), falling back to en-US. A value that is already a label is
         kept as-is — without catalog evidence there is no reason to move it
         between locales.

    Idempotent: normalizing an already-normalized value is a no-op.

    """
    if not value or not isinstance(value, str):
        return value
    key = resolve_zotero_type(value)
    if not key:
        return value
    catalog = [name for name in (catalog or []) if isinstance(name, str)]
    locale = _infer_catalog_locale(catalog)
    matches = [name for name in catalog if resolve_zotero_type(name) == key]
    if matches:

        def rank(name: str) -> int:
            if locale and LABEL_TO_ZOTERO_TYPE[locale].get(name) == key:
                return 0
            if any(labels.get(name) == key for labels in LABEL_TO_ZOTERO_TYPE.values()):
                return 1
            return 2

        return min(matches, key=rank)  # min() is stable: catalog order breaks ties
    if value != key:
        return value
    for loc in ([locale] if locale else []) + ["en-US"]:
        label = ZOTERO_TYPE_LABELS.get(loc, {}).get(key)
        if label:
            return label
    return value
