"""Tests for the clone's health checker (pure)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.notion_clone_verify import (  # noqa: E402
    relation_ids,
    verify_clone,
    verify_exact_table,
)


def test_relation_ids_accepts_all_shapes():
    assert relation_ids(["[[Títol|abc-123]]", "[[def-456]]", "ghi-789"]) == ["abc-123", "def-456", "ghi-789"]
    assert relation_ids("[[X|id1]]") == ["id1"]
    assert relation_ids(None) == [] and relation_ids([""]) == []


def test_healthy_clone():
    pages = [
        {"id": "a", "table_id": "T", "body_empty": False, "view_count": 1, "relations": ["b"], "missing_assets": []},
        {"id": "b", "table_id": "T", "body_empty": False, "view_count": 0, "relations": ["a"], "missing_assets": []},
    ]
    r = verify_clone({"T": 2}, pages)
    assert r["summary"]["healthy"] is True
    assert r["summary"]["tables_ok"] == 1 and r["summary"]["views"] == 1
    assert r["tables"][0]["ok"] is True and r["tables"][0]["missing"] == 0


def test_count_mismatch_flagged():
    pages = [{"id": "a", "table_id": "T", "body_empty": False, "view_count": 0, "relations": [], "missing_assets": []}]
    r = verify_clone({"T": 3}, pages)   # Notion has 3, the clone 1
    assert r["summary"]["healthy"] is False
    assert r["tables"][0]["missing"] == 2 and r["tables"][0]["ok"] is False


def test_empty_bodies_and_orphans_and_assets():
    pages = [
        {"id": "a", "table_id": "T", "body_empty": True, "view_count": 0,
         "relations": ["ghost"], "missing_assets": ["Assets/x.png"]},
    ]
    r = verify_clone({"T": 1}, pages)
    s = r["summary"]
    assert s["healthy"] is False
    assert s["empty_bodies"] == 1
    assert s["orphan_relations"] == 1 and r["orphan_relations"][0]["rel"] == "ghost"
    assert s["missing_assets"] == 1 and r["missing_assets"][0]["asset"] == "Assets/x.png"


def test_exact_table_detects_schema_rows_values_and_page_only_properties():
    expected_table = {
        "properties": [
            {"id": "title", "name": "Nota", "type": "title"},
            {
                "id": "links",
                "name": "Enllaça a",
                "type": "relation",
                "relation_database_id": "table",
            },
        ]
    }
    clone_table = {
        "properties": [
            {"id": "title", "name": "Nota", "type": "title"},
            {"id": "extra", "name": "Local", "type": "text"},
        ]
    }
    expected_rows = {
        "a": {
            "id": "a",
            "title": "A",
            "table_id": "table",
            "Nota": "A",
            "Enllaça a": ["b"],
        },
        "b": {
            "id": "b",
            "title": "B",
            "table_id": "table",
            "Nota": "B",
            "Enllaça a": [],
        },
    }
    clone_rows = {
        "a": {
            "id": "a",
            "title": "A",
            "table_id": "table",
            "Nota": "A",
            "Enllaça a": ["raw-notion-id"],
            "page_only": "leak",
        },
        "ghost": {
            "id": "ghost",
            "title": "Ghost",
            "table_id": "table",
            "Nota": "Ghost",
        },
    }

    result = verify_exact_table(expected_table, expected_rows, clone_table, clone_rows)

    assert result["summary"]["exact"] is False
    assert result["schema"]["missing"] == ["Enllaça a"]
    assert result["schema"]["extra"] == ["Local"]
    assert result["rows"]["missing"] == ["b"]
    assert result["rows"]["extra"] == ["ghost"]
    assert result["summary"]["value_mismatches"] == 1
    assert {item["property"] for item in result["undeclared_properties"]} == {
        "Enllaça a",
        "page_only",
    }


def test_exact_table_accepts_relation_wikilink_decoration():
    table = {
        "properties": [
            {
                "id": "links",
                "name": "Enllaça a",
                "type": "relation",
                "relation_database_id": "table",
            },
        ]
    }
    expected = {
        "a": {
            "id": "a",
            "title": "A",
            "table_id": "table",
            "Enllaça a": ["b"],
        }
    }
    clone = {
        "a": {
            "id": "a",
            "title": "A",
            "table_id": "table",
            "Enllaça a": ["[[B|b]]"],
        }
    }

    result = verify_exact_table(table, expected, table, clone)

    assert result["summary"]["exact"] is True
    assert result["summary"]["value_mismatches"] == 0


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
