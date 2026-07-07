"""Els bucles de paginació de Notion no han de penjar amb respostes malformades.

Feien `if not has_more: break; cursor = next_cursor`. Si l'API (via Cloudflare)
torna `has_more=True` amb `next_cursor` buit O repetit, el `while True` girava
per sempre penjant el fil del clon. `_next_cursor` atura la paginació en aquests
casos.
"""
import pytest

from backend.services.notion_importer import NotionClient


def test_next_cursor_stops_when_no_more():
    assert NotionClient._next_cursor({"has_more": False}, "c1") is None


def test_next_cursor_advances():
    assert NotionClient._next_cursor({"has_more": True, "next_cursor": "c2"}, "c1") == "c2"


@pytest.mark.parametrize("bad", [None, "", "c1"])  # buit, absent-equivalent, repetit
def test_next_cursor_defensive_stop(bad):
    # has_more=True però cursor no avança → aturar (no bucle infinit).
    assert NotionClient._next_cursor({"has_more": True, "next_cursor": bad}, "c1") is None


def test_pagination_loop_terminates_on_malformed_response(monkeypatch):
    # _request sempre diu "hi ha més" però mai dona un cursor nou → sense la
    # guarda, search_databases giraria per sempre. Amb la guarda, retorna.
    client = NotionClient(token="x")
    calls = {"n": 0}

    def fake_request(method, path, **kw):
        calls["n"] += 1
        assert calls["n"] < 100, "el bucle no ha terminat (hang)"
        return {"results": [{"id": "a"}], "has_more": True, "next_cursor": None}

    monkeypatch.setattr(client, "_request", fake_request)
    out = client.search_databases()
    assert out == [{"id": "a"}]  # una pàgina, després para
    assert calls["n"] == 1
