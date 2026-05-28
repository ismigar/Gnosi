"""Mapping bidireccional entre columnes de Recursos i camps de Zotero.

Aquest mòdul **no és generat** — és coneixement de Gnosi (les nostres
columnes catalanes) lligat a la nomenclatura oficial de Zotero. Manten-lo
sincronitzat amb `_zotero_item_to_recursos` a `vault_routes.py` (la
mateixa veritat, dos usos: aquell transforma valors, aquest declara la
correspondència per a queries de rellevància).

Per què hi ha llistes (no strings) al valor de `RECURSOS_TO_ZOTERO_FIELDS`:
una columna Recursos pot ser alimentada per diferents camps Zotero segons
el tipus. P. ex. `Llibre/Revista` és:
  - `publicationTitle` en un `journalArticle`
  - `bookTitle`        en un `bookSection`
  - `proceedingsTitle` en un `conferencePaper`
  - `encyclopediaTitle` en un `encyclopediaArticle`

L'ordre dins de cada llista NO és preferent — només defineix el conjunt
de camps Zotero que poden marcar aquesta columna com a "rellevant" per
un tipus donat.
"""
from __future__ import annotations

from backend.services.zotero_schema import ITEM_TYPE_FIELDS

# Columnes canòniques de Recursos (frontmatter del Vault) → camps Zotero
# que poden alimentar-les. Si un camp Recursos no té correspondència
# Zotero (p. ex. `Citation Key` o `Notes`), no apareix aquí.
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
    'Edició':          ['edition'],
    'DOI':             ['DOI'],
    'ISBN':            ['ISBN'],
    'ISSN':            ['ISSN'],
    'URL':             ['url'],
    'Idioma':          ['language'],
}

# Invers: zoteroField → primera columna Recursos que el mencioni.
# Útil per a alta manual on volem proposar quina columna del Vault
# omplir per cada camp Zotero del schema.
ZOTERO_FIELD_TO_RECURSOS: dict[str, str] = {
    field: col
    for col, fields in RECURSOS_TO_ZOTERO_FIELDS.items()
    for field in fields
}


def is_field_relevant_for_type(recursos_field: str, zotero_item_type: str) -> bool:
    """True si la columna Recursos pot ser alimentada per qualsevol dels
    camps oficials del `zotero_item_type` donat.

    Si el tipus no existeix al schema o la columna no té correspondència
    Zotero, retorna False (mostra-la a la secció "Altres camps" al modal).
    """
    candidates = RECURSOS_TO_ZOTERO_FIELDS.get(recursos_field)
    if not candidates:
        return False
    type_fields = ITEM_TYPE_FIELDS.get(zotero_item_type, [])
    return any(c in type_fields for c in candidates)
