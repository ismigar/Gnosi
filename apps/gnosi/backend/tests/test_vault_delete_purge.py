"""Vault deletion must not leave local artifacts behind.

Regression for the Notion-vault cleanup (2026-07-16): deleting a vault removed
the DB row (and optionally the folder) but left the per-vault page/id-title
cache JSONs, the per-vault SQLite, the pooled engine, and up to 7 days of
stale entries in the file-search index.
"""
from pathlib import Path

import backend.api.vault_routes as vr
import backend.data.db as db
import backend.services.vault_file_index as vfi
from backend.api.vaults_routes import _purge_vault_artifacts


def _entry(path: str, is_dir: bool = False) -> dict:
    return {"path": path, "name": Path(path).name, "name_norm": Path(path).name.lower(),
            "is_dir": is_dir, "mtime": 0.0, "last_seen": 0.0}


def test_file_index_remove_subtree(monkeypatch, tmp_path):
    monkeypatch.setattr(vfi, "_CACHE_PATH", tmp_path / "vault_file_index.json")
    monkeypatch.setattr(vfi, "_by_path", {
        "/vaults/Notion": _entry("/vaults/Notion", is_dir=True),
        "/vaults/Notion/BD/a.md": _entry("/vaults/Notion/BD/a.md"),
        "/vaults/Notionista/b.md": _entry("/vaults/Notionista/b.md"),
        "/vaults/Principal/c.md": _entry("/vaults/Principal/c.md"),
    })

    removed = vfi.remove_subtree("/vaults/Notion")

    assert removed == 2, "the root and its subtree fall, nothing else"
    remaining = set(vfi._by_path)
    assert remaining == {"/vaults/Notionista/b.md", "/vaults/Principal/c.md"}, \
        "a sibling sharing the prefix WITHOUT the slash must survive"
    assert (tmp_path / "vault_file_index.json").exists(), "purge is persisted"


def test_purge_vault_caches_memory_and_disk(monkeypatch, tmp_path):
    v_str = str(tmp_path / "Notion")
    page_cache = tmp_path / "vault_page_index_x.json"
    idtitle_cache = tmp_path / "vault_id_title_index_x.json"
    page_cache.write_text("{}", encoding="utf-8")
    idtitle_cache.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(vr, "get_page_index_cache_path", lambda v=None: page_cache)
    monkeypatch.setattr(vr, "_get_id_title_cache_path", lambda v=None: idtitle_cache)
    monkeypatch.setitem(vr._page_index_entries, v_str, {"/x.md": {"id": "p1"}})
    monkeypatch.setitem(vr._page_index_initialized, v_str, True)
    monkeypatch.setitem(vr._page_id_to_path, v_str, {"p1": "/x.md"})
    monkeypatch.setitem(vr._id_title_cache, v_str, {"index": {}})

    vr.purge_vault_caches(v_str)

    assert v_str not in vr._page_index_entries
    assert v_str not in vr._page_index_initialized
    assert v_str not in vr._page_id_to_path
    assert v_str not in vr._id_title_cache
    assert not page_cache.exists() and not idtitle_cache.exists()


def test_purge_artifacts_deletes_sqlite_only_with_files(monkeypatch, tmp_path):
    vpath = tmp_path / "Notion"
    db_file = tmp_path / "gnosi_vault_x.db"
    wal = Path(str(db_file) + "-wal")
    monkeypatch.setattr(db, "vault_db_path_for", lambda v: db_file)
    monkeypatch.setattr(vr, "purge_vault_caches", lambda v: None)

    db_file.write_bytes(b"")
    wal.write_bytes(b"")
    _purge_vault_artifacts(vpath, delete_files=False)
    assert db_file.exists() and wal.exists(), \
        "keeping the folder keeps the per-vault DB (user data, not a cache)"

    _purge_vault_artifacts(vpath, delete_files=True)
    assert not db_file.exists() and not wal.exists()


def test_purge_artifacts_disposes_engine(monkeypatch, tmp_path):
    vpath = tmp_path / "Notion"
    disposed = []

    class FakeEngine:
        def dispose(self):
            disposed.append(True)

    monkeypatch.setitem(db._engines, str(vpath), FakeEngine())
    monkeypatch.setitem(db._sessionmakers, str(vpath), object())
    monkeypatch.setattr(vr, "purge_vault_caches", lambda v: None)

    _purge_vault_artifacts(vpath, delete_files=False)

    assert disposed == [True]
    assert str(vpath) not in db._engines and str(vpath) not in db._sessionmakers
