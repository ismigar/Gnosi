"""Tests `_run_clone_sync` write_page reclone deduplication by id.

During the 2026-07-04 incident, recloning a vault created a SECOND
«Title id8.md» file for every page even though clone ids are deterministic.
These tests verify that recloning does not increase the file count, distinct
pages with the same title coexist using the id8 suffix, and orphan rows are
reported without being deleted.
"""
import sys
from pathlib import Path

# Add the `gnosi` root to the path so `backend...` imports match runtime.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import yaml  # noqa: E402
import pytest  # noqa: E402

from backend.api import notion_routes  # noqa: E402

TID = "clone-table-1"


def _page(pid, title):
    return {"id": pid, "title": title, "content": f"cos de {pid}",
            "metadata": {"table_id": TID}}


def _fake_clone_workspace(pages):
    """Simulates clone_workspace by invoking the real _run_clone_sync callbacks."""
    def fake(rest, *, write_table, write_page, write_view, **kw):
        write_table({"id": TID, "name": "Tasques", "folder": "Tasques", "properties": []})
        for p in pages:
            write_page(dict(p, metadata=dict(p["metadata"])))
        return {"tables": 1, "pages": len(pages), "views": 0, "attachments": 0,
                "collected": len(pages), "errors": [], "warnings": [], "truncated": False}
    return fake


@pytest.fixture()
def clone_env(tmp_path, monkeypatch):
    """Isolates _run_clone_sync with in-memory state and no network or index."""
    vault = tmp_path / "vault"
    vault.mkdir()
    registry = {"tables": [], "views": [], "databases": []}
    monkeypatch.setattr(notion_routes, "_get_token", lambda: "tok")
    monkeypatch.setattr(notion_routes.notion_mcp, "is_connected", lambda: True)
    monkeypatch.setattr(notion_routes, "get_active_vault_path", lambda: vault)
    monkeypatch.setattr(notion_routes, "NotionClient", lambda tok: object())
    monkeypatch.setattr(notion_routes.vault_routes, "load_registry", lambda: registry)
    monkeypatch.setattr(notion_routes.vault_routes, "save_registry", lambda reg: None)
    monkeypatch.setattr(notion_routes.vault_routes, "register_page_in_index", lambda p: None)
    monkeypatch.setitem(notion_routes._CLONE_CANCEL, "flag", False)

    def run(pages, *, prune_orphans=False):
        monkeypatch.setattr(notion_routes.notion_clone, "clone_workspace",
                            _fake_clone_workspace(pages))
        return notion_routes._run_clone_sync(
            ["db1"], target_folder="", prune_orphans=prune_orphans
        )

    return vault, run


def _md_files(vault):
    return sorted(p.name for p in (vault / "BD" / "Tasques").glob("*.md"))


def _fm(path):
    body = path.read_text(encoding="utf-8")
    return yaml.safe_load(body.split("---")[1])


def test_reclone_does_not_duplicate_files(clone_env):
    vault, run = clone_env
    pages = [_page("aaaa1111-id", "Postgrau"), _page("bbbb2222-id", "Filosofia")]
    run(pages)
    first = _md_files(vault)
    assert first == ["Filosofia.md", "Postgrau.md"]

    rep = run(pages)  # Same workspace: same deterministic ids.
    assert _md_files(vault) == first          # No new files.
    assert rep["warnings"] == []              # No orphans.
    # Content was overwritten at the same path without changing the id.
    assert _fm(vault / "BD" / "Tasques" / "Postgrau.md")["id"] == "aaaa1111-id"


def test_same_title_different_ids_coexist_with_suffix(clone_env):
    vault, run = clone_env
    run([_page("aaaa1111-id", "Duplicada"), _page("bbbb2222-id", "Duplicada")])
    files = _md_files(vault)
    assert files == ["Duplicada bbbb2222.md", "Duplicada.md"]

    # Each page finds its own file by id without creating another one.
    run([_page("aaaa1111-id", "Duplicada"), _page("bbbb2222-id", "Duplicada")])
    assert _md_files(vault) == files
    assert _fm(vault / "BD" / "Tasques" / "Duplicada.md")["id"] == "aaaa1111-id"
    assert _fm(vault / "BD" / "Tasques" / "Duplicada bbbb2222.md")["id"] == "bbbb2222-id"


def test_ghost_rows_reported_not_deleted(clone_env):
    vault, run = clone_env
    run([_page("aaaa1111-id", "Viva"), _page("bbbb2222-id", "Esborrada a Notion")])
    rep = run([_page("aaaa1111-id", "Viva")])  # The second clone omits the second row.
    ghost = vault / "BD" / "Tasques" / "Esborrada a Notion.md"
    assert ghost.exists()                      # Never deleted automatically.
    assert any("bbbb2222-id" in w and "orphan" in w.lower() for w in rep["warnings"])
    assert not any("aaaa1111-id" in w for w in rep["warnings"])


def test_ghost_rows_soft_deleted_when_pruning_is_explicit(clone_env, monkeypatch):
    vault, run = clone_env
    trash = vault / ".trash"

    def soft_delete(page_id, path):
        target = trash / page_id / "page.md"
        target.parent.mkdir(parents=True, exist_ok=True)
        path.replace(target)
        return {"id": page_id}

    monkeypatch.setattr(notion_routes.vault_routes, "_move_page_to_trash", soft_delete)
    monkeypatch.setattr(notion_routes.vault_routes, "remove_from_link_index", lambda page_id: None)
    monkeypatch.setattr(
        notion_routes.vault_routes,
        "_remove_page_from_index_cache",
        lambda page_id, path: None,
    )

    run([_page("aaaa1111-id", "Viva"), _page("bbbb2222-id", "Esborrada a Notion")])
    rep = run([_page("aaaa1111-id", "Viva")], prune_orphans=True)

    assert _md_files(vault) == ["Viva.md"]
    assert (trash / "bbbb2222-id" / "page.md").exists()
    assert rep["orphan_rows_pruned"] == 1
    assert rep["warnings"] == []


def test_reclone_empty_schema_does_not_wipe_existing_properties(tmp_path, monkeypatch):
    """Guards a rich schema against a degenerate reclone.

    A partial Notion fetch or empty override with `properties: []` must not
    destroy the existing registry schema. During the incident, «Resources» lost
    35 properties because write_table overwrote the entry by id.
    """
    vault = tmp_path / "vault"
    vault.mkdir()
    rich_props = [
        {"name": "Title", "type": "title", "id": "fld-title"},
        {"name": "Item Type", "type": "select", "id": "fld-type",
         "options": [{"name": "Llibre", "color": "orange"}]},
        {"name": "Tags", "type": "multi_select", "id": "fld-tags"},
    ]
    registry = {
        "tables": [{"id": TID, "name": "Recursos", "folder": "Recursos",
                    "database_id": "notion_clone_db", "properties": rich_props}],
        "views": [], "databases": [{"id": "notion_clone_db", "name": "Notion", "folder": "BD"}],
    }
    monkeypatch.setattr(notion_routes, "_get_token", lambda: "tok")
    monkeypatch.setattr(notion_routes.notion_mcp, "is_connected", lambda: True)
    monkeypatch.setattr(notion_routes, "get_active_vault_path", lambda: vault)
    monkeypatch.setattr(notion_routes, "NotionClient", lambda tok: object())
    monkeypatch.setattr(notion_routes.vault_routes, "load_registry", lambda: registry)
    monkeypatch.setattr(notion_routes.vault_routes, "save_registry", lambda reg: None)
    monkeypatch.setattr(notion_routes.vault_routes, "register_page_in_index", lambda p: None)
    monkeypatch.setitem(notion_routes._CLONE_CANCEL, "flag", False)

    def fake(rest, *, write_table, write_page, write_view, **kw):
        # Degenerate reclone: the same table with an empty schema.
        write_table({"id": TID, "name": "Recursos", "folder": "Recursos", "properties": []})
        return {"tables": 1, "pages": 0, "views": 0, "attachments": 0,
                "collected": 0, "errors": [], "warnings": [], "truncated": False}

    monkeypatch.setattr(notion_routes.notion_clone, "clone_workspace", fake)
    notion_routes._run_clone_sync(["db1"], target_folder="")

    table = next(t for t in registry["tables"] if t["id"] == TID)
    assert table["properties"] == rich_props  # Schema remains intact.
