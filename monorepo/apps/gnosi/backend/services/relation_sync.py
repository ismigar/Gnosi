"""Bidirectional relation sync — pure logic.

When a page changes a relation field (e.g. an Àrea adds a resource to
`Recursos`), the INVERSE field on the page on the other side (`Àrees` on the
resource) must update, or the embedded views —which filter by the inverse—
come out empty. The backend didn't do this (`PATCH` = `metadata.update`).

This module does NOT touch the filesystem: it only calculates WHAT needs to be
propagated. The I/O side (reading/writing the target pages) lives in `vault_routes.py`.

Direct↔inverse pairing: **by target table** (`relation_database_id`); there is
no `related_property_id`. It is ALWAYS saved by field name as it lives in the
frontmatter. It is **normalized** (lowercase, no spaces/decorative prefixes)
to match the frontmatter key with the property name in the registry. See
docs/dev_memory/directives/vault_relation_inverse_sync.md

Lightweight module (re + typing): importable from vault_routes and scripts
without pulling in dependencies.
"""
from __future__ import annotations

import re
from typing import Any, Callable, Dict, List, Optional, Tuple

# Relation item in the frontmatter: `[[Title|id]]` (the id lives in the alias) or a bare id.
_WIKILINK_RE = re.compile(r"^\s*\[\[[^\]\|]*\|\s*(?P<rid>[^\]\|]+?)\s*\]\]\s*$")


def _norm(name: Any) -> str:
    """Normalizes a field name: strips leading non-alphanumeric prefixes and
    spaces, and lowercases it. Robust against formatting variations."""
    return re.sub(r"^[^\w]+", "", str(name or ""), flags=re.UNICODE).strip().lower()


def to_ids(value: Any) -> List[str]:
    """Relation field value → list of clean ids (accepts ids or `[[T|id]]`)."""
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
    """`(target_table_id, inverse_field_name)` for the `frontmatter_key` field of
    `origin_table`, or `None` if it's ambiguous/unknown.

    Ambiguous (and therefore NOT propagated) if:
    - the key doesn't match exactly 1 relation property of the origin,
    - the target is the same table (self-relation),
    - the origin has >1 field pointing to the same target (it isn't clear which inverse
      applies: e.g. Àrees has `Experiència professional` and `Titulacions` → same table),
    - the target doesn't have exactly 1 field pointing to the origin.
    
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
    """List of `(target_id, inverse_field_name, op)` to apply on the other side.
    `op` ∈ {"add", "remove"}. Compares the relation fields of `old_meta` and `new_meta`.
    
    """
    old_meta = old_meta or {}
    new_meta = new_meta or {}
    # Normalized names of the schema's relation fields (name + aliases): the
    # single source for recognizing a relation field, whatever its name.
    rel_norms = set()
    for p in _relations(origin_table):
        rel_norms.add(_norm(p.get("name")))
        for a in (p.get("aliases") or []):
            rel_norms.add(_norm(a))
    keys = {
        k for k in (*old_meta.keys(), *new_meta.keys())
        if isinstance(k, str) and _norm(k) in rel_norms
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
