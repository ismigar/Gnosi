"""Notion's pagination loops must not hang on malformed responses.

They did `if not has_more: break; cursor = next_cursor`. If the API (via Cloudflare)
returns `has_more=True` with an empty OR repeated `next_cursor`, the `while True` spun
forever, hanging the clone's thread. `_next_cursor` stops pagination in these
cases.
"""
import pytest

from backend.services.notion_importer import NotionClient


def test_next_cursor_stops_when_no_more():
    assert NotionClient._next_cursor({"has_more": False}, "c1") is None


def test_next_cursor_advances():
    assert NotionClient._next_cursor({"has_more": True, "next_cursor": "c2"}, "c1") == "c2"


@pytest.mark.parametrize("bad", [None, "", "c1"])  # empty, absent-equivalent, repeated
def test_next_cursor_defensive_stop(bad):
    # has_more=True but cursor doesn't advance → stop (no infinite loop).
    assert NotionClient._next_cursor({"has_more": True, "next_cursor": bad}, "c1") is None


def test_pagination_loop_terminates_on_malformed_response(monkeypatch):
    # _request always says "there's more" but never returns a new cursor → without the
    # guard, search_databases would spin forever. With the guard, it returns.
    client = NotionClient(token="x")
    calls = {"n": 0}

    def fake_request(method, path, **kw):
        calls["n"] += 1
        assert calls["n"] < 100, "el bucle no ha terminat (hang)"
        return {"results": [{"id": "a"}], "has_more": True, "next_cursor": None}

    monkeypatch.setattr(client, "_request", fake_request)
    out = client.search_databases()
    assert out == [{"id": "a"}]  # one page, then stops
    assert calls["n"] == 1
