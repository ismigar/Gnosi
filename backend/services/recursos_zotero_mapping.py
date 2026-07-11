"""Bidirectional mapping between Recursos columns and Zotero fields.

This module **is not generated** — it is Gnosi domain knowledge (our
Catalan columns) tied to Zotero's official naming. Keep it in sync
with `_zotero_item_to_recursos` in `vault_routes.py` (the same source of
truth, two uses: that one transforms values, this one declares the
correspondence for relevance queries).

Why there are lists (not strings) as the value of `RECURSOS_TO_ZOTERO_FIELDS`:
a Recursos column can be fed by different Zotero fields depending on
the type. E.g. `Llibre/Revista` is:
  - `publicationTitle` in a `journalArticle`
  - `bookTitle`        in a `bookSection`
  - `proceedingsTitle` in a `conferencePaper`
  - `encyclopediaTitle` in an `encyclopediaArticle`

The order within each list is NOT preferential — it only defines the set
of Zotero fields that can mark this column as "relevant" for
a given type.
"""
from __future__ import annotations

from backend.services.zotero_schema import ITEM_TYPE_FIELDS

# Canonical Recursos columns (Vault frontmatter) → Zotero fields
# that can feed them. If a Recursos field has no
# Zotero correspondence (e.g. `Citation Key` or `Notes`), it doesn't appear here.
RECURSOS_TO_ZOTERO_FIELDS: dict[str, list[str]] = {
    'Item Type':       ['itemType'],
    'Title':           ['title'],
    'Authors':         ['creators'],
    'Any':             ['date'],
    'Llibre/Revista':  ['publicationTitle', 'bookTitle', 'proceedingsTitle', 'encyclopediaTitle'],
    'Editorial':       ['publisher'],
    'Lloc':            ['place'],
    'Volum':           ['volume'],
    'Número':          ['issue'],
    'Pàgines':         ['pages'],
    'Núm. pàgines':    ['numPages'],
    'Edició':          ['edition'],
    'DOI':             ['DOI'],
    'ISBN':            ['ISBN'],
    'ISSN':            ['ISSN'],
    'PMID':            ['PMID'],
    'URL':             ['url'],
    'Idioma':          ['language'],
}

# Inverse: zoteroField → first Recursos column that mentions it.
# Useful for manual entry where we want to suggest which Vault column
# to fill for each Zotero field in the schema.
ZOTERO_FIELD_TO_RECURSOS: dict[str, str] = {
    field: col
    for col, fields in RECURSOS_TO_ZOTERO_FIELDS.items()
    for field in fields
}


def is_field_relevant_for_type(recursos_field: str, zotero_item_type: str) -> bool:
    """True if the Recursos column can be fed by any of the
    official fields of the given `zotero_item_type`.

    If the type doesn't exist in the schema or the column has no Zotero
    correspondence, returns False (show it in the "Other fields" section in the modal).
    
    """
    candidates = RECURSOS_TO_ZOTERO_FIELDS.get(recursos_field)
    if not candidates:
        return False
    type_fields = ITEM_TYPE_FIELDS.get(zotero_item_type, [])
    return any(c in type_fields for c in candidates)
