"""Tests for graph cluster values exported to the frontend legend."""

from backend.services.graph_service import _node_cluster, _string_to_color


def test_node_cluster_prefers_explicit_cluster_over_tags():
    metadata = {"cluster": "Research", "tags": ["Archive"]}

    assert _node_cluster(metadata, {}) == "Research"


def test_node_cluster_uses_the_first_tag_name_as_a_fallback():
    metadata = {"tags": [{"name": "Projects"}, {"name": "Archive"}]}

    assert _node_cluster(metadata, {}) == "Projects"


def test_cluster_color_is_stable_for_the_same_label():
    assert _string_to_color("Research") == _string_to_color("Research")
    assert _string_to_color("Research").startswith("#")


def test_legend_computes_color_once_per_cluster_without_changing_counts_or_order(monkeypatch):
    from unittest.mock import Mock

    from backend.domains.graph import projection

    color = Mock(wraps=projection._string_to_color)
    monkeypatch.setattr(projection, "_string_to_color", color)
    nodes = [
        {"kind": "page", "color": "#123456", "cluster": cluster}
        for cluster in ["Research", "Archive", "Research"] * 20
    ]
    expected = {
        "kinds": [{"label": "Page", "color": "#123456", "count": 60}],
        "clusters": [
            {"label": "Archive", "color": _string_to_color("Archive"), "count": 20},
            {"label": "Research", "color": _string_to_color("Research"), "count": 40},
        ],
    }
    assert projection.build_legend(nodes) == expected
    assert color.call_count == 2
