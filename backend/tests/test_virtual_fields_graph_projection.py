"""Virtual graph fields use the canonical live graph projection."""

from backend.api.virtual_fields import _build_degree_index, _get_nx_graph


def test_virtual_metrics_ignore_proposals_and_unresolved_targets():
    graph = {
        "nodes": [
            {"id": "a", "kind": "page"},
            {"id": "b", "kind": "page"},
            {"id": "c", "kind": "page"},
            {"id": "missing", "kind": "unresolved"},
        ],
        "edges": [
            {"source": "a", "target": "b", "src": "a", "dst": "b", "kind": "link"},
            {"source": "b", "target": "c", "src": "b", "dst": "c", "kind": "suggestion"},
            {
                "source": "a",
                "target": "missing",
                "src": "a",
                "dst": "missing",
                "kind": "link",
                "unresolved": True,
            },
        ],
    }

    degrees = _build_degree_index(graph)
    nx_graph = _get_nx_graph(graph)

    assert degrees == {
        "a": {"in": 0, "out": 1, "total": 1},
        "b": {"in": 1, "out": 0, "total": 1},
        "c": {"in": 0, "out": 0, "total": 0},
    }
    assert set(nx_graph.nodes) == {"a", "b", "c"}
    assert set(nx_graph.edges) == {("a", "b")}
