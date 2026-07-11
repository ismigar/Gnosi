"""Test of Notion's pure transformations (schema/values/blocks) that reuses the CLONE.

(The import orchestrator and the diff were removed: only the clone remains.)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.notion_importer import (  # noqa: E402
    map_database_schema, rich_text_to_md, value_to_gnosi,
    page_to_values, blocks_to_md, table_id_for, page_id_for,
)


def test_id_scheme_reconciles_with_vault():
    # table id = Notion DB id WITHOUT dashes (like the vault: 90e31c41f815...);
    # page id = Notion id AS-IS with dashes (like the vault frontmatter).
    assert table_id_for("90e31c41-f815-489b-99f3-0086b120cbfa") == "90e31c41f815489b99f30086b120cbfa"
    assert page_id_for("103268e5-2714-8069-9ec2-e8121dae22c5") == "103268e5-2714-8069-9ec2-e8121dae22c5"


def test_rich_text_formatting():
    rich = [
        {"plain_text": "bold", "annotations": {"bold": True}},
        {"plain_text": " and ", "annotations": {}},
        {"plain_text": "code", "annotations": {"code": True}},
        {"plain_text": " link", "annotations": {}, "href": "http://x.com"},
    ]
    assert rich_text_to_md(rich) == "**bold** and `code`[ link](http://x.com)"


def test_property_schema_mapping():
    db = {
        "id": "db-123", "title": [{"plain_text": "Projects"}],
        "icon": {"type": "emoji", "emoji": "📀"},
        "properties": {
            "Name": {"id": "title", "type": "title", "title": {}},
            "Estat": {"id": "s1", "type": "status", "status": {"options": [
                {"name": "Fet", "color": "green"}, {"name": "Actiu", "color": "blue"}]}},
            "Tags": {"id": "m1", "type": "multi_select", "multi_select": {"options": [
                {"name": "a", "color": "red"}]}},
            "Tasks": {"id": "r1", "type": "relation", "relation": {"database_id": "db-999"}},
            "Score": {"id": "f1", "type": "formula", "formula": {}},
            "ID": {"id": "u1", "type": "unique_id", "unique_id": {"prefix": "PROJ"}},
        },
    }
    table = map_database_schema(db)
    assert table["name"] == "Projects"
    assert table["icon"] == "📀"
    assert table["id"] == table_id_for("db-123")
    by_name = {p["name"]: p for p in table["properties"]}
    assert by_name["Name"]["type"] == "title"
    assert by_name["Estat"]["type"] == "status"
    assert by_name["Estat"]["options"][0] == {"name": "Fet", "color": "green"}
    assert by_name["Tags"]["type"] == "multi_select"
    assert by_name["Tasks"]["relation_database_id"] == table_id_for("db-999")
    assert by_name["Score"]["read_only"] is True
    assert by_name["ID"]["type"] == "text"   # unique_id → text (previously lost)


def test_value_extraction():
    users = {"u1": "Ismael"}
    page = {"properties": {
        "Name": {"type": "title", "title": [{"plain_text": "Hola"}]},
        "Done": {"type": "checkbox", "checkbox": True},
        "Estat": {"type": "status", "status": {"name": "Actiu"}},
        "Tags": {"type": "multi_select", "multi_select": [{"name": "x"}, {"name": "y"}]},
        "When": {"type": "date", "date": {"start": "2026-01-01", "end": "2026-01-05"}},
        "Owner": {"type": "people", "people": [{"id": "u1"}]},
        "Tasks": {"type": "relation", "relation": [{"id": "pg-1"}]},
        "ID": {"type": "unique_id", "unique_id": {"number": 42, "prefix": "PROJ"}},
    }}
    vals = page_to_values(page, users)
    assert vals["Name"] == "Hola"
    assert vals["Done"] is True
    assert vals["Estat"] == "Actiu"
    assert vals["Tags"] == ["x", "y"]
    assert vals["When"] == {"start": "2026-01-01", "end": "2026-01-05"}
    assert vals["Owner"] == "Ismael"
    assert vals["Tasks"] == [page_id_for("pg-1")]
    assert vals["ID"] == "PROJ-42"   # unique_id with prefix


def test_blocks_to_markdown_with_nesting():
    blocks = [
        {"type": "heading_1", "heading_1": {"rich_text": [{"plain_text": "Títol"}]}},
        {"type": "paragraph", "paragraph": {"rich_text": [{"plain_text": "Text"}]}},
        {"type": "to_do", "to_do": {"checked": True, "rich_text": [{"plain_text": "fet"}]}},
        {"type": "bulleted_list_item",
         "bulleted_list_item": {"rich_text": [{"plain_text": "pare"}]},
         "_children": [
             {"type": "bulleted_list_item",
              "bulleted_list_item": {"rich_text": [{"plain_text": "fill"}]}}]},
        {"type": "code", "code": {"language": "python", "rich_text": [{"plain_text": "x=1"}]}},
        {"type": "divider", "divider": {}},
    ]
    md = blocks_to_md(blocks)
    assert "# Títol" in md
    assert "- [x] fet" in md
    assert "  - fill" in md
    assert "```python\nx=1\n```" in md
    assert "---" in md


if __name__ == "__main__":
    import traceback
    fns = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except Exception:
            failed += 1
            print(f"FAIL {fn.__name__}")
            traceback.print_exc()
    print(f"\n{len(fns) - failed}/{len(fns)} OK")
    sys.exit(1 if failed else 0)
