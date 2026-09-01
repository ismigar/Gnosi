"""
Field resolution by immutable ID or name (compatibility layer).

Each property of a registry table has an immutable 'id' with the format
'fld_xxxxxxxx'. This module offers helpers to read/write page metadata
independently of the name (which can change).

Conventions:
- A "ref" can be an id ('fld_*') or a field name (any string).
- When reading metadata, if the ID key is present we prioritize it; otherwise, fall back to the name.

PERSISTENCE BY NAME (2026-05): the `.md` file and API responses store keys
by the field's **current name**, never by `fld_*` (which is opaque to a human). The id
still exists in the schema (registry) as a reference for views/filters. For
robustness against column renames, each property can have `aliases` (old
names): the resolver matches by id, current name, or alias, and `to_storage_names` /
`to_response_names` always rewrite to the current name. See the
`docs/dev_memory/directives/vault_persist_by_name.md` directive.
"""

from typing import TypeAlias

from backend.domains.vault.registry.records import is_record
from backend.domains.vault.registry.state import RegistryData
from backend.utils.open_values import contains_value, iterable_values

Metadata: TypeAlias = RegistryData
TableSchema: TypeAlias = RegistryData
PropertySchema: TypeAlias = RegistryData


def _properties(table: TableSchema) -> list[PropertySchema]:
    raw = table.get("properties", []) or []
    if not isinstance(raw, list):
        return []
    return [prop for prop in raw if is_record(prop)]


def is_field_id(value: object) -> bool:
    return isinstance(value, str) and value.startswith("fld_") and len(value) == 12


def get_property_by_id(table: TableSchema, field_id: str) -> PropertySchema | None:
    if not table or not field_id:
        return None
    for p in _properties(table):
        if p.get("id") == field_id:
            return p
    return None


def get_property_by_name(table: TableSchema, name: str) -> PropertySchema | None:
    """Matches by CURRENT name first; otherwise, by alias (old name)."""
    if not table or not name:
        return None
    props = _properties(table)
    for p in props:
        if p.get("name") == name:
            return p
    # Fallback: old name saved as an alias.
    for p in props:
        if contains_value(p.get("aliases") or [], name):
            return p
    return None


def resolve_property(table: TableSchema, ref: str) -> PropertySchema | None:
    """Resolves a ref (id, current name, or alias) to the full property."""
    if not ref:
        return None
    if is_field_id(ref):
        return get_property_by_id(table, ref)
    return get_property_by_name(table, ref)


def resolve_ref(table: TableSchema, ref: str) -> tuple[str | None, str | None]:
    """Returns (id, name) for a given ref."""
    prop = resolve_property(table, ref)
    if not prop:
        # It doesn't exist; we keep the ref in the field where it would make sense
        if is_field_id(ref):
            return ref, None
        return None, ref
    field_id = prop.get("id")
    name = prop.get("name")
    return (
        field_id if isinstance(field_id, str) else None,
        name if isinstance(name, str) else None,
    )


def get_meta_value(metadata: Metadata, table: TableSchema, ref: str) -> object:
    """Reads metadata by ref (id or name). Prioritizes id, falls back to name."""
    if not metadata:
        return None
    fid, fname = resolve_ref(table, ref)
    if fid and fid in metadata:
        return metadata[fid]
    if fname and fname in metadata:
        return metadata[fname]
    return None


def set_meta_value(
    metadata: Metadata,
    table: TableSchema,
    ref: str,
    value: object,
) -> Metadata:
    """
        Writes metadata using id as the key whenever possible.
    Removes the name-key if it was still present (lazy migration).
    Mutates and returns metadata.

    """
    if metadata is None:
        metadata = {}
    fid, fname = resolve_ref(table, ref)
    if fid:
        metadata[fid] = value
        if fname and fname != fid and fname in metadata:
            del metadata[fname]
    elif fname:
        metadata[fname] = value
    return metadata


def expand_metadata_for_response(metadata: Metadata, table: TableSchema) -> Metadata:
    """
        For API responses: if a key is a field_id and the corresponding property
    exists in the schema, also add an entry with the current name
    (without removing the id). This way the old frontend (which reads by name)
    keeps working during the migration.
    Returns a new dict (does not mutate).

    """
    if not metadata or not table:
        return dict(metadata or {})
    properties = _properties(table)
    id_to_name = {p["id"]: p["name"] for p in properties if p.get("id") and p.get("name")}
    out = dict(metadata)
    for k, v in metadata.items():
        if is_field_id(k) and k in id_to_name:
            name = id_to_name[k]
            if name not in out:
                out[name] = v
    return out


def migrate_metadata_keys(metadata: Metadata, table: TableSchema) -> tuple[Metadata, int]:
    """
        Rewrites all name → id keys whenever we find a match in the schema.
    Returns (migrated_metadata, number_of_migrated_keys).
    Does not touch keys that are already IDs or unknown keys (not in the schema).

    """
    if not metadata or not table:
        return metadata or {}, 0
    properties = _properties(table)
    name_to_id = {p["name"]: p["id"] for p in properties if p.get("id") and p.get("name")}
    migrated = 0
    new_meta: Metadata = {}
    for k, v in metadata.items():
        if k in name_to_id:
            new_meta[name_to_id[k]] = v
            migrated += 1
        else:
            new_meta[k] = v
    return new_meta, migrated


# Provenance priority when several keys point to the same column.
_PRIO_CURRENT_NAME = 0
_PRIO_FIELD_ID = 1
_PRIO_ALIAS = 2


def to_storage_names(metadata: object, table: TableSchema) -> tuple[Metadata, bool]:
    """Rewrites ALL resolvable keys to the column's **current name**.

    This is the canonical WRITE boundary (disk) and response boundary: it guarantees that a
    `fld_*` or an old name (alias) is never persisted. Keys that don't resolve to
    any property (genuine local properties) are kept intact.

    Conflict (several keys → same column): priority order is
    current name > id > alias.

    Returns (new_metadata, has_changed). Does not mutate the input.
    """
    if not is_record(metadata) or not metadata or not table:
        return (dict(metadata) if is_record(metadata) else {}), False

    props = _properties(table)
    name_set = {name for p in props if isinstance((name := p.get("name")), str) and name}
    id_to_name: dict[object, str] = {
        field_id: name
        for p in props
        if isinstance((field_id := p.get("id")), str)
        and field_id
        and isinstance((name := p.get("name")), str)
        and name
    }
    alias_to_name: dict[object, str] = {}
    for p in props:
        cname = p.get("name")
        for a in iterable_values(p.get("aliases") or []):
            if (
                isinstance(cname, str)
                and isinstance(a, str)
                and a
                and a != cname
                and a not in name_set
            ):
                alias_to_name[a] = cname

    chosen: dict[object, tuple[int, object]] = {}  # current_name -> (priority, value)
    passthrough: Metadata = {}  # unresolvable keys (real locals)
    order: list[tuple[str, object]] = []  # order of first appearance

    def consider(cname: object, prio: int, value: object) -> None:
        if cname not in chosen:
            order.append(("col", cname))
            chosen[cname] = (prio, value)
        elif prio < chosen[cname][0]:
            chosen[cname] = (prio, value)

    for k, v in metadata.items():
        if k in name_set:
            consider(k, _PRIO_CURRENT_NAME, v)
        elif k in id_to_name:
            consider(id_to_name[k], _PRIO_FIELD_ID, v)
        elif k in alias_to_name:
            consider(alias_to_name[k], _PRIO_ALIAS, v)
        elif k not in passthrough:
            order.append(("raw", k))
            passthrough[k] = v

    out: Metadata = {}
    for kind, key in order:
        out[key] = chosen[key][1] if kind == "col" else passthrough[key]

    changed = list(out.items()) != list(metadata.items())
    return out, changed


def to_response_names(metadata: object, table: TableSchema) -> Metadata:
    """Version for API responses: keys resolved to the current name, without `fld_*`
    or aliases. Does not mutate. Replaces `expand_metadata_for_response`."""
    out, _ = to_storage_names(metadata, table)
    return out
