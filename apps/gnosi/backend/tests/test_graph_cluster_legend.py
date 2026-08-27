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
