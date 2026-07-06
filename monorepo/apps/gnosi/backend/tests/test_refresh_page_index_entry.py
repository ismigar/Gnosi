"""_refresh_page_index_entry: refresca l'índex en memòria després d'un write.

El comparteixen els escriptors que abans deixaven el metadata ranci al cache
(PUT save_page — que només actualitzava el mapa id→path — i promote_zotero_extra
— que no tocava res del cache). Sense refresc, `GET /pages`/`/by-table` servien
el valor VELL fins al rescan (cooldown 600s). Reproduït en viu amb PUT.
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
    # No ha de petar ni tocar res.
    vr._refresh_page_index_entry(fp, {"id": "p1"}, "cos")
