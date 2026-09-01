"""Contract tests for the heterogeneous JSON payload of GET /api/graph."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api import vault_graph_routes
from backend.domains.graph.adapters import directed_graph
from backend.domains.graph.projection import build_legend, project_edges, project_nodes


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
