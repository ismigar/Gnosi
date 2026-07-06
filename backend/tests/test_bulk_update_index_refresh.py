"""bulk-update-metadata ha de refrescar l'índex en memòria amb el valor nou.

L'endpoint escrivia a disc però NOMÉS invalidava l'índex de cites; no
refrescava `_page_index_entries` ni el micro-cache. Resultat (reproduït en
viu): `updated=N` però `GET /by-table`/`/pages` seguien servint el metadata
VELL des del cache fins al rescan complet (cooldown 600s) → l'edició massiva
"no s'enganxava" a la graella. El PATCH d'una sola pàgina ja feia aquest
refresc; ara el bulk també.
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
    # `_build_cache_entry_from_memory` usa `get_p("VAULT")` per al rel_folder.
    monkeypatch.setattr(vr, "get_p", lambda key: vault)
    monkeypatch.setattr(vr, "find_page_path", lambda pid, **kw: fp if pid == "p1" else None)
    monkeypatch.setattr(vr, "_invalidate_cite_key_index", lambda *a, **k: None)

    invalidated = {"n": 0}
    monkeypatch.setattr(vr, "_pages_cache_invalidate_all",
                        lambda: invalidated.__setitem__("n", invalidated["n"] + 1))

    # Sembra l'entrada d'índex amb el metadata RANCI (com el tindria el cache).
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
        # ÍNDEX en memòria refrescat (abans del fix seguia "vell").
        entry = vr._page_index_entries[v_str][str(fp)]
        assert (entry.get("metadata") or {}).get("QAField") == "NOU", \
            "l'índex en memòria ha de reflectir el valor nou"
        # Micro-cache invalidat.
        assert invalidated["n"] >= 1
    finally:
        vr._page_index_entries.get(v_str, {}).pop(str(fp), None)


def test_bulk_skip_does_not_touch_index(monkeypatch, tmp_path):
    # Un patch idèntic al valor actual = skip → no refresca ni invalida.
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
