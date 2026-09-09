"""The graph reuses indexed file times and keeps full cached body-link data."""

import threading
from pathlib import Path
from types import SimpleNamespace

from backend.domains.graph import scanning, service
from backend.domains.graph.adapters import directed_graph
from backend.domains.vault.pages import index_service


def test_existing_index_is_scoped_to_vault_and_never_starts_discovery(monkeypatch, tmp_path):
    key = str(tmp_path)
    reads = []
    entry = {"path": str(tmp_path / "note.md"), "mtime": 1.0}
    dependencies = SimpleNamespace(
        index_initialized={key: True},
        index_entries={key: {"one": entry}},
        index_lock=threading.Lock(),
        load_from_disk=lambda vault_key: reads.append(vault_key) or False,
    )
    monkeypatch.setattr(index_service, "_dependencies", dependencies)
    assert index_service.get_available_page_entries(tmp_path) == [entry]
    other = tmp_path / "other"
    assert index_service.get_available_page_entries(other) is None
    assert reads == [str(other)]


def test_graph_filters_index_paths_like_the_filesystem_walker(monkeypatch, tmp_path):
    rows = [
        {"path": str(tmp_path / name), "mtime": 7.5}
        for name in (
            "Notes/one.md",
            "Mail/mail.md",
            ".gnosi/private.md",
            "Notes/.hidden.md",
            "photo.png",
        )
    ]
    rows.append({"path": str(tmp_path.parent / "outside.md"), "mtime": 2.0})
    monkeypatch.setattr(index_service, "get_available_page_entries", lambda _: rows)
    assert scanning.indexed_markdown_files(tmp_path) == [(tmp_path / "Notes/one.md", 7.5)]


def test_graph_cached_nodes_need_no_cloud_walk_stat_or_read(monkeypatch, tmp_path):
    path = tmp_path / "one.md"
    cached = {
        "mtime": 7.5,
        "id": "one",
        "title": "One",
        "kind": "page",
        "color": "#ffffff",
        "size": 8,
        "metadata": {"id": "one", "title": "One"},
        "links": ["Two"],
        "section_links": {"Deep body heading": ["Two"]},
    }
    monkeypatch.setattr(service.GraphService, "_NODE_DATA_CACHE", {str(path): cached})
    monkeypatch.setattr(service.GraphService, "_load_registry", lambda _: {})
    monkeypatch.setattr(
        service, "load_params", lambda **_: SimpleNamespace(paths={"VAULT": tmp_path})
    )
    monkeypatch.setattr(service, "_resolve_active_vault_path", lambda _: tmp_path)
    monkeypatch.setattr(service, "indexed_markdown_files", lambda _: [(path, 7.5)])

    def unexpected(*args, **kwargs):
        raise AssertionError("Cached graph touched the cloud filesystem")

    monkeypatch.setattr(service, "get_markdown_files_efficient", unexpected)
    monkeypatch.setattr(service.os.path, "getmtime", unexpected)
    monkeypatch.setattr(Path, "read_text", unexpected)
    graph = directed_graph()
    nodes, skipped = service.GraphService()._add_page_nodes(graph)
    assert skipped == []
    assert graph.nodes["one"]["label"] == "One"
    assert nodes[0]["section_links"] == {"Deep body heading": ["Two"]}


def test_foreign_legacy_index_falls_back_to_requested_vault_discovery(monkeypatch, tmp_path):
    monkeypatch.setattr(index_service, "get_available_page_entries", lambda _: [
        {"path": str(tmp_path.parent / "foreign.md"), "mtime": 1.0},
    ])
    assert scanning.indexed_markdown_files(tmp_path) is None
