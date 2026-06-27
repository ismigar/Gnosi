"""Tests dels convertidors d'esquema Notion ↔ SchemaConfigModal (pur)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.notion_schema_config import (  # noqa: E402
    notion_props_to_modal_schema, modal_schema_to_props, apply_override,
)

PROPS = [
    {"name": "Nom", "type": "title", "id": "t"},
    {"name": "Estat", "type": "status", "id": "s", "options": [{"name": "Fet", "color": "green"}]},
    {"name": "Foto", "type": "files", "id": "f"},
    {"name": "Projecte", "type": "relation", "id": "r", "relation_database_id": "db-proj"},
    {"name": "Score", "type": "text", "id": "sc", "read_only": True},
]


def test_notion_to_modal_format():
    s = notion_props_to_modal_schema(PROPS)
    assert s["Nom"] == "title"
    assert s["Estat"] == "status" and s["Estat_config"]["options"][0]["name"] == "Fet"
    # camp d'arxiu rep storage_folder per defecte
    assert s["Foto"] == "files" and s["Foto_config"]["storage_folder"] == "assets"
    assert s["Foto_config"]["file_mode"] == "upload"
    assert s["Projecte_config"]["relation_database_id"] == "db-proj"
    assert s["Score_config"]["system"] is True   # read_only → system


def test_modal_to_props_preserves_order_and_config():
    s = notion_props_to_modal_schema(PROPS)
    props = modal_schema_to_props(s)
    assert [p["name"] for p in props] == ["Nom", "Estat", "Foto", "Projecte", "Score"]
    foto = next(p for p in props if p["name"] == "Foto")
    assert foto["storage_folder"] == "assets"
    assert next(p for p in props if p["name"] == "Score")["read_only"] is True


def test_user_override_changes_type_and_storage():
    # l'usuari canvia "Foto" de files→image i storage_folder a biblioteca; treu "Score"
    s = notion_props_to_modal_schema(PROPS)
    s["Foto"] = "image"
    s["Foto_config"]["type"] = "image"
    s["Foto_config"]["storage_folder"] = "biblioteca"
    del s["Score"]; del s["Score_config"]
    props = modal_schema_to_props(s)
    names = [p["name"] for p in props]
    assert "Score" not in names            # camp tret per l'usuari
    foto = next(p for p in props if p["name"] == "Foto")
    assert foto["type"] == "image" and foto["storage_folder"] == "biblioteca"


def test_apply_override_keeps_table_identity():
    base = {"id": "tbl-1", "name": "Projectes", "folder": "Clon Notion/Projectes",
            "icon": "📀", "properties": [{"name": "x", "type": "text"}]}
    s = notion_props_to_modal_schema(PROPS)
    t = apply_override(base, s)
    assert t["id"] == "tbl-1" and t["name"] == "Projectes" and t["folder"] == "Clon Notion/Projectes"
    assert [p["name"] for p in t["properties"]] == ["Nom", "Estat", "Foto", "Projecte", "Score"]


def test_apply_override_empty_keeps_base():
    base = {"id": "t", "name": "T", "properties": [{"name": "x", "type": "text"}]}
    assert apply_override(base, {})["properties"] == [{"name": "x", "type": "text"}]


if __name__ == "__main__":
    import traceback
    fns = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    failed = 0
    for fn in fns:
        try:
            fn(); print(f"PASS {fn.__name__}")
        except Exception:
            failed += 1; print(f"FAIL {fn.__name__}"); traceback.print_exc()
    print(f"\n{len(fns) - failed}/{len(fns)} OK")
    sys.exit(1 if failed else 0)
