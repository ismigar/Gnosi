"""Brain suggestions are projected directly as a separate graph edge layer."""

import networkx as nx

from backend.services import llm_wiki_suggestions
from backend.services.graph_service import GraphService


def test_add_suggestion_edges_reads_the_canonical_queue(monkeypatch):
    monkeypatch.setattr(
        llm_wiki_suggestions,
        "list_graph_edges",
        lambda: [
            {
                "source": "source",
                "target": "target",
                "similarity": 83,
                "reason": "Shared topic",
                "suggestion_id": "proposal-1",
            },
            {"source": "source", "target": "missing", "similarity": 91},
        ],
    )

    graph = nx.DiGraph()
    graph.add_nodes_from(["source", "target"])

    GraphService()._add_suggestion_edges(graph)

    edge = graph.edges["source", "target"]
    assert edge["kind"] == "suggestion"
    assert edge["similarity"] == 83
    assert edge["reason"] == "Shared topic"
    assert edge["suggestion_id"] == "proposal-1"
    assert not graph.has_node("missing")


def test_explicit_relationship_supersedes_a_suggestion(monkeypatch):
    monkeypatch.setattr(
        llm_wiki_suggestions,
        "list_graph_edges",
        lambda: [{"source": "source", "target": "target", "similarity": 90}],
    )
    graph = nx.DiGraph()
    graph.add_nodes_from(["source", "target"])
    graph.add_edge("target", "source", kind="link")

    GraphService()._add_suggestion_edges(graph)

    assert graph.number_of_edges() == 1
    assert graph.edges["target", "source"]["kind"] == "link"
