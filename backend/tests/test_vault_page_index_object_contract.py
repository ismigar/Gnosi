"""Synthetic contracts for open metadata inside string-keyed page-index entries."""

from __future__ import annotations

import errno
import logging
import os
from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path
from threading import Lock

import pytest
from fastapi import BackgroundTasks

from backend.domains.vault.pages import index_entries, index_service, resolver, tags
from backend.domains.vault.pages.index_entries import Metadata, PageCacheEntry
from backend.domains.vault.registry.records import is_record
from backend.domains.vault.registry.state import RegistryData
from backend.domains.vault.schemas.pages import PageInfo


def _index_dependencies(root: Path) -> index_service.PageIndexDependencies:
    return index_service.PageIndexDependencies(
        active_vault_path=lambda: root,
        get_path=lambda name: root / name,
        load_from_disk=lambda key: False,
        save_to_disk=lambda key: None,
        build_entry=lambda path, stat: {},
        build_entry_from_memory=lambda path, stat, metadata, body: {},
        is_metadata_stub=index_entries.is_metadata_stub,
        vault_cache_key=lambda: "synthetic",
        cache_get=lambda key: None,
        cache_set=lambda key, pages: None,
        load_registry=lambda: {},
        table_vault_dir=lambda table, registry: None,
        build_table_folder_index=lambda registry: {},
        resolve_table_id=lambda metadata, folder, index, ordered: None,
        enabled_calendar_tables=lambda: [],
        hidden_event_ids=set,
        update_path_resolver=lambda root, ids, paths: None,
        get_last_vault_sync=lambda: 0.0,
        set_last_vault_sync=lambda value: None,
        index_lock=Lock(),
        index_entries={},
        index_initialized={},
        id_to_path={},
        index_version={},
        body_cache_lock=Lock(),
        body_cache={},
        last_stale_check={"ts": 0.0},
        vault_sync_cooldown_seconds=600.0,
        stale_check_ttl=30.0,
        logger=logging.getLogger(__name__),
    )


def _entry(metadata: object) -> PageCacheEntry:
    return {
        "id": "synthetic-id",
        "title": "Synthetic",
        "parent_id": None,
        "is_database": False,
        "metadata": metadata,
        "mtime": 1.0,
        "created_mtime": 1.0,
        "size": 4,
        "folder": "BD/Synthetic",
        "path": None,
    }


def test_calendar_snapshot_does_not_schedule_obsolete_remote_mirror(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    dependencies = replace(
        _index_dependencies(tmp_path),
        get_last_vault_sync=lambda: 0.0,
    )
    monkeypatch.setattr(index_service, "_dependencies", dependencies)
    monkeypatch.setattr(index_service.time, "monotonic", lambda: 1_000.0)
    background_tasks = BackgroundTasks()

    index_service._schedule_background_syncs(
        background_tasks,
        [tmp_path / "Calendar"],
    )

    assert len(background_tasks.tasks) == 1
    assert background_tasks.tasks[0].func is index_service.get_cached_page_entries


def _page(metadata: Metadata, page_id: str = "synthetic-id") -> PageInfo:
    # This is the same internal construction boundary as the index; HTTP model
    # validation remains separately owned and must not be bypassed by production.
    return PageInfo.model_construct(
        id=page_id, title="Synthetic", metadata=metadata, last_modified="2026-01-01", size=4
    )


@pytest.mark.parametrize("from_memory", [False, True])
def test_entry_preserves_open_keys_and_existing_copy_boundary(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, from_memory: bool
) -> None:
    key = object()
    extension: list[object] = [object()]
    metadata: Metadata = {"id": "synthetic-id", "data": "2026-01-01", key: extension}
    processed: list[Metadata] = []

    def process(value: Metadata) -> Metadata:
        processed.append(value)
        return value

    dependencies = index_entries.PageIndexEntryDependencies(
        parse_frontmatter=lambda content, path: (metadata, "Body"),
        is_dashboard_file=lambda path: False,
        read_dashboard_file=lambda path: ({}, ""),
        process_metadata_paths=process,
        vault_root=lambda: tmp_path,
        logger=logging.getLogger(__name__),
    )
    monkeypatch.setattr(index_entries, "_dependencies", dependencies)
    path = tmp_path / "synthetic.md"
    path.write_text("---\nid: synthetic-id\n---\nBody", encoding="utf-8")
    if from_memory:
        entry = index_entries.build_cache_entry_from_memory(path, path.stat(), metadata, "Body")
    else:
        entry = index_entries.build_page_cache_entry(path, path.stat())
    nested = entry["metadata"]
    assert is_record(nested)
    assert all(isinstance(envelope_key, str) for envelope_key in entry)
    assert nested[key] is extension
    assert nested["date"] == "2026-01-01"
    assert nested["description"] == "Body"
    assert nested is not processed[0]
    assert (processed[0] is metadata) is not from_memory
    assert ("date" in metadata) is not from_memory


def test_partial_read_retains_bound_and_metadata_identity(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    path = tmp_path / "synthetic.md"
    body_lines = [f"body-{number}\n" for number in range(80)]
    header = "---\nid: synthetic-id\n---\n"
    path.write_text(header + "".join(body_lines), encoding="utf-8")
    metadata: Metadata = {7: object(), "id": "synthetic-id"}
    parsed: list[str] = []

    def parse(content: str, file_path: Path) -> tuple[Metadata, str]:
        assert file_path == path
        parsed.append(content)
        return metadata, "Body"

    monkeypatch.setattr(
        index_entries,
        "_dependencies",
        index_entries.PageIndexEntryDependencies(
            parse_frontmatter=parse,
            is_dashboard_file=lambda path: False,
            read_dashboard_file=lambda path: ({}, ""),
            process_metadata_paths=lambda value: value,
            vault_root=lambda: tmp_path,
            logger=logging.getLogger(__name__),
        ),
    )
    result, body = index_entries.read_frontmatter_partial(path)
    assert result is metadata and body == "Body"
    assert parsed == [header + "".join(body_lines[:60])]


def test_snapshot_keeps_metadata_identity_and_cache_hit_short_circuit(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    key = object()
    metadata: Metadata = {key: object(), "tags": "alpha", "table_id": "table"}
    entry = _entry(metadata)
    calls: list[str] = []
    cached: list[PageInfo] | None = None
    registry: RegistryData = {key: object()}

    def load_registry() -> RegistryData:
        calls.append("registry")
        return registry

    def folders(value: RegistryData) -> dict[str, str]:
        assert value is registry
        calls.append("folders")
        return {"BD/Synthetic": "table"}

    def resolve(
        value: Metadata, folder: str, index: dict[str, str], ordered: list[str] | None
    ) -> str:
        assert value is metadata
        assert ordered == ["BD/Synthetic"]
        calls.append("resolve")
        return "table"

    def cache_get(cache_key: str) -> list[PageInfo] | None:
        assert cache_key == "snapshot:synthetic:all"
        calls.append("get")
        return cached

    def cache_set(cache_key: str, pages: list[PageInfo]) -> None:
        nonlocal cached
        assert cache_key == "snapshot:synthetic:all"
        calls.append("set")
        cached = pages

    dependencies = replace(
        _index_dependencies(tmp_path),
        load_registry=load_registry,
        build_table_folder_index=folders,
        resolve_table_id=resolve,
        cache_get=cache_get,
        cache_set=cache_set,
    )
    dependencies.index_initialized[str(tmp_path)] = True
    dependencies.index_entries[str(tmp_path)] = {"synthetic.md": entry}
    monkeypatch.setattr(index_service, "_dependencies", dependencies)
    pages = index_service.get_pages_snapshot()
    assert pages[0].metadata is metadata
    assert index_service.get_pages_snapshot() is pages
    assert calls == ["get", "registry", "folders", "resolve", "set", "get"]
    assert dependencies.index_entries[str(tmp_path)]["synthetic.md"] is entry


def test_refresh_updates_existing_cache_object_without_losing_extension_keys(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    path = tmp_path / "synthetic.md"
    path.write_text("Synthetic", encoding="utf-8")
    metadata: Metadata = {11: object(), "id": "synthetic-id"}
    rebuilt = _entry(metadata)
    rebuilt["title"] = "Refreshed"
    old = _entry({"id": "synthetic-id"})
    old["cache-extension"] = object()
    extension = old["cache-extension"]
    dependencies = replace(_index_dependencies(tmp_path), build_entry=lambda path, stat: rebuilt)
    dependencies.index_entries[str(tmp_path)] = {str(path): old}
    monkeypatch.setattr(index_service, "_dependencies", dependencies)
    page = _page({"id": "synthetic-id"})
    page.path = str(path)
    index_service.refresh_table_pages_metadata([page])
    assert page.metadata is metadata
    assert page.title == "Refreshed"
    assert dependencies.index_entries[str(tmp_path)][str(path)] is old
    assert old["metadata"] is metadata
    assert old["cache-extension"] is extension
    assert dependencies.index_version[str(tmp_path)] == 1


def test_failed_parse_preserves_good_cached_entry(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    path = tmp_path / "synthetic.md"
    path.write_text("Synthetic", encoding="utf-8")
    metadata: Metadata = {99: object(), "id": "synthetic-id"}
    cached = _entry(metadata)
    failed: PageCacheEntry = {"_parse_failed": True}
    dependencies = replace(_index_dependencies(tmp_path), build_entry=lambda path, stat: failed)
    monkeypatch.setattr(index_service, "_dependencies", dependencies)
    result = index_service._updated_entries([path], tmp_path, {str(path): cached})
    assert result[str(path)] is cached
    assert cached["metadata"] is metadata
    assert "_parse_failed" not in failed


class _NumericValue:
    def __init__(self, events: list[str], label: str) -> None:
        self.events = events
        self.label = label

    def __bool__(self) -> bool:
        self.events.append(f"bool:{self.label}")
        return True

    def __float__(self) -> float:
        self.events.append(f"float:{self.label}")
        return 1.0

    def __int__(self) -> int:
        self.events.append(f"int:{self.label}")
        return 4


def test_snapshot_native_numeric_protocol_and_callback_order(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    events: list[str] = []

    def resolve(
        metadata: Metadata, folder: str, index: dict[str, str], ordered: list[str] | None
    ) -> None:
        events.append("resolve")

    monkeypatch.setattr(
        index_service,
        "_dependencies",
        replace(_index_dependencies(tmp_path), resolve_table_id=resolve),
    )
    entry = _entry({17: object()})
    entry["mtime"] = _NumericValue(events, "modified")
    entry["created_mtime"] = _NumericValue(events, "created")
    entry["size"] = _NumericValue(events, "size")
    _, _, page = index_service._page_from_entry(entry, {}, [])
    assert page.size == 4
    assert events == ["resolve", "float:modified", "bool:created", "float:created", "int:size"]


@pytest.mark.parametrize(
    "key,value,operation",
    [
        ("mtime", None, float),
        ("mtime", "invalid", float),
        ("size", None, int),
        ("size", "invalid", int),
    ],
)
def test_snapshot_retains_native_conversion_errors(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    key: str,
    value: object,
    operation: type[float] | type[int],
) -> None:
    monkeypatch.setattr(index_service, "_dependencies", _index_dependencies(tmp_path))
    entry = _entry({})
    entry[key] = value
    # Evaluate only this fixed test-owned expression to compare the native
    # opaque-input call, including its exact exception class and message.
    with pytest.raises((TypeError, ValueError)) as expected:
        eval("operation(value)", {"operation": operation, "value": value})
    with pytest.raises(type(expected.value)) as actual:
        index_service._page_from_entry(entry, {}, [])
    assert str(actual.value) == str(expected.value)


class _TableList(list[object]):
    def __init__(self, table: RegistryData, events: list[str]) -> None:
        super().__init__([table])
        self.events = events

    def __iter__(self) -> Iterator[object]:
        self.events.append("iterate")
        return super().__iter__()


def test_calendar_retains_table_registry_identity_and_list_protocol(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    events: list[str] = []
    table: RegistryData = {"id": "table", 21: object()}
    registry: RegistryData = {"tables": _TableList(table, events), 19: object()}

    def enabled() -> list[str]:
        events.append("enabled")
        return ["table"]

    def get_path(name: str) -> Path:
        events.append(name)
        return tmp_path / name

    def table_dir(value: RegistryData, data: RegistryData) -> Path:
        assert value is table and data is registry
        events.append("table")
        return tmp_path / "table"

    monkeypatch.setattr(
        index_service,
        "_dependencies",
        replace(
            _index_dependencies(tmp_path),
            enabled_calendar_tables=enabled,
            get_path=get_path,
            table_vault_dir=table_dir,
        ),
    )
    assert index_service._calendar_scope(True, registry) == (
        [tmp_path / "CALENDAR", tmp_path / "table"],
        {"table"},
    )
    assert events == ["enabled", "CALENDAR", "iterate", "table"]


@pytest.mark.parametrize("raw", [None, "tables", 7, ({"id": "table"},)])
def test_calendar_keeps_existing_list_only_guard(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, raw: object
) -> None:
    monkeypatch.setattr(index_service, "_dependencies", _index_dependencies(tmp_path))
    assert index_service._calendar_scope(True, {"tables": raw}) == ([tmp_path / "CALENDAR"], set())


def test_calendar_does_not_sanitize_unhashable_table_id(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(index_service, "_dependencies", _index_dependencies(tmp_path))
    with pytest.raises(TypeError, match="unhashable type"):
        index_service._calendar_scope(True, {"tables": [{"id": []}]})


def test_tags_pass_open_records_without_copy_and_keep_response_envelope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    table: RegistryData = {"id": "table", 7: object()}
    metadata: Metadata = {13: object(), "tags": ["alpha"], "labels": "beta, alpha"}
    prop: RegistryData = {"id": "labels", "name": "Labels", 23: object()}

    def find_role(value: RegistryData, role: str) -> RegistryData:
        assert value is table and role == "tags"
        events.append("role")
        return prop

    def table_id(value: Metadata) -> str:
        assert value is metadata
        events.append("table-id")
        return "table"

    dependencies = tags.TagQueryDependencies(
        page_snapshot=lambda: [],
        load_registry=lambda: {"tables": _TableList(table, events)},
        find_role_property=find_role,
        tags_role="tags",
        table_id=table_id,
    )
    monkeypatch.setattr(tags, "_dependencies", dependencies)
    result = tags.aggregate_tags([_page(metadata)])
    assert result == {
        "tags": [
            {"name": name, "count": 1, "pages": [{"id": "synthetic-id", "title": "Synthetic"}]}
            for name in ["alpha", "beta"]
        ]
    }
    assert events == ["iterate", "role", "table-id"]


def test_resolver_cold_scan_receives_open_metadata_and_keeps_cached_path(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    path = tmp_path / "synthetic.md"
    path.write_text("Synthetic body", encoding="utf-8")
    raw_id = object()
    metadata: Metadata = {"id": raw_id, 27: object()}
    events: list[str] = []

    def parse(content: str, file_path: Path) -> tuple[Metadata, str]:
        assert content == "Synthetic body" and file_path == path
        events.append("parse")
        return metadata, content

    def canonicalize(value: object) -> str:
        events.append("canonicalize-input" if value == "requested" else "canonicalize-raw")
        assert value == "requested" or value is raw_id
        return "canonical"

    dependencies = resolver.PageResolverDependencies(
        active_vault_path=lambda: tmp_path,
        get_path=lambda name: tmp_path,
        path_factory=Path,
        parse_frontmatter=parse,
        canonicalize_id=canonicalize,
        bump_index_version=lambda key: None,
        set_last_vault_sync=lambda value: None,
        monotonic=lambda: 0.0,
        stale_check_ttl=30.0,
        last_stale_check={"ts": 0.0},
        index_lock=Lock(),
        index_entries={},
        index_initialized={},
        id_to_path={},
        logger=logging.getLogger(__name__),
    )
    monkeypatch.setattr(resolver, "_dependencies", dependencies)
    assert resolver.find_page_path("requested") == path
    assert events == ["canonicalize-input", "parse", "canonicalize-raw"]
    events.clear()
    assert resolver.find_page_path("requested") == path
    assert events == ["canonicalize-input"]
    assert dependencies.id_to_path[str(tmp_path)]["requested"] == str(path)


def test_resolver_retains_indexed_path_during_transient_provider_stat(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    page = tmp_path / "cloud-page.md"
    page.write_text("Body", encoding="utf-8")
    vault_key = str(tmp_path)
    entry = _entry({"id": "page"})
    entry["path"] = str(page)
    bumps: list[str] = []
    dependencies = resolver.PageResolverDependencies(
        active_vault_path=lambda: tmp_path,
        get_path=lambda _name: tmp_path,
        path_factory=Path,
        parse_frontmatter=lambda _content, _path: ({}, ""),
        canonicalize_id=lambda value: str(value),
        bump_index_version=bumps.append,
        set_last_vault_sync=lambda _value: None,
        monotonic=lambda: 100.0,
        stale_check_ttl=30.0,
        last_stale_check={"ts": 0.0},
        index_lock=Lock(),
        index_entries={vault_key: {str(page): entry}},
        index_initialized={vault_key: True},
        id_to_path={vault_key: {"page": str(page)}},
        logger=logging.getLogger(__name__),
    )
    monkeypatch.setattr(resolver, "_dependencies", dependencies)
    original_stat = Path.stat

    def transient_stat(
        candidate: Path,
        *,
        follow_symlinks: bool = True,
    ) -> os.stat_result:
        if candidate == page:
            raise OSError(errno.EDEADLK, "synthetic File Provider contention")
        return original_stat(candidate, follow_symlinks=follow_symlinks)

    monkeypatch.setattr(Path, "stat", transient_stat)

    assert resolver.find_page_path("page") == page
    assert dependencies.id_to_path[vault_key]["page"] == str(page)
    assert dependencies.index_entries[vault_key][str(page)] is entry
    assert bumps == []


def test_compatibility_aliases_keep_same_callables() -> None:
    assert index_entries._build_page_cache_entry is index_entries.build_page_cache_entry
    assert (
        index_entries._build_cache_entry_from_memory is index_entries.build_cache_entry_from_memory
    )
    assert index_service._get_pages_snapshot is index_service.get_pages_snapshot
    assert resolver._find_page_path is resolver.find_page_path
    assert resolver.PageCacheEntry == index_entries.PageCacheEntry == index_service.PageCacheEntry
