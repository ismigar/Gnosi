"""Contract tests for the heterogeneous JSON payload of GET /api/graph."""

from __future__ import annotations

from typing import Any
from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
import json
from threading import Barrier
from unittest.mock import Mock

import pytest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api import vault_graph_routes
from backend.domains.graph.adapters import directed_graph
from backend.domains.graph.projection import build_legend, project_edges, project_nodes


@pytest.fixture(autouse=True)
def fresh_serialization_cache(monkeypatch):
    monkeypatch.setattr(vault_graph_routes, "_cached_graph", None)
    monkeypatch.setattr(vault_graph_routes, "_cached_graph_json", None)
    monkeypatch.setattr(vault_graph_routes, "_cached_graph_gzip", None)


def _projected_payload() -> dict[str, Any]:
    graph = directed_graph()
    graph.add_node(
        "page-1",
        label="Page One",
        size=12,
        color="#112233",
        kind="page",
        metadata={
            "title": "Page One",
            "tags": ["Research"],
            "plugin": {"score": 0.75, "flags": [True, None]},
        },
        path="Notes/page-1.md",
        table_id="table-1",
        database_id="database-1",
    )
    graph.add_node(
        7,
        label="Contact Seven",
        size=8,
        color="#10b981",
        kind="contact",
        metadata={"email": "seven@example.test", "source": "custom"},
        path="Contacts/Contact Seven.md",
    )
    graph.add_edge(
        "page-1",
        7,
        kind="suggestion",
        color="#a855f7",
        size=1,
        dashed=True,
        reason="Shared concern",
        suggestion_id="proposal-1",
        src="page-1",
        dst=7,
        directed=False,
    )

    nodes = project_nodes(graph)
    edges = project_edges(graph)
    payload: dict[str, Any] = {
        "nodes": nodes,
        "edges": edges,
        "legend": build_legend(nodes),
    }
    payload["nodes"][0]["plugin_payload"] = {"rank": 3}
    payload["edges"][0]["weight_details"] = {"semantic": 0.92}
    payload["legend"]["provider"] = "vault"
    payload["projection_version"] = "extension-v1"
    return payload


def _client(monkeypatch: Any, payload: dict[str, Any]) -> TestClient:
    class FakeGraphService:
        def build_unified_graph(self) -> dict[str, Any]:
            return payload

    monkeypatch.setattr(vault_graph_routes, "GraphService", FakeGraphService)
    app = FastAPI()
    app.include_router(vault_graph_routes.router, prefix="/api")
    return TestClient(app)


def test_graph_openapi_uses_concrete_response_schema() -> None:
    app = FastAPI()
    app.include_router(vault_graph_routes.router, prefix="/api")

    response_schema = app.openapi()["paths"]["/api/graph"]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"]

    assert response_schema == {
        "$ref": "#/components/schemas/GraphResponse",
    }


def test_graph_response_preserves_real_projection_and_extensions(monkeypatch: Any) -> None:
    payload = _projected_payload()

    response = _client(monkeypatch, payload).get("/api/graph")

    assert response.status_code == 200
    assert response.json() == payload
    assert "partial" not in response.json()
    assert "skipped_dirs" not in response.json()


def test_graph_response_preserves_partial_build_fields(monkeypatch: Any) -> None:
    payload = _projected_payload()
    payload["partial"] = True
    payload["skipped_dirs"] = ["BD/Cervell"]

    response = _client(monkeypatch, payload).get("/api/graph")

    assert response.status_code == 200
    assert response.json() == payload


def test_graph_reuses_encoded_snapshot_and_keeps_request_headers_independent(monkeypatch):
    payload = _projected_payload()
    client = _client(monkeypatch, payload)
    validate = Mock(wraps=vault_graph_routes.GraphResponse.model_validate)
    monkeypatch.setattr(vault_graph_routes.GraphResponse, "model_validate", validate)
    first = client.get("/api/graph")
    second = client.get("/api/graph")
    assert first.content == second.content
    assert first.json() == payload
    assert second.headers["content-type"] == "application/json"
    validate.assert_called_once_with(payload)
    one = vault_graph_routes._build_graph_response()
    two = vault_graph_routes._build_graph_response()
    one.set_cookie("test-cookie", "only-first")
    assert "set-cookie" not in two.headers


def test_graph_rebuilds_and_vault_switches_cannot_reuse_a_previous_snapshot(monkeypatch):
    current = _projected_payload()

    class ChangingGraphService:
        def build_unified_graph(self):
            return current

    monkeypatch.setattr(vault_graph_routes, "GraphService", ChangingGraphService)
    app = FastAPI()
    app.include_router(vault_graph_routes.router, prefix="/api")
    with TestClient(app) as client:
        first = client.get("/api/graph").json()
        current = deepcopy(current)
        current["nodes"][0]["label"] = "Rebuilt page"
        assert client.get("/api/graph").json() == current
        assert current != first
        other_vault = {"nodes": [], "edges": [], "legend": {"kinds": [], "clusters": []}}
        rebuilt = current
        current = other_vault
        assert client.get("/api/graph").json() == other_vault
        current = rebuilt
        assert client.get("/api/graph").json() == rebuilt


def test_partial_graphs_are_never_kept_in_the_serialization_cache(monkeypatch):
    payload = _projected_payload()
    payload["partial"] = True
    payload["skipped_dirs"] = ["Notes"]
    client = _client(monkeypatch, payload)
    validate = Mock(wraps=vault_graph_routes.GraphResponse.model_validate)
    monkeypatch.setattr(vault_graph_routes.GraphResponse, "model_validate", validate)
    assert client.get("/api/graph").json() == payload
    assert client.get("/api/graph").json() == payload
    assert validate.call_count == 2
    assert vault_graph_routes._cached_graph is None


def test_failed_validation_does_not_publish_a_cached_success(monkeypatch):
    payload = _projected_payload()
    payload["nodes"][0].pop("id")
    client = _client(monkeypatch, payload)
    assert client.get("/api/graph").status_code == 500
    assert vault_graph_routes._cached_graph is None
    payload["nodes"][0]["id"] = "page-1"
    assert client.get("/api/graph").json() == payload


def test_concurrent_vault_encodings_do_not_mix_payloads(monkeypatch):
    payloads = [_projected_payload(), _projected_payload()]
    payloads[1]["nodes"][0]["label"] = "Other vault"
    barrier = Barrier(2)
    encode = vault_graph_routes._GRAPH_RESPONSE_ADAPTER.dump_json

    def synchronized_encode(*args, **kwargs):
        barrier.wait(timeout=2)
        return encode(*args, **kwargs)

    monkeypatch.setattr(vault_graph_routes._GRAPH_RESPONSE_ADAPTER, "dump_json", synchronized_encode)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(vault_graph_routes._graph_response_json, payloads))
    assert [json.loads(result) for result in results] == payloads
    assert json.loads(vault_graph_routes._cached_graph_json) == vault_graph_routes._cached_graph
