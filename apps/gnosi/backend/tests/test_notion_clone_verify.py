"""Tests del verificador de salut del clon (pur)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.notion_clone_verify import verify_clone, relation_ids  # noqa: E402


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
    r = verify_clone({"T": 3}, pages)   # Notion té 3, el clon 1
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
