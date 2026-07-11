"""bulk-update-metadata must refresh the in-memory index with the new value.

The endpoint wrote to disk but ONLY invalidated the citations index; it didn't
refresh `_page_index_entries` or the micro-cache. Result (reproduced live):
`updated=N` but `GET /by-table`/`/pages` kept serving the OLD metadata
from the cache until the full rescan (600s cooldown) → the bulk edit
"didn't stick" in the grid. The single-page PATCH already did this
refresh; now bulk does too.
"""
import asyncio

import backend.api.vault_routes as vr


def test_bulk_update_refreshes_in_memory_index(monkeypatch, tmp_path):
    vault = tmp_path / "vault"
    vault.mkdir()
    fp = vault / "page.md"
    fp.write_text("---\nid: p1\nQAField: vell\n---\ncos\n", encoding="utf-8")
    v_str = str(vault)

    monkeypatch.setattr(vr, "get_active_vault_path", lambda: vault)
    # `_build_cache_entry_from_memory` uses `get_p("VAULT")` for the rel_folder.
    monkeypatch.setattr(vr, "get_p", lambda key: vault)
    monkeypatch.setattr(vr, "find_page_path", lambda pid, **kw: fp if pid == "p1" else None)
    monkeypatch.setattr(vr, "_invalidate_cite_key_index", lambda *a, **k: None)

    invalidated = {"n": 0}
    monkeypatch.setattr(vr, "_pages_cache_invalidate_all",
                        lambda: invalidated.__setitem__("n", invalidated["n"] + 1))

    # Seed the index entry with STALE metadata (as the cache would have it).
    st = fp.stat()
    vr._page_index_entries.setdefault(v_str, {})[str(fp)] = {
        "id": "p1", "title": "P", "parent_id": None, "is_database": False,
        "metadata": {"id": "p1", "QAField": "vell"},
        "mtime": st.st_mtime, "created_mtime": st.st_mtime, "size": st.st_size,
        "folder": "", "path": str(fp),
    }
    try:
        res = asyncio.run(vr.bulk_update_metadata(
            {"page_ids": ["p1"], "updates": {"QAField": "NOU"}}
        ))
        assert res["updated"] == 1

        # Disc actualitzat.
        assert "NOU" in fp.read_text(encoding="utf-8")
        # In-memory INDEX refreshed (before the fix it stayed "old").
        entry = vr._page_index_entries[v_str][str(fp)]
        assert (entry.get("metadata") or {}).get("QAField") == "NOU", \
            "l'índex en memòria ha de reflectir el valor nou"
        # Micro-cache invalidat.
        assert invalidated["n"] >= 1
    finally:
        vr._page_index_entries.get(v_str, {}).pop(str(fp), None)


def test_bulk_skip_does_not_touch_index(monkeypatch, tmp_path):
    # A patch identical to the current value = skip → doesn't refresh or invalidate.
    vault = tmp_path / "vault"
    vault.mkdir()
    fp = vault / "page.md"
    fp.write_text("---\nid: p1\nQAField: igual\n---\ncos\n", encoding="utf-8")

    monkeypatch.setattr(vr, "get_active_vault_path", lambda: vault)
    monkeypatch.setattr(vr, "find_page_path", lambda pid, **kw: fp if pid == "p1" else None)
    monkeypatch.setattr(vr, "_invalidate_cite_key_index", lambda *a, **k: None)
    invalidated = {"n": 0}
    monkeypatch.setattr(vr, "_pages_cache_invalidate_all",
                        lambda: invalidated.__setitem__("n", invalidated["n"] + 1))

    res = asyncio.run(vr.bulk_update_metadata(
        {"page_ids": ["p1"], "updates": {"QAField": "igual"}}
    ))
    assert res["updated"] == 0
    assert res["skipped"] == ["p1"]
    assert invalidated["n"] == 0
