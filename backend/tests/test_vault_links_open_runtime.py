"""Synthetic characterization of open Links values and compatibility binding."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace
from datetime import date
import json
from pathlib import Path
import threading
import time

import pytest

from backend.api import vault_routes as facade
from backend.domains.vault.links import document_cache, index_service, runtime
from backend.domains.vault.links.document_inventory import LinkableDocument
from backend.domains.vault.links.state import LinkIndexState
from backend.domains.vault.pages.foundation_values import PageMetadata
from backend.domains.vault.pages.index_entries import PageCacheEntry
from backend.services.context_vars import active_vault_path


class OpaqueTitle:
    def __str__(self) -> str:
        return "Opaque Title"


class NativeMetadata:
    def __init__(self, value: object) -> None:
        self.value = value
        self.keys: list[object] = []

    def get(self, key: object) -> object:
        self.keys.append(key)
        return self.value


def test_cache_dependencies_capture_storage_but_resolve_parser_late(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    cache: document_cache.ParsedDocumentCache = {}
    body: document_cache.BodyCache = {}
    lock = threading.Lock()
    metadata: PageMetadata = {7: object(), "date": date(2026, 8, 31)}
    monkeypatch.setattr(facade, "_parsed_doc_cache", cache)
    monkeypatch.setattr(facade, "_body_cache", body)
    monkeypatch.setattr(facade, "_parsed_doc_lock", lock)
    first_dir = lambda: tmp_path / "first"
    monkeypatch.setattr(facade, "resolve_data_dir", first_dir)
    dependencies = runtime._document_cache_dependencies()
    assert dependencies.parsed_cache is cache
    assert dependencies.body_cache is body
    assert dependencies.parsed_lock is lock
    assert dependencies.data_dir is first_dir

    def parser(raw: str, path: Path) -> tuple[PageMetadata, str]:
        assert path == tmp_path
        return metadata, raw

    monkeypatch.setattr(facade, "parse_frontmatter", parser)
    monkeypatch.setattr(facade, "resolve_data_dir", lambda: tmp_path / "later")
    parsed, text = dependencies.parse_frontmatter("raw", tmp_path)
    assert parsed is metadata
    assert text == "raw"
    assert dependencies.data_dir() == tmp_path / "first"


def test_document_service_is_resolved_before_dependency_factory(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    events: list[str] = []
    dependencies = runtime._document_cache_dependencies()

    def first(path: Path, ports: document_cache.DocumentCacheDependencies) -> str:
        assert path == tmp_path and ports is dependencies
        events.append("first")
        return "first"

    def later(path: Path, ports: document_cache.DocumentCacheDependencies) -> str:
        events.append("later")
        return "later"

    def factory() -> document_cache.DocumentCacheDependencies:
        events.append("factory")
        monkeypatch.setattr(document_cache, "body_for_path", later)
        return dependencies

    monkeypatch.setattr(document_cache, "body_for_path", first)
    monkeypatch.setattr(runtime, "_document_cache_dependencies", factory)
    assert runtime._get_body_for_path(tmp_path) == "first"
    assert events == ["factory", "first"]


def test_parsed_snapshot_is_shallow_and_keeps_opaque_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    marker = object()
    metadata: PageMetadata = {4: marker, "when": date(2026, 8, 31)}
    cache: document_cache.ParsedDocumentCache = {"page": (1, metadata, "raw")}
    monkeypatch.setattr(facade, "_parsed_doc_cache", cache)
    snapshot = runtime._read_parsed_doc_cache_snapshot()
    assert snapshot is not cache
    assert snapshot["page"] is cache["page"]
    assert snapshot["page"][1][4] is marker
    snapshot.clear()
    assert "page" in cache


@pytest.mark.parametrize("timestamp,refresh", [(100.0, False), (0.0, True)])
def test_id_title_cache_returns_copy_and_refreshes_only_stale(
    monkeypatch: pytest.MonkeyPatch,
    timestamp: float,
    refresh: bool,
) -> None:
    index = {"id": "title"}
    monkeypatch.setattr(runtime, "_id_title_cache", {"vault": {"index": index, "ts": timestamp}})
    monkeypatch.setattr(runtime, "_current_vault_key", lambda: "vault")
    monkeypatch.setattr(time, "time", lambda: 101.0)
    refreshed: list[str] = []
    monkeypatch.setattr(runtime, "_refresh_id_title_index", refreshed.append)
    result = runtime.build_id_title_index()
    assert result == index and result is not index
    result["id"] = "modified"
    assert index["id"] == "title"
    assert refreshed == (["vault"] if refresh else [])


def test_id_title_disk_preserves_raw_json_stringification(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    source = tmp_path / "titles.json"
    source.write_text('{"numeric": 7, "list": [1], "null": null}', encoding="utf-8")
    monkeypatch.setattr(runtime, "_get_id_title_cache_path", lambda _key: source)
    monkeypatch.setattr(runtime, "_id_title_cache", {})
    assert runtime._load_id_title_from_disk("vault") is True
    entry = runtime._id_title_cache["vault"]
    assert entry["index"] == {"numeric": "7", "list": "[1]", "null": "None"}
    assert entry["ts"] == 0.0
    source.write_text("[]", encoding="utf-8")
    assert runtime._load_id_title_from_disk("vault") is False
    assert runtime._id_title_cache["vault"] is entry


def test_refresh_restores_context_and_clears_guard_after_failure(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    callbacks: list[Callable[[], None]] = []

    class DeferredThread:
        def __init__(self, *, target: Callable[[], None], daemon: bool, name: str) -> None:
            assert daemon and name == "id-title-refresh"
            callbacks.append(target)

        def start(self) -> None:
            pass

    def broken_compute() -> dict[str, str]:
        assert active_vault_path.get() == tmp_path / "target"
        raise RuntimeError("synthetic parse failure")

    monkeypatch.setattr(threading, "Thread", DeferredThread)
    monkeypatch.setattr(runtime, "_id_title_refreshing", set())
    monkeypatch.setattr(runtime, "_compute_id_title_index", broken_compute)
    token = active_vault_path.set(tmp_path / "caller")
    try:
        key = str(tmp_path / "target")
        runtime._refresh_id_title_index(key)
        runtime._refresh_id_title_index(key)
        assert len(callbacks) == 1
        callbacks[0]()
        assert active_vault_path.get() == tmp_path / "caller"
        assert not runtime._id_title_refreshing
    finally:
        active_vault_path.reset(token)


def test_alias_index_keeps_native_get_and_malformed_errors(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    metadata = NativeMetadata([" Alpha ", 3])
    entry: PageCacheEntry = {"id": 7, "metadata": metadata}
    monkeypatch.setattr(facade, "get_active_vault_path", lambda: tmp_path)
    monkeypatch.setattr(facade, "_page_index_entries", {str(tmp_path): {"page": entry}})
    assert runtime._build_alias_index() == {"7": ["Alpha", "3"]}
    assert metadata.keys == ["aliases"]
    entry["metadata"] = ["invalid"]
    with pytest.raises(AttributeError, match="'list' object has no attribute 'get'"):
        runtime._build_alias_index()


def test_parsing_keeps_nonstring_yaml_keys_and_opaque_list_items() -> None:
    title = OpaqueTitle()
    metadata: PageMetadata = {7: [[title, 31]], "ignored": title}
    refs, kinds = runtime._extract_outlinks_with_kinds(metadata, "[[Opaque Title]] [[Body]]")
    assert refs == {"Opaque Title", "opaque title", "31", "Body", "body"}
    assert kinds["Opaque Title"] == "relation"
    assert kinds["body"] == "link"
    assert runtime._resolve_page_id_from_metadata({"migration_id": 19}, Path("fallback.md")) == "19"
    assert runtime._tokenize_body_for_mentions("Words [[hidden]] ```code``` END") == frozenset(
        {"words", "end"}
    )


def test_parsed_persistence_skips_only_non_json_values(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    marker = object()
    cache: document_cache.ParsedDocumentCache = {
        "date": (1, {"date": date(2026, 8, 31)}, "date"),
        "opaque": (2, {"opaque": marker}, "opaque"),
        "valid": (3, {7: [1, None]}, "valid"),
        "nan": (4, {"nan": float("nan")}, "nan"),
    }
    monkeypatch.setattr(facade, "_parsed_doc_cache", cache)
    monkeypatch.setattr(facade, "get_p", lambda _key: tmp_path / "page-index.json")
    runtime._save_parsed_doc_cache_to_disk()
    payload: object = json.loads((tmp_path / "vault_parsed_doc_cache.json").read_text())
    assert payload == {"valid": {"mtime_ns": 3, "metadata": {"7": [1, None]}, "body": "valid"}}
    assert cache["opaque"][1]["opaque"] is marker
    assert len(cache) == 4


def test_parsed_disk_narrowing_preserves_boolean_mtime_and_body_conversion(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    source = tmp_path / "vault_parsed_doc_cache.json"
    source.write_text(
        json.dumps(
            {
                "valid": {"mtime_ns": True, "metadata": {"raw": [1]}, "body": [2]},
                "zero": {"mtime_ns": 0, "metadata": {}},
                "bad": {"mtime_ns": 1, "metadata": []},
            }
        )
    )
    cache: document_cache.ParsedDocumentCache = {"old": (2, {}, "old")}
    monkeypatch.setattr(facade, "_parsed_doc_cache", cache)
    monkeypatch.setattr(facade, "get_p", lambda _key: tmp_path / "page-index.json")
    assert runtime._load_parsed_doc_cache_from_disk()
    assert cache == {"valid": (True, {"raw": [1]}, "[2]")}
    assert facade._parsed_doc_cache is cache


def test_index_rebuild_preserves_state_containers_and_closed_terms(
    tmp_path: Path,
) -> None:
    state = LinkIndexState()
    view = state.view()
    documents: list[LinkableDocument] = [
        (tmp_path / "a.md", {"id": "a", "title": OpaqueTitle(), 1: ["b"]}, "words", False),
        (tmp_path / "b.md", {"id": "b", "title": "Bee"}, "", False),
    ]
    ports = replace(runtime._LINK_INDEX_DEPENDENCIES, iter_documents=lambda: documents)
    index_service.rebuild_link_index(state, ports, persist=False)
    assert state.outlinks_by_source is view.outlinks_by_source
    assert state.tokens_by_source is view.tokens_by_source
    assert state.page_meta_by_id is view.page_meta_by_id
    assert state.backlinks_by_target is view.backlinks_by_target
    assert state.backlinks_by_target["b"] == [
        {"id": "a", "title": "Opaque Title", "kind": "relation"}
    ]
    snapshot, built_at = index_service.get_link_index_terms(["a"], state.view, lambda: False)
    assert snapshot == {"a": (frozenset({"words"}), frozenset({"a", "Opaque Title", "b", "Bee"}))}
    assert built_at == state.build_ts


def test_api_capture_and_late_resolvers_are_not_rebound(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = runtime._LINK_API_DEPENDENCIES.parse_frontmatter
    captured_writer = runtime._LINK_INDEX_DEPENDENCIES.write_json
    rebuilds: list[bool] = []
    monkeypatch.setattr(facade, "parse_frontmatter", lambda _raw, _path: ({}, "new"))
    monkeypatch.setattr(facade, "safe_write_json", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(facade, "kickoff_link_index_rebuild", lambda: rebuilds.append(True))
    assert runtime._LINK_API_DEPENDENCIES.parse_frontmatter is captured
    assert runtime._LINK_INDEX_DEPENDENCIES.write_json is captured_writer
    runtime._LINK_API_DEPENDENCIES.resolve_kickoff_rebuild()()
    assert rebuilds == [True]


def test_inverse_write_preserves_open_metadata_and_cache_identity(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    path = tmp_path / "target.md"
    path.write_text("body")
    marker = object()
    metadata: PageMetadata = {7: marker, "ÀREES": ["existing"]}
    entries: dict[str, dict[str, PageCacheEntry]] = {}
    paths: dict[str, dict[object, str]] = {}
    entry: PageCacheEntry = {"id": 31, "metadata": metadata}
    events: list[str] = []

    def save(saved_path: Path, saved_metadata: PageMetadata, body: str) -> None:
        assert saved_path == path and saved_metadata is metadata and body == "body"
        events.append("save")

    monkeypatch.setattr(facade, "find_page_path", lambda _id: path)
    monkeypatch.setattr(facade, "parse_frontmatter", lambda _raw, _path: (metadata, "body"))
    monkeypatch.setattr(facade, "save_page_md", save)
    monkeypatch.setattr(runtime, "update_link_index_for_page", lambda _path: events.append("links"))
    monkeypatch.setattr(facade, "get_active_vault_path", lambda: tmp_path)
    monkeypatch.setattr(facade, "_build_page_cache_entry", lambda _path, _stat: entry)
    monkeypatch.setattr(facade, "_page_index_entries", entries)
    monkeypatch.setattr(facade, "_page_id_to_path", paths)
    monkeypatch.setattr(facade, "_bump_page_index_version", lambda _key: events.append("version"))
    assert runtime._apply_inverse_relation_change("target", "àrees", "host", "add")
    assert metadata[7] is marker
    assert metadata["ÀREES"] == ["existing", "host"]
    assert entries[str(tmp_path)][str(path)] is entry
    assert paths == {str(tmp_path): {"31": str(path)}}
    assert events == ["save", "links", "version"]
    assert not runtime._apply_inverse_relation_change("target", "àrees", "host", "add")
    assert events == ["save", "links", "version"]
