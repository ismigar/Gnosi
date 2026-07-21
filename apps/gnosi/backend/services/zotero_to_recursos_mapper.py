"""Declarative Zotero item → Recursos columns dict mapper.

It's the central engine that before L3.1 lived hardcoded inside
`vault_routes._zotero_item_to_recursos` (and in variants for CrossRef,
OpenLibrary, arXiv, PubMed, HTML). It reads the declarative table
`RECURSOS_TO_ZOTERO_FIELDS` (module `recursos_zotero_mapping`, L2) and
generates the output without the mapper knowing any Zotero field name
or Recursos column.

Why "declarative" — adding a new Recursos column (with a Zotero
correspondence) requires only adding an entry to the mapping; this module doesn't
change. Likewise, adding a new lookup source (L3.2-3) only requires
normalizing its output to a Zotero item; there's no longer a need to write a new
mapper per source.

Three special cases not derivable from the mapping:
  - `Authors`: the Zotero `creators` field is a list of objects
    {creatorType, lastName, firstName, name?}; it needs flattening to the string
    `"Lastname, Firstname; ..."` the way Recursos does.
  - `Any`: the Zotero `date` field is a free string (`"2024"`, `"2024-05"`,
    `"May 2024"`, `"2024-05-15"`); we extract the first ``\\d{4}`` as an int.
  - Forced-string: `Volum`, `Número`, `Pàgines`, `Edició` may come
    as int in the JSON but Recursos stores them as string.

L3.4 (this module, updated): Zotero fields with no Recursos
correspondence are captured under the `Zotero Extras` key (dict) in the frontmatter.
This way `patentNumber`, `conferenceName`, `meetingName`, `caseName`,
`versionNumber`... are not lost even though they don't have their own column.

Purely technical Zotero fields (`key`, `version`, `tags`, `dateAdded`,
`dateModified`, `relations`, `notes`, `attachments`, `collections`,
`accessDate`) do NOT go to `Zotero Extras` — they are Zotero system
metadata, not bibliographic information.
"""
from __future__ import annotations

import re
from typing import Any, Callable

from backend.services.recursos_zotero_mapping import RECURSOS_TO_ZOTERO_FIELDS


# ---------- Special handling per column ----------

def _handle_authors(item: dict) -> str | None:
    """`creators` (Zotero list) → `"Lastname, Firstname; ..."` (Recursos string).

    Only `creatorType=author` is considered; editors, translators, etc.
    are omitted (another layer in the Vault handles them). We accept creators
    with a single `name` field (institutions, e.g. `{"name": "WHO"}`).
    
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
    r"""Zotero `date` (free-form) → first `\d{4}` as int. None if there isn't one."""
    m = re.search(r'\d{4}', str(item.get('date') or ''))
    return int(m.group(0)) if m else None


_SPECIAL_HANDLERS: dict[str, Callable[[dict], Any]] = {
    'Authors': _handle_authors,
    'Any': _handle_any,
}

# Recursos columns whose values must be stringified (they can
# come as int in the Zotero JSON but Recursos stores them as text).
_FORCE_STR: set[str] = {'Volum', 'Número', 'Pàgines', 'Edició'}

# Purely technical Zotero fields — do NOT go into `Zotero Extras` even if the
# declarative mapping doesn't translate them. They are Zotero system metadata,
# not bibliographic information that a human author would maintain in the frontmatter.
_TECHNICAL_FIELDS: set[str] = {
    'key', 'version', 'tags', 'relations', 'notes', 'attachments',
    'dateAdded', 'dateModified', 'accessDate', 'collections',
}


# ---------- Public mapper ----------

def zotero_item_to_recursos(item: dict) -> dict[str, Any]:
    """Converts a canonical Zotero item into a Resources columns dict.

    We iterate over `RECURSOS_TO_ZOTERO_FIELDS`. For each column:
      1. If there is a special handler (`Authors`, `Any`), we invoke it.
      2. Otherwise, we take the first candidate field present in the item with
         a truthy value. Convert to `str` if the column is in `_FORCE_STR`.

    The order of candidates in `RECURSOS_TO_ZOTERO_FIELDS` defines the
    fallback chain (e.g. `Llibre/Revista` tries `publicationTitle` →
    `bookTitle` → `proceedingsTitle` → `encyclopediaTitle`).

    L3.4: Zotero fields not consumed by any column and not in `_TECHNICAL_FIELDS`
    are collected under `Zotero Extras` (dict) so as not to lose information about
    rare types (`patentNumber`, `conferenceName`, `meetingName`...).

    Returns `{}` if `item` is not a dict.
    
    """
    if not isinstance(item, dict):
        return {}
    out: dict[str, Any] = {}
    # All the Zotero fields that this mapper "claims" — their chains
    # of candidates in the declarative mapping, even if the item only
    # carries one of the candidates. This way `bookTitle` and `publicationTitle` don't
    # both appear in Extras when only one of them feeds `Llibre/Revista`.
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

    # Extras: every truthy field from the item that hasn't been consumed and isn't technical.
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
