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


def test_internal_page_id_is_unresolved_without_matching_filename():
    graph = nx.Graph()
    _page(graph, "source", "Source", "table-a")
    graph.add_node(
        "target-id",
        label="Readable target",
        kind="page",
        metadata={"table_id": "table-a"},
        table_id="table-a",
        path="BD/Test/Readable target.md",
    )
    service = GraphService()
    service.registry = {"tables": []}

    service._add_structural_edges(
        graph,
        [{
            "id": "source",
            "table_id": "table-a",
            "section_links": {None: ["target-id"]},
        }],
    )

    unresolved = [
        node for node, attrs in graph.nodes(data=True)
        if attrs.get("kind") == "unresolved"
    ]
    assert len(unresolved) == 1
    assert graph.has_edge("source", unresolved[0])
    assert not graph.has_edge("source", "target-id")


def test_internal_page_id_resolves_when_filename_matches():
    graph = nx.Graph()
    _page(graph, "source", "Source", "table-a")
    graph.add_node(
        "target-id",
        label="Readable target",
        kind="page",
        metadata={"table_id": "table-a"},
        table_id="table-a",
        path="BD/Test/target-id.md",
    )
    service = GraphService()
    service.registry = {"tables": []}

    service._add_structural_edges(
        graph,
        [{
            "id": "source",
            "table_id": "table-a",
            "section_links": {None: ["target-id"]},
        }],
    )

    assert graph.has_edge("source", "target-id")
    assert not any(
        attrs.get("kind") == "unresolved"
        for _, attrs in graph.nodes(data=True)
    )


def test_db_view_wikilink_keeps_body_link_provenance():
    graph = nx.Graph()
    _page(graph, "source", "Source", "table-a")
    _page(graph, "target", "Target", "table-a")
    service = GraphService()
    service.registry = {
        "tables": [{
            "id": "table-a",
            "sections": [{
                "heading": "Linked notes",
                "type": "db_view",
            }],
        }],
    }

    service._add_structural_edges(
        graph,
        [{
            "id": "source",
            "table_id": "table-a",
            "section_links": {"Linked notes": ["Target"]},
        }],
    )

    assert graph.edges["source", "target"]["kind"] == "relation"
    assert graph.edges["source", "target"]["body_link"] is True
