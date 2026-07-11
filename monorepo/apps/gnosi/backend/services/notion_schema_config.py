"""Notion schema conversion ↔ SchemaConfigModal format (configurable import/clone).

Gnosi's modal (`SchemaConfigModal`) works with the shape `{camp: tipus, camp_config: {...}}`.
The importer produces `properties: [{name, type, options, relation_database_id, ...}]`. These
helpers convert in both directions so the user can configure the schema of each DB
with the fields form they already know (including `storage_folder` for file fields).

PURE → testable without a backend. cf. directive `notion_import_configurable_schema.md`.
"""
from __future__ import annotations

from typing import Any, Dict, List

ASSET_TYPES = {"files", "file", "image", "images"}


def notion_props_to_modal_schema(properties: List[Dict[str, Any]]) -> Dict[str, Any]:
    """`properties` (from map_database_schema) → SchemaConfigModal shape `{nom:tipus, nom_config}`.

    File fields get `storage_folder: "assets"` by default (the user can change it).
    
    """
    out: Dict[str, Any] = {}
    for p in properties or []:
        name = p.get("name")
        if not name:
            continue
        t = p.get("type") or "text"
        out[name] = t
        cfg: Dict[str, Any] = {"id": p.get("id"), "type": t}
        if p.get("options"):
            cfg["options"] = p["options"]
        if p.get("relation_database_id"):
            cfg["relation_database_id"] = p["relation_database_id"]
        if p.get("read_only"):
            cfg["system"] = True
        if t in ASSET_TYPES:
            cfg["file_mode"] = "upload"
            cfg["storage_folder"] = "assets"
        out[f"{name}_config"] = cfg
    return out


def modal_schema_to_props(schema: Dict[str, Any]) -> List[Dict[str, Any]]:
    """SchemaConfigModal shape → `properties: [...]` for the vault table.

    Preserves the field ORDER (dict insertion order). The `*_config` keys provide id, options,
    relation, `storage_folder`, etc.
    
    """
    props: List[Dict[str, Any]] = []
    for name, t in (schema or {}).items():
        if name.endswith("_config"):
            continue
        cfg = schema.get(f"{name}_config") or {}
        p: Dict[str, Any] = {"name": name, "type": t}
        if cfg.get("id"):
            p["id"] = cfg["id"]
        if cfg.get("options"):
            p["options"] = cfg["options"]
        if cfg.get("relation_database_id"):
            p["relation_database_id"] = cfg["relation_database_id"]
        if cfg.get("storage_folder"):
            p["storage_folder"] = cfg["storage_folder"]
        if cfg.get("file_mode"):
            p["file_mode"] = cfg["file_mode"]
        if cfg.get("name_pattern"):
            p["name_pattern"] = cfg["name_pattern"]
        if cfg.get("default_option"):
            p["default_option"] = cfg["default_option"]
        if cfg.get("system"):
            p["read_only"] = True
        props.append(p)
    return props


def apply_override(base_table: Dict[str, Any], override_schema: Dict[str, Any]) -> Dict[str, Any]:
    """Applies a SchemaConfigModal override to a table derived from Notion.

    The override GOVERNS type and config (storage_folder, etc.); the base table provides id, name,
    folder, icon. Fields absent from the override (the user removed them) are NOT included.
    
    """
    table = dict(base_table)
    if override_schema:
        table["properties"] = modal_schema_to_props(override_schema)
    return table
