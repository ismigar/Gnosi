"""Graph placeholders must match the unresolved nodes shown by Obsidian."""

import networkx as nx

from backend.services.graph_service import GraphService


def _page(graph, node_id, label, table_id):
    graph.add_node(
        node_id,
        label=label,
        kind="page",
        metadata={"table_id": table_id},
        table_id=table_id,
        path=f"BD/Test/{node_id}.md",
    )


def test_missing_wikilink_creates_scoped_unresolved_node():
    graph = nx.Graph()
    _page(graph, "source", "Source", "table-a")
    service = GraphService()
    service.registry = {"tables": []}

    service._add_structural_edges(
        graph,
        [{
            "id": "source",
            "table_id": "table-a",
            "section_links": {None: ["Missing note"]},
        }],
    )

    unresolved = [
        node for node, attrs in graph.nodes(data=True)
        if attrs.get("kind") == "unresolved"
    ]
    assert len(unresolved) == 1
    node_id = unresolved[0]
    assert graph.nodes[node_id]["label"] == "Missing note"
    assert graph.nodes[node_id]["table_id"] == "table-a"
    assert graph.nodes[node_id]["metadata"]["resolved_target_id"] is None
    assert graph.edges["source", node_id]["kind"] == "link"
    assert graph.edges["source", node_id]["unresolved"] is True


def test_cross_table_wikilink_keeps_real_edge_and_adds_scoped_placeholder():
    graph = nx.Graph()
    _page(graph, "source", "Source", "table-a")
    _page(graph, "target", "Target", "table-b")
    service = GraphService()
    service.registry = {"tables": []}

    service._add_structural_edges(
        graph,
        [{
            "id": "source",
            "table_id": "table-a",
            "section_links": {None: ["Target"]},
        }],
    )

    assert graph.has_edge("source", "target")
    unresolved = [
        node for node, attrs in graph.nodes(data=True)
        if attrs.get("kind") == "unresolved"
    ]
    assert len(unresolved) == 1
    placeholder = unresolved[0]
    assert graph.nodes[placeholder]["metadata"]["resolved_target_id"] == "target"
    assert graph.nodes[placeholder]["metadata"]["scope_only"] is True
    assert graph.edges["source", placeholder]["scope_only"] is True
