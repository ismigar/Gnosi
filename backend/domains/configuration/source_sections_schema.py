"""Idempotent relation and backing table for each Brain's source structure."""

from __future__ import annotations

from uuid import NAMESPACE_URL, uuid5

from backend.domains.llm_wiki.source_structure import sections_table_id
from backend.domains.vault.registry.state import RegistryData

NAMES = {
    "ca": ("Apartat", "Apartats de les fonts", "Font", "Apartat pare", "Posició"),
    "en": ("Section", "Source sections", "Source", "Parent section", "Position"),
    "es": ("Apartado", "Apartados de las fuentes", "Fuente", "Apartado padre", "Posición"),
    "fr": ("Section", "Sections des sources", "Source", "Section parente", "Position"),
}


def ensure_source_sections(registry: RegistryData, brain: RegistryData, locale: str) -> bool:
    """Add managed structure without replacing existing columns or section rows."""
    language = str(locale).split("-", 1)[0].lower()
    field, table_name, source_name, parent_name, position_name = NAMES.get(language, NAMES["en"])
    brain_id = str(brain["id"])
    table_id = sections_table_id(brain_id)
    tables = registry.get("tables")
    if not isinstance(tables, list):
        return False
    changed = False
    if not any(isinstance(table, dict) and table.get("id") == table_id for table in tables):
        def prop(role: str, name: str, kind: str, **extra: object) -> dict[str, object]:
            return {"id": str(uuid5(NAMESPACE_URL, f"gnosi:{table_id}:{role}")),
                    "name": name, "type": kind, "system": True, **extra}
        tables.append({"id": table_id, "name": f"{table_name} — {brain.get('name', '')}",
                       "database_id": brain.get("database_id", "gnosi_vault_db"),
                       "folder": f"source-sections-{brain_id}", "managed_by": "llm-wiki",
                       "llm_wiki_sections_brain_id": brain_id,
                       "properties": [prop("title", field, "title"),
                                      prop("source", source_name, "text"),
                                      prop("parent", parent_name, "relation",
                                           relation_database_id=table_id, cardinality="many-to-one"),
                                      prop("position", position_name, "number")]})
        from backend.domains.vault.tables.schema import ensure_main_view
        ensure_main_view(registry, table_id)
        changed = True
    properties = brain.setdefault("properties", [])
    if not isinstance(properties, list):
        return changed
    managed = next((p for p in properties if isinstance(p, dict)
                    and isinstance(p.get("config"), dict) and p["config"].get("source_sections")), None)
    if managed is None:
        used_names = {p.get("name") for p in properties if isinstance(p, dict)}
        if field in used_names:
            field = f"{field} ({table_name})"
        managed = {"id": str(uuid5(NAMESPACE_URL, f"gnosi:{brain_id}:section-property")),
                           "name": field, "type": "relation", "relation_database_id": table_id,
                           "cardinality": "many-to-one", "config": {"source_sections": True}}
        properties.append(managed)
        changed = True
    elif managed.get("relation_database_id") != table_id:
        managed["relation_database_id"] = table_id
        changed = True
    if managed.get("cardinality") != "many-to-one":
        managed["cardinality"] = "many-to-one"
        changed = True
    views = registry.get("views")
    for view in views if isinstance(views, list) else []:
        if not isinstance(view, dict) or view.get("table_id") != brain_id or not view.get("is_main"):
            continue
        visible = view.get("visibleProperties")
        if isinstance(visible, list) and managed["name"] not in visible:
            visible.append(managed["name"])
            changed = True
    return changed
