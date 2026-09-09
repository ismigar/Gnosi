"""Graph relation schema reuse must preserve values and refresh between builds."""

from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import Mock

from backend.domains.graph import nodes, service


def test_relation_names_and_aliases_are_reused_without_changing_cached_metadata(monkeypatch):
    registry = {"tables": [{"id": "table", "properties": [
        {"name": "Current", "type": "relation", "aliases": ["Previous", "Old"]},
        {"name": "Text", "type": "text"},
    ]}]}
    metadata = {"Current": ["[[Target|id]]", "bare", None], "Old": "[[Other|two]]",
                "Text": "[[Kept|as-text]]", "extension": {"value": 0}}
    original = deepcopy(metadata)
    lookup = Mock(wraps=nodes.relation_keys_from_table)
    monkeypatch.setattr(nodes, "relation_keys_from_table", lookup)
    cache = {}
    for _ in range(20):
        normalized = nodes.relation_metadata(metadata, "table", registry, relation_keys_cache=cache)
        assert normalized == {**metadata, "Current": ["id", "bare", None], "Old": "two"}
        assert normalized is not metadata
    assert metadata == original
    lookup.assert_called_once_with(registry["tables"][0])


def test_empty_missing_and_duplicate_table_schemas_retain_their_semantics(monkeypatch):
    first = {"id": "duplicate", "properties": [{"name": "First", "type": "relation"}]}
    registry = {"tables": [first,
        {"id": "duplicate", "properties": [{"name": "Second", "type": "relation"}]},
        {"id": "empty", "properties": []},
    ]}
    metadata = {"First": "[[Target|first]]", "Second": "[[Target|second]]"}
    lookup = Mock(wraps=nodes.relation_keys_from_table)
    monkeypatch.setattr(nodes, "relation_keys_from_table", lookup)
    cache = {}
    for _ in range(10):
        assert nodes.relation_metadata(metadata, "duplicate", registry, relation_keys_cache=cache) == {
            "First": "first", "Second": metadata["Second"],
        }
        for table_id in ("empty", "missing"):
            assert nodes.relation_metadata(metadata, table_id, registry, relation_keys_cache=cache) is metadata
    assert lookup.call_count == 3


def test_non_string_table_ids_keep_existing_matching_and_tolerant_behavior():
    metadata = {"Link": "[[Target|id]]"}
    registry = {"tables": [{"id": 7, "properties": [{"name": "Link", "type": "relation"}]}]}
    cache = {}
    assert nodes.relation_metadata(metadata, 7, registry, relation_keys_cache=cache) == {"Link": "id"}
    for table_id in ("7", None, [], {}):
        assert nodes.relation_metadata(metadata, table_id, registry, relation_keys_cache=cache) is metadata


def test_pages_without_a_table_share_the_lookup_only_within_their_registry_batch(monkeypatch):
    metadata = {"Link": "[[Target|id]]", "Other": "[[Other|two]]"}
    lookup = Mock(wraps=nodes.relation_keys_from_table)
    monkeypatch.setattr(nodes, "relation_keys_from_table", lookup)
    for field in (None, "Link", "Other"):
        # Keep historical matching for a registry entry that itself omits id.
        table = {"properties": [{"name": field, "type": "relation"}]} if field else None
        registry = {"tables": [{"id": "unrelated", "properties": []}] + ([table] if table else [])}
        cache = {}
        lookup.reset_mock()
        for _ in range(20):
            result = nodes.relation_metadata(metadata, None, registry, relation_keys_cache=cache)
            if field:
                assert result == {**metadata, field: "id" if field == "Link" else "two"}
            else:
                assert result is metadata
        lookup.assert_called_once_with(table)
    assert metadata == {"Link": "[[Target|id]]", "Other": "[[Other|two]]"}


def test_a_new_graph_batch_refreshes_schemas_and_keeps_original_page_cache(monkeypatch, tmp_path):
    registry = {"tables": [{"id": "table", "folder": "Records", "properties": [
        {"name": "Link", "type": "relation"},
    ]}]}
    cached = {"mtime": 1.0, "id": "page", "title": "Page", "kind": "page", "color": "#fff",
              "size": 8, "metadata": {"Link": "[[Target|id]]", "Other": "[[Other|two]]"},
              "links": [], "section_links": {}}
    path = tmp_path / "BD" / "Database" / "Records" / "page.md"
    monkeypatch.setattr(service.GraphService, "_NODE_DATA_CACHE", {str(path): cached})
    monkeypatch.setattr(service.GraphService, "_load_registry", lambda _: registry)
    monkeypatch.setattr(service, "load_params", lambda **_: SimpleNamespace(paths={"VAULT": tmp_path}))
    monkeypatch.setattr(service, "_resolve_active_vault_path", lambda _: tmp_path)
    monkeypatch.setattr(service, "indexed_markdown_files", lambda _: [(path, 1.0)])
    graph_service = service.GraphService()
    for name in ("Link", "Other"):
        registry["tables"][0]["properties"] = [{"name": name, "type": "relation"}]
        graph = service.directed_graph()
        pages, skipped = graph_service._add_page_nodes(graph)
        assert not skipped
        assert graph.nodes["page"]["table_id"] == "table"
        assert pages[0]["metadata"] == {**cached["metadata"], name: "id" if name == "Link" else "two"}
    assert cached["metadata"] == {"Link": "[[Target|id]]", "Other": "[[Other|two]]"}
