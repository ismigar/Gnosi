"""Tests del write_page de _run_clone_sync (notion_routes): dedupe de re-clon per id.

Incident 2026-07-04: re-clonar sobre un vault amb un clon previ creava un SEGON fitxer
«Títol id8.md» per a cada pàgina (els ids del clon són deterministes). Aquí es prova que:
  · re-clonar NO fa créixer el nombre de fitxers (sobreescriu pel mateix id),
  · dues pàgines DIFERENTS amb el mateix títol segueixen coexistint amb sufix id8,
  · les files fantasma (id ja no a Notion) s'informen al report sense esborrar-se.
"""
import sys
from pathlib import Path

# arrel `gnosi` al path → `backend...` importable (com al runtime)
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import yaml  # noqa: E402
import pytest  # noqa: E402

from backend.api import notion_routes  # noqa: E402

TID = "clone-table-1"


def _page(pid, title):
    return {"id": pid, "title": title, "content": f"cos de {pid}",
            "metadata": {"table_id": TID}}


def _fake_clone_workspace(pages):
    """Simula clone_workspace: crida els callbacks reals de _run_clone_sync."""
    def fake(rest, *, write_table, write_page, write_view, **kw):
        write_table({"id": TID, "name": "Tasques", "folder": "Tasques", "properties": []})
        for p in pages:
            write_page(dict(p, metadata=dict(p["metadata"])))
        return {"tables": 1, "pages": len(pages), "views": 0, "attachments": 0,
                "collected": len(pages), "errors": [], "warnings": [], "truncated": False}
    return fake


@pytest.fixture()
def clone_env(tmp_path, monkeypatch):
    """Aïlla _run_clone_sync: token/MCP/vault/registre en memòria, sense xarxa ni índex."""
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

    def run(pages):
        monkeypatch.setattr(notion_routes.notion_clone, "clone_workspace",
                            _fake_clone_workspace(pages))
        return notion_routes._run_clone_sync(["db1"], target_folder="")

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

    rep = run(pages)  # re-clon del MATEIX workspace: mateixos ids deterministes
    assert _md_files(vault) == first          # cap fitxer nou
    assert rep["warnings"] == []              # cap fantasma
    # i el contingut s'ha sobreescrit al mateix path (id intacte)
    assert _fm(vault / "BD" / "Tasques" / "Postgrau.md")["id"] == "aaaa1111-id"


def test_same_title_different_ids_coexist_with_suffix(clone_env):
    vault, run = clone_env
    run([_page("aaaa1111-id", "Duplicada"), _page("bbbb2222-id", "Duplicada")])
    files = _md_files(vault)
    assert files == ["Duplicada bbbb2222.md", "Duplicada.md"]

    # re-clon: cada pàgina retroba el SEU fitxer (per id), sense crear-ne més
    run([_page("aaaa1111-id", "Duplicada"), _page("bbbb2222-id", "Duplicada")])
    assert _md_files(vault) == files
    assert _fm(vault / "BD" / "Tasques" / "Duplicada.md")["id"] == "aaaa1111-id"
    assert _fm(vault / "BD" / "Tasques" / "Duplicada bbbb2222.md")["id"] == "bbbb2222-id"


def test_ghost_rows_reported_not_deleted(clone_env):
    vault, run = clone_env
    run([_page("aaaa1111-id", "Viva"), _page("bbbb2222-id", "Esborrada a Notion")])
    rep = run([_page("aaaa1111-id", "Viva")])  # el 2n clon ja no porta la segona fila
    ghost = vault / "BD" / "Tasques" / "Esborrada a Notion.md"
    assert ghost.exists()                      # MAI s'esborra automàticament
    assert any("bbbb2222-id" in w and "fantasma" in w.lower() for w in rep["warnings"])
    assert not any("aaaa1111-id" in w for w in rep["warnings"])
