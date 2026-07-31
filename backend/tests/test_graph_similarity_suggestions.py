"""Semantic graph suggestions must remain a separate, scored edge layer."""

import json

import networkx as nx

from backend.services import graph_service as graph_service_module
from backend.services.graph_service import GraphService


def test_add_suggestion_edges_normalizes_scores(monkeypatch, tmp_path):
    (tmp_path / "suggestions.json").write_text(
        json.dumps({
            "source": [
                {"target_id": "target", "score": 0.83, "reason": "Shared topic"},
                {"target_id": "missing", "score": 0.91},
            ],
        }),
        encoding="utf-8",
    )
    monkeypatch.setattr(graph_service_module, "_resolve_active_vault_path", lambda _cfg: tmp_path)

    graph = nx.Graph()
    graph.add_nodes_from(["source", "target"])

    GraphService()._add_suggestion_edges(graph)

    edge = graph.edges["source", "target"]
    assert edge["kind"] == "suggestion"
    assert edge["similarity"] == 83.0
    assert edge["reason"] == "Shared topic"
    assert not graph.has_node("missing")


def test_similarity_edges_do_not_change_layout_hash():
    graph = nx.Graph()
    graph.add_nodes_from(["source", "target"])
    graph.add_edge("source", "target", kind="suggestion", similarity=90)

    with_suggestion = GraphService()._compute_graph_hash(graph)
    graph.remove_edge("source", "target")
    without_suggestion = GraphService()._compute_graph_hash(graph)

    assert with_suggestion == without_suggestion
