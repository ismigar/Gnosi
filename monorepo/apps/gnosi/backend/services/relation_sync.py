"""Sincronització bidireccional de relacions — lògica pura.

Quan una pàgina canvia un camp de relació (p.ex. una Àrea afegeix un recurs a
`📀 Recursos`), el camp INVERS de la pàgina de l'altre costat (`📀 Àrees` al
recurs) ha d'actualitzar-se, o les vistes incrustades —que filtren per l'invers—
surten buides. El backend no ho feia (`PATCH` = `metadata.update`).

Aquest mòdul NO toca el filesystem: només calcula QUÈ s'ha de propagar. El
costat d'I/O (llegir/escriure les pàgines destí) viu a `vault_routes.py`.

Aparellament directe↔invers: **per taula destí** (`relation_database_id`); no hi
ha `related_property_id`. Es desa SEMPRE per nom de camp tal com viu al
frontmatter. Atenció: la taula Àrees té els noms al registry SENSE prefix
(`Recursos`) mentre el frontmatter/resposta porta `📀 Recursos` → cal
**normalitzar** per casar la clau amb la property. Vegeu
docs/dev_memory/directives/vault_relation_inverse_sync.md

Mòdul lleuger (re + typing): importable des de vault_routes i scripts sense
arrossegar dependències.
"""
from __future__ import annotations

import re
from typing import Any, Callable, Dict, List, Optional, Tuple

RELATION_KEY_PREFIX = "📀"

# Ítem de relació al frontmatter: `[[Títol|id]]` (l'id viu a l'àlies) o id nu.
_WIKILINK_RE = re.compile(r"^\s*\[\[[^\]\|]*\|\s*(?P<rid>[^\]\|]+?)\s*\]\]\s*$")


def _norm(name: Any) -> str:
    """Treu emojis/espais/prefixos inicials i passa a minúscules. Casa el nom
    de l'esquema (`Recursos`) amb el de frontmatter (`📀 Recursos`)."""
    return re.sub(r"^[^\w]+", "", str(name or ""), flags=re.UNICODE).strip().lower()


def is_relation_key(key: Any) -> bool:
    return isinstance(key, str) and key.startswith(RELATION_KEY_PREFIX)


def to_ids(value: Any) -> List[str]:
    """Valor d'un camp relació → llista d'ids nets (accepta ids o `[[T|id]]`)."""
    if value is None:
        return []
    items = value if isinstance(value, list) else [value]
    out: List[str] = []
    for v in items:
        if not isinstance(v, str):
            continue
        s = v.strip()
        if not s:
            continue
        m = _WIKILINK_RE.match(s)
        out.append(m.group("rid").strip() if m else s)
    return out


def _relations(table: Optional[Dict]) -> List[Dict]:
    if not table:
        return []
    return [p for p in (table.get("properties") or []) if p.get("type") == "relation"]


def resolve_inverse_relation(
    origin_table: Optional[Dict],
    frontmatter_key: str,
    get_table: Callable[[str], Optional[Dict]],
) -> Optional[Tuple[str, str]]:
    """`(taula_destí_id, nom_camp_invers)` per al camp `frontmatter_key` de
    `origin_table`, o `None` si és ambigu/desconegut.

    Ambigu (i per tant NO es propaga) si:
    - la clau no casa amb exactament 1 property relació de l'origen,
    - la destí és la mateixa taula (auto-relació),
    - l'origen té >1 camp cap a la mateixa destí (no se sap quin invers toca:
      p.ex. Àrees té `Experiència professional` i `Titulacions` → mateixa taula),
    - la destí no té exactament 1 camp cap a l'origen.
    """
    if not origin_table:
        return None
    nk = _norm(frontmatter_key)
    cands = [p for p in _relations(origin_table) if _norm(p.get("name")) == nk]
    if len(cands) != 1:
        return None
    dest = cands[0].get("relation_database_id")
    oid = origin_table.get("id")
    if not dest or dest == oid:
        return None
    if len([p for p in _relations(origin_table)
            if p.get("relation_database_id") == dest]) != 1:
        return None
    dtable = get_table(dest)
    inv = [q for q in _relations(dtable) if q.get("relation_database_id") == oid]
    if len(inv) != 1:
        return None
    return dest, inv[0].get("name")


def relation_changes(
    old_meta: Optional[Dict],
    new_meta: Optional[Dict],
    origin_table: Optional[Dict],
    get_table: Callable[[str], Optional[Dict]],
) -> List[Tuple[str, str, str]]:
    """Llista de `(target_id, nom_camp_invers, op)` a aplicar a l'altre costat.
    `op` ∈ {"add", "remove"}. Compara els camps relació de `old_meta` i `new_meta`.
    """
    old_meta = old_meta or {}
    new_meta = new_meta or {}
    # Noms normalitzats dels camps de relació de l'esquema (nom + àlies): permet
    # reconèixer un camp encara que el nom no dugui el prefix `📀` (renomenat).
    rel_norms = set()
    for p in _relations(origin_table):
        rel_norms.add(_norm(p.get("name")))
        for a in (p.get("aliases") or []):
            rel_norms.add(_norm(a))
    keys = {
        k for k in (*old_meta.keys(), *new_meta.keys())
        if isinstance(k, str) and (is_relation_key(k) or _norm(k) in rel_norms)
    }
    out: List[Tuple[str, str, str]] = []
    for key in keys:
        pair = resolve_inverse_relation(origin_table, key, get_table)
        if not pair:
            continue
        _dest, inv = pair
        old_ids = set(to_ids(old_meta.get(key)))
        new_ids = set(to_ids(new_meta.get(key)))
        for tid in (new_ids - old_ids):
            out.append((tid, inv, "add"))
        for tid in (old_ids - new_ids):
            out.append((tid, inv, "remove"))
    return out
