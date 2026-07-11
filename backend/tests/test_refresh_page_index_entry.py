"""_refresh_page_index_entry: refreshes the in-memory index after a write.

Shared by the writers that used to leave stale metadata in the cache
(PUT save_page — which only updated the id→path map — and promote_zotero_extra
— which didn't touch the cache at all). Without refreshing, `GET /pages`/`/by-table` served
the OLD value until the rescan (600s cooldown). Reproduced live with PUT.
"""
import backend.api.vault_routes as vr


def _seed_stale(vault, fp, extra):
    st = fp.stat()
    vr._page_index_entries.setdefault(str(vault), {})[str(fp)] = {
        "id": "p1", "title": "P", "parent_id": None, "is_database": False,
        "metadata": {"id": "p1", "QAField": "vell"},
        "mtime": st.st_mtime, "mtime_ns": st.st_mtime_ns,
        "created_mtime": st.st_mtime, "size": st.st_size, "folder": "", "path": str(fp),
    }


def test_refresh_updates_stale_entry(monkeypatch, tmp_path):
    vault = tmp_path / "vault"
    vault.mkdir()
    fp = vault / "page.md"
    fp.write_text("---\nid: p1\n---\ncos\n", encoding="utf-8")
    monkeypatch.setattr(vr, "get_active_vault_path", lambda: vault)
    monkeypatch.setattr(vr, "get_p", lambda key: vault)
    _seed_stale(vault, fp, "vell")

    v_str = str(vault)
    ver_before = vr._page_index_version.get(v_str, 0)
    vr._body_cache[str(fp)] = (0, "stale body")
    try:
        vr._refresh_page_index_entry(fp, {"id": "p1", "QAField": "NOU"}, "cos nou")

        entry = vr._page_index_entries[v_str][str(fp)]
        assert (entry.get("metadata") or {}).get("QAField") == "NOU", "metadata refrescat"
        assert vr._page_id_to_path[v_str]["p1"] == str(fp), "mapa id→path actualitzat"
        assert vr._page_index_version.get(v_str, 0) > ver_before, "versió incrementada"
        assert str(fp) not in vr._body_cache, "body cache invalidat"
    finally:
        vr._page_index_entries.get(v_str, {}).pop(str(fp), None)
        vr._page_id_to_path.get(v_str, {}).pop("p1", None)
        vr._body_cache.pop(str(fp), None)


def test_refresh_no_vault_is_noop(monkeypatch, tmp_path):
    fp = tmp_path / "page.md"
    fp.write_text("---\nid: p1\n---\ncos\n", encoding="utf-8")
    monkeypatch.setattr(vr, "get_active_vault_path", lambda: None)
    # It must not crash or touch anything.
    vr._refresh_page_index_entry(fp, {"id": "p1"}, "cos")
