"""Wikilinks de relació al frontmatter — helpers compartits.

Format canònic d'un ítem de camp relació (claus amb prefix 📀)::

    "[[Títol|<id>]]"

El valor és EXACTAMENT un wikilink i l'id viu a l'àlies. El títol només
aporta portabilitat (Obsidian: navegació, graf, backlinks i refresc
automàtic en renoms); l'id de l'àlies mana SEMPRE. Obsidian no reconeix
wikilinks barrejats amb text en una propietat — per això el valor és el
wikilink sencer. Vegeu docs/dev_memory/directives/relation_wikilinks_frontmatter.md.

Mòdul deliberadament lleuger (només re + typing): l'importen vault_routes,
graph_service i scripts de pipeline sense arrossegar cap dependència.
"""
from __future__ import annotations

import re
from typing import Any, Callable, Optional, Set

RELATION_KEY_PREFIX = "📀"

# Valor sencer = un únic wikilink amb àlies. L'àlies (id) no té forma
# imposada (hi ha ids llegats que no són uuid); només exclou `|` i `]`.
RELATION_WIKILINK_RE = re.compile(
    r"^\s*\[\[(?P<title>[^\]\|]*?)\s*\|\s*(?P<rid>[^\]\|]+?)\s*\]\]\s*$"
)

# Wikilink sense àlies ([[Títol]]): típic d'una edició manual a Obsidian.
TITLE_ONLY_WIKILINK_RE = re.compile(r"^\s*\[\[\s*(?P<title>[^\]\|]+?)\s*\]\]\s*$")

# Un títol amb aquests caràcters no pot viure dins d'un wikilink (trencaria
# el parseig del wikilink o la resolució a Obsidian) → es deixa l'id nu.
_UNSAFE_TITLE_RE = re.compile(r"[\[\]\|#^\r\n]")


def is_relation_key(key: Any, relation_keys: Optional[Set[str]] = None) -> bool:
    """Una clau és de relació si és al conjunt ``relation_keys`` de l'esquema
    (noms + àlies de les properties ``type=="relation"``) O, com a fallback
    retrocompatible, si duu el prefix ``📀``. Així una columna renomenada sense
    el `📀` (p.ex. ``Àrees``) se segueix reconeixent com a relació.
    Vegeu docs/dev_memory/directives/vault_relation_inverse_sync.md"""
    if not isinstance(key, str):
        return False
    if relation_keys and key in relation_keys:
        return True
    return key.startswith(RELATION_KEY_PREFIX)


def relation_keys_from_table(table: Optional[dict]) -> Set[str]:
    """Noms (i àlies) de les properties ``type=="relation"`` d'una taula del
    registry. És la font de veritat per saber quins camps són relació
    independentment del prefix `📀` (que pot no ser-hi després d'un rename)."""
    keys: Set[str] = set()
    if isinstance(table, dict):
        for p in table.get("properties") or []:
            if isinstance(p, dict) and p.get("type") == "relation":
                name = p.get("name")
                if isinstance(name, str) and name:
                    keys.add(name)
                for a in (p.get("aliases") or []):
                    if isinstance(a, str) and a:
                        keys.add(a)
    return keys


def strip_item(value: Any) -> Any:
    """``[[Títol|id]]`` → ``id``. Qualsevol altre valor, intacte."""
    if isinstance(value, str):
        m = RELATION_WIKILINK_RE.match(value)
        if m:
            return m.group("rid")
    return value


def strip_relation_wikilinks(metadata: Any, relation_keys: Optional[Set[str]] = None) -> Any:
    """Frontmatter → domini: els camps de relació tornen a ser ids nets.

    És la frontera única de LECTURA: a partir d'aquí tota l'app (taula,
    filtres, graf, automatitzacions, syncs) veu ids, mai wikilinks. ``relation_keys``
    (de l'esquema) permet reconèixer els camps encara que el nom no dugui el
    prefix `📀` (columna renomenada). Muta i retorna ``metadata``.
    """
    if not isinstance(metadata, dict):
        return metadata
    for key in metadata:
        if not is_relation_key(key, relation_keys):
            continue
        value = metadata[key]
        if isinstance(value, list):
            metadata[key] = [strip_item(v) for v in value]
        else:
            metadata[key] = strip_item(value)
    return metadata


def _decorate_item(
    value: Any,
    id_to_title: Optional[Callable[[str], Optional[str]]],
    title_to_id: Optional[Callable[[str], Optional[str]]],
) -> Any:
    if not isinstance(value, str) or not value.strip():
        return value

    decorated = RELATION_WIKILINK_RE.match(value)
    if decorated:
        rid = decorated.group("rid")
    else:
        title_only = TITLE_ONLY_WIKILINK_RE.match(value)
        if title_only:
            # Edició manual a Obsidian: canonicalitzar només si el títol
            # resol a UNA única pàgina; si no, conservar (mai inventar ids).
            rid = title_to_id(title_only.group("title")) if title_to_id else None
            if not rid:
                return value
        else:
            rid = value.strip()

    title = id_to_title(rid) if id_to_title else None
    safe = str(title or "").strip()
    if not safe or _UNSAFE_TITLE_RE.search(safe):
        # Sense títol fiable: id nu si veníem d'un id; si l'ítem ja era un
        # wikilink decorat, conservar-lo (no perdre l'últim títol bo).
        return value if decorated else rid
    return f"[[{safe}|{rid}]]"


def decorate_relation_wikilinks(
    metadata: Any,
    relation_keys: Optional[Set[str]] = None,
    id_to_title: Optional[Callable[[str], Optional[str]]] = None,
    title_to_id: Optional[Callable[[str], Optional[str]]] = None,
) -> Any:
    """Domini → frontmatter: ``id`` → ``[[Títol|id]]`` als camps relació.

    ``relation_keys`` són els noms de camp amb ``type == "relation"`` a
    l'esquema de la taula; s'hi uneixen sempre les claus amb prefix 📀
    (fallback quan no hi ha taula resolta). Idempotent i autocurativa: cada
    desada re-resol el títol ACTUAL. Si el títol no resol (índex fred),
    degrada a id nu i no bloqueja mai l'escriptura. Muta i retorna
    ``metadata``.
    """
    if not isinstance(metadata, dict):
        return metadata
    keys = set(relation_keys or ())
    for key in metadata:
        if key not in keys and not is_relation_key(key):
            continue
        value = metadata[key]
        if isinstance(value, list):
            metadata[key] = [
                _decorate_item(v, id_to_title, title_to_id) for v in value
            ]
        else:
            metadata[key] = _decorate_item(value, id_to_title, title_to_id)
    return metadata
