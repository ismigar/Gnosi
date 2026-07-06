"""duplicate_page ha de registrar la còpia a l'índex de pàgines en memòria.

Sense el registre (`_add_page_to_index_cache`, el mateix helper que usa el
restore de la paperera), la còpia quedava INVISIBLE per a l'API: el fitxer
existia a disc però `find_page_path` no el trobava al cache i, amb l'índex
inicialitzat, salta el rglob de fallback ("probablement esborrada") →
GET/PATCH/DELETE de la còpia feien 404 fins a un rebuild complet de l'índex.
Reproduït contra el backend real abans del fix.
"""
import asyncio
from pathlib import Path

import pytest

import backend.api.vault_routes as vr


class _BT:
    def __init__(self):
        self.tasks = []

    def add_task(self, fn, *a, **k):
        self.tasks.append((fn, a))


@pytest.fixture()
def harness(monkeypatch, tmp_path):
    src = tmp_path / "orig.md"
    src.write_text("---\nid: orig-id\ntitle: Original\n---\ncos original\n", encoding="utf-8")
    registered = []
    monkeypatch.setattr(vr, "find_page_path", lambda pid, **kw: src)
    monkeypatch.setattr(vr, "_add_page_to_index_cache", lambda p: registered.append(Path(p)))
    return {"src": src, "registered": registered, "dir": tmp_path}


def test_duplicate_registers_copy_in_index(harness):
    bt = _BT()
    res = asyncio.run(vr.duplicate_page("orig-id", bt))
    assert res["status"] == "created"

    new_file = harness["dir"] / f"{res['id']}.md"
    assert new_file.exists(), "la còpia no s'ha escrit a disc"
    # El registre a l'índex és el que fa la còpia VISIBLE per a l'API.
    assert harness["registered"] == [new_file], "la còpia no s'ha registrat a l'índex"
    # I el link-index es refresca en background, com abans.
    assert any(fn is vr.update_link_index_for_page for fn, _ in bt.tasks)


def test_duplicate_copy_has_fresh_id_and_copy_title(harness):
    res = asyncio.run(vr.duplicate_page("orig-id", _BT()))
    assert res["id"] != "orig-id"
    assert res["title"] == "Original (Copy)"
    raw = (harness["dir"] / f"{res['id']}.md").read_text(encoding="utf-8")
    assert f"id: {res['id']}" in raw
    assert "cos original" in raw
