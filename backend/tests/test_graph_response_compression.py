"""Graph wire compression preserves data and does not stall the event loop."""

import asyncio
import gzip
import json
from threading import Event
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import FastAPI, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.testclient import TestClient

from backend.api import vault_graph_routes as routes


@pytest.fixture
def graph(monkeypatch):
    payload = {"nodes": [], "edges": [], "legend": {"kinds": [], "clusters": []}, "extension": {"text": "synthetic " * 1000}}
    monkeypatch.setattr(routes, "_cached_graph", None)
    monkeypatch.setattr(routes, "_cached_graph_json", None)
    monkeypatch.setattr(routes, "_cached_graph_gzip", None)
    monkeypatch.setattr(routes, "GraphService", lambda: SimpleNamespace(build_unified_graph=lambda: payload))
    return payload


@pytest.mark.parametrize("accept, expected", [
    ("gzip, deflate, br", "gzip"), ("GZip; q=0.5", "gzip"),
    ("gzip;q=0, *;q=1", "identity"), ("br", "identity"),
    ("gzip;q=invalid", "identity"), ("*;q=1", "gzip"), ("", "identity"),
    ("*;q=0, identity;q=1", "identity"), ("gzip;q=1, identity;q=0", "gzip"),
])
def test_compression_negotiation_with_real_middleware(graph, accept, expected):
    app = FastAPI()
    app.include_router(routes.router)
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    response = TestClient(app).get("/graph", headers={"Accept-Encoding": accept})
    assert response.status_code == 200
    assert response.json() == graph
    assert response.headers["content-encoding"] == expected
    assert response.headers["vary"] == "Accept-Encoding"


@pytest.mark.parametrize("accept", ["gzip;q=0, identity;q=0", "br, identity;q=0", "*;q=0"])
def test_unacceptable_encodings_do_not_build_a_graph(graph, monkeypatch, accept):
    build = Mock(side_effect=AssertionError("An unacceptable response must not build the graph"))
    monkeypatch.setattr(routes, "GraphService", build)
    app = FastAPI()
    app.include_router(routes.router)
    response = TestClient(app).get("/graph", headers={"Accept-Encoding": accept})
    assert response.status_code == 406
    build.assert_not_called()


def test_compression_is_reused_only_for_the_current_complete_snapshot(graph, monkeypatch):
    compress = Mock(wraps=gzip.compress)
    monkeypatch.setattr(routes.gzip, "compress", compress)
    first = routes._build_graph_response(accept_gzip=True)
    second = routes._build_graph_response(accept_gzip=True)
    assert first.body == second.body
    assert json.loads(gzip.decompress(first.body)) == graph
    assert len(first.body) < len(routes._build_graph_response().body)
    assert compress.call_count == 1
    other = {"nodes": [], "edges": [], "legend": {"kinds": [], "clusters": []}, "extension": "other vault"}
    monkeypatch.setattr(routes, "GraphService", lambda: SimpleNamespace(build_unified_graph=lambda: other))
    assert json.loads(gzip.decompress(routes._build_graph_response(accept_gzip=True).body)) == other
    assert compress.call_count == 2
    other["partial"] = True
    # A partial snapshot is a fresh object, as published by GraphService.
    other = dict(other)
    monkeypatch.setattr(routes, "GraphService", lambda: SimpleNamespace(build_unified_graph=lambda: other))
    routes._build_graph_response(accept_gzip=True)
    routes._build_graph_response(accept_gzip=True)
    assert compress.call_count == 4


def test_slow_compression_leaves_the_event_loop_available(graph, monkeypatch):
    async def scenario():
        loop = asyncio.get_running_loop()
        compress = gzip.compress

        def slow_compress(*args, **kwargs):
            served = Event()
            loop.call_soon_threadsafe(served.set)
            assert served.wait(2), "Graph compression blocked unrelated requests"
            return compress(*args, **kwargs)

        monkeypatch.setattr(routes.gzip, "compress", slow_compress)
        request = Request({"type": "http", "headers": [(b"accept-encoding", b"gzip")]})
        response = await routes.get_vault_graph(request)
        assert json.loads(gzip.decompress(response.body)) == graph

    asyncio.run(scenario())
