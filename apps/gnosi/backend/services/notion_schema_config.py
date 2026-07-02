"""Conversió d'esquema Notion ↔ format de SchemaConfigModal (import/clon configurable).

El modal de Gnosi (`SchemaConfigModal`) treballa amb la forma `{camp: tipus, camp_config: {...}}`.
L'importador produeix `properties: [{name, type, options, relation_database_id, ...}]`. Aquests
helpers converteixen en els dos sentits perquè l'usuari pugui configurar l'esquema de cada BD
amb el formulari de camps que ja coneix (incloent `storage_folder` per camps d'arxiu).

PUR → testejable sense backend. cf. directiva `notion_import_configurable_schema.md`.
"""
from __future__ import annotations

from typing import Any, Dict, List

ASSET_TYPES = {"files", "file", "image", "images"}


def notion_props_to_modal_schema(properties: List[Dict[str, Any]]) -> Dict[str, Any]:
    """`properties` (de map_database_schema) → forma de SchemaConfigModal `{nom:tipus, nom_config}`.

    Els camps d'arxiu reben `storage_folder: "assets"` per defecte (l'usuari el pot canviar).
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
    """Forma de SchemaConfigModal → `properties: [...]` per a la taula del vault.

    Preserva l'ORDRE dels camps (dict insertion order). Les claus `*_config` aporten id, opcions,
    relació, `storage_folder`, etc.
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
    """Aplica un override de SchemaConfigModal a una taula derivada de Notion.

    L'override MANA en tipus i config (storage_folder, etc.); la taula base aporta id, name,
    folder, icon. Camps absents a l'override (l'usuari els ha tret) NO s'inclouen.
    """
    table = dict(base_table)
    if override_schema:
        table["properties"] = modal_schema_to_props(override_schema)
    return table
