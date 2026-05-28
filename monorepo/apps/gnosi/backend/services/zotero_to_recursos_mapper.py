"""Mapper declaratiu Zotero item → dict de columnes Recursos.

És el motor central que abans de L3.1 vivia hardcoded dins
`vault_routes._zotero_item_to_recursos` (i en variants per a CrossRef,
OpenLibrary, arXiv, PubMed, HTML). Llegeix la taula declarativa
`RECURSOS_TO_ZOTERO_FIELDS` (mòdul `recursos_zotero_mapping`, L2) i
genera la sortida sense que el mapper conegui cap nom de camp Zotero
o columna Recursos.

Per què "declaratiu" — afegir una columna Recursos nova (amb correspondència
Zotero) requereix només afegir una entrada al mapping; aquest mòdul no
canvia. Igualment, afegir una font nova de lookup (L3.2-3) només requereix
normalitzar el seu output a un Zotero item; ja no cal escriure un nou
mapper per font.

Tres maneig especials no derivables del mapping:
  - `Authors`: el camp Zotero `creators` és una llista d'objectes
    {creatorType, lastName, firstName, name?}; cal aplanar a string
    `"Cognom, Nom; ..."` com fa Recursos.
  - `Any`: el camp Zotero `date` és string lliure (`"2024"`, `"2024-05"`,
    `"May 2024"`, `"2024-05-15"`); extraiem el primer ``\\d{4}`` com a int.
  - Forced-string: `Volum`, `Número`, `Pàgines`, `Edició` poden venir
    com a int al JSON però Recursos els guarda com a string.

L3.4 (aquest mòdul, actualitzat): camps Zotero sense correspondència
Recursos es capturen sota la clau `Zotero Extras` (dict) al frontmatter.
Així `patentNumber`, `conferenceName`, `meetingName`, `caseName`,
`versionNumber`... no es perden encara que no tinguin columna pròpia.

Camps purament tècnics de Zotero (`key`, `version`, `tags`, `dateAdded`,
`dateModified`, `relations`, `notes`, `attachments`, `collections`,
`accessDate`) NO van a `Zotero Extras` — són metadades del sistema
Zotero, no informació bibliogràfica.
"""
from __future__ import annotations

import re
from typing import Any, Callable

from backend.services.recursos_zotero_mapping import RECURSOS_TO_ZOTERO_FIELDS


# ---------- Maneig especial per columna ----------

def _handle_authors(item: dict) -> str | None:
    """`creators` (llista Zotero) → `"Cognom, Nom; ..."` (string Recursos).

    Només `creatorType=author` es considera; editors, traductors, etc.
    s'ometen (els maneja una altra capa al Vault). Acceptem creators
    amb un sol camp `name` (institucions, p.ex. `{"name": "WHO"}`).
    """
    parts: list[str] = []
    for c in item.get('creators') or []:
        if not isinstance(c, dict):
            continue
        if (c.get('creatorType') or 'author') != 'author':
            continue
        last = (c.get('lastName') or '').strip()
        first = (c.get('firstName') or '').strip()
        name = (c.get('name') or '').strip()
        if last and first:
            parts.append(f"{last}, {first}")
        elif last:
            parts.append(last)
        elif name:
            parts.append(name)
    return '; '.join(parts) if parts else None


def _handle_any(item: dict) -> int | None:
    r"""`date` Zotero (lliure) → primer `\d{4}` com a int. None si no hi és."""
    m = re.search(r'\d{4}', str(item.get('date') or ''))
    return int(m.group(0)) if m else None


_SPECIAL_HANDLERS: dict[str, Callable[[dict], Any]] = {
    'Authors': _handle_authors,
    'Any': _handle_any,
}

# Columnes Recursos els valors de les quals s'han de stringificar (poden
# venir com a int al JSON Zotero però Recursos els desa com a text).
_FORCE_STR: set[str] = {'Volum', 'Número', 'Pàgines', 'Edició'}

# Camps Zotero purament tècnics — NO van a `Zotero Extras` encara que el
# mapping declaratiu no els tradueixi. Són metadades del sistema Zotero,
# no informació bibliogràfica que un autor humà mantindria al frontmatter.
_TECHNICAL_FIELDS: set[str] = {
    'key', 'version', 'tags', 'relations', 'notes', 'attachments',
    'dateAdded', 'dateModified', 'accessDate', 'collections',
}


# ---------- Mapper públic ----------

def zotero_item_to_recursos(item: dict) -> dict[str, Any]:
    """Converteix un Zotero item canònic en dict de columnes Recursos.

    Iterem `RECURSOS_TO_ZOTERO_FIELDS`. Per a cada columna:
      1. Si hi ha handler especial (`Authors`, `Any`), l'invoquem.
      2. Si no, agafem el primer field candidat present al item amb
         valor truthy. Convertim a `str` si la columna és a `_FORCE_STR`.

    L'ordre dels candidats a `RECURSOS_TO_ZOTERO_FIELDS` defineix el
    fallback chain (p.ex. `Llibre/Revista` prova `publicationTitle` →
    `bookTitle` → `proceedingsTitle` → `encyclopediaTitle`).

    L3.4: camps Zotero no consumits per cap columna i no a `_TECHNICAL_FIELDS`
    es recullen sota `Zotero Extras` (dict) per no perdre informació de
    tipus rars (`patentNumber`, `conferenceName`, `meetingName`...).

    Retorna `{}` si `item` no és un dict.
    """
    if not isinstance(item, dict):
        return {}
    out: dict[str, Any] = {}
    # Tots els camps Zotero que aquest mapper "reclama" — els seus chains
    # de candidats al mapping declaratiu, fins i tot si el item només
    # porta un dels candidats. Així `bookTitle` i `publicationTitle` no
    # apareixen tots dos a Extras quan només un d'ells alimenta `Llibre/Revista`.
    consumed_fields: set[str] = set()
    for col, candidates in RECURSOS_TO_ZOTERO_FIELDS.items():
        consumed_fields.update(candidates)
        handler = _SPECIAL_HANDLERS.get(col)
        if handler is not None:
            v = handler(item)
            if v is not None and v != '':
                out[col] = v
            continue
        for field in candidates:
            v = item.get(field)
            if v:
                out[col] = str(v) if col in _FORCE_STR else v
                break

    # Extras: tot camp truthy del item que no s'ha consumit i no és tècnic.
    extras: dict[str, Any] = {}
    for k, v in item.items():
        if not v:
            continue
        if k in consumed_fields or k in _TECHNICAL_FIELDS:
            continue
        extras[k] = v
    if extras:
        out['Zotero Extras'] = extras
    return out
