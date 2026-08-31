"""Synthetic compatibility cases for the object-keyed registry consumers."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import replace
from datetime import datetime
from operator import methodcaller
from pathlib import Path

import pytest
from pydantic import ValidationError

from backend.domains.vault.assets import persistence, quarantine, table_paths
from backend.domains.vault.pages.index_entries import PageCacheEntry
from backend.domains.vault.registry.state import RegistryData
from backend.domains.vault.schemas.pages import PageInfo
from backend.domains.vault.tables import api as collections
from backend.domains.vault.tables import lifecycle, options, rows, schema
from backend.domains.vault.views import api as views
from backend.domains.vault.views import snapshots


class LegacySequence:
    """An iterable supported by Python without an __iter__ method."""

    def __init__(self, values: list[object], calls: list[str]) -> None:
        self.values = values
        self.calls = calls

    def __getitem__(self, index: int) -> object:
        self.calls.append(f"item:{index}")
        return self.values[index]

    def __len__(self) -> int:
        self.calls.append("length")
        return len(self.values)


READERS: tuple[Callable[[RegistryData, str], list[RegistryData]], ...] = (
    persistence._registry_items,
    table_paths._registry_items,
    snapshots._registry_items,
    lifecycle._registry_items,
    options._registry_items,
    lambda registry, key: views._registry_views(registry),
)


@pytest.mark.parametrize("reader", READERS)
@pytest.mark.parametrize("kind", ["list", "tuple", "legacy"])
def test_registry_readers_keep_record_and_key_identity(
    reader: Callable[[RegistryData, str], list[RegistryData]],
    kind: str,
) -> None:
    key, value = object(), object()
    record: RegistryData = {key: value, "id": "one"}
    calls: list[str] = []
    items: list[object] = [None, record, "ignored"]
    source: object = items if kind == "list" else tuple(items)
    if kind == "legacy":
        source = LegacySequence(items, calls)
    registry: RegistryData = {"views": source}
    result = reader(registry, "views")
    assert len(result) == 1 and result[0] is record
    assert next(iter(result[0])) is key and result[0][key] is value
    if kind == "legacy":
        assert calls == ["item:0", "item:1", "item:2", "item:3"]


@pytest.mark.parametrize("reader", READERS)
@pytest.mark.parametrize("value", [None, 42])
def test_registry_readers_preserve_native_iteration_errors(
    reader: Callable[[RegistryData, str], list[RegistryData]],
    value: object,
) -> None:
    with pytest.raises(TypeError, match="not iterable"):
        reader({"views": value}, "views")


@pytest.mark.parametrize("reader", READERS)
def test_registry_readers_enter_native_iterator_once(
    reader: Callable[[RegistryData, str], list[RegistryData]],
) -> None:
    calls: list[str] = []
    record: RegistryData = {"id": "one"}

    class ObservedIterator:
        def __init__(self) -> None:
            self.pending = True

        def __iter__(self) -> ObservedIterator:
            calls.append("iter")
            return self

        def __next__(self) -> object:
            calls.append("next")
            if not self.pending:
                raise StopIteration
            self.pending = False
            return record

    assert reader({"views": ObservedIterator()}, "views") == [record]
    assert calls == ["iter", "next", "next"]


def test_alias_copy_preserves_native_length_and_index_protocols() -> None:
    calls: list[str] = []
    marker = object()
    aliases = LegacySequence([marker, "Former"], calls)
    incoming_property: RegistryData = {"id": "field"}
    lifecycle._preserve_property_aliases(
        {"properties": [{"id": "field", "aliases": aliases}]},
        {"properties": [incoming_property]},
    )
    assert incoming_property["aliases"] == [marker, "Former"]
    assert calls == ["length", "length", "item:0", "item:1", "item:2"]


def test_alias_membership_uses_legacy_sequence_without_conversion() -> None:
    calls: list[str] = []
    prop: RegistryData = {"name": "Current", "aliases": LegacySequence(["Old"], calls)}
    assert table_paths._find_table_property({"properties": (prop,)}, "Old") is prop
    assert calls == ["length", "item:0"]


@pytest.mark.parametrize("root", [None, False, 7, 2.5, "text", [], [1]])
def test_json_root_preserves_native_get_error(tmp_path: Path, root: object) -> None:
    candidate = tmp_path / "in-progress-fixture"
    candidate.mkdir()
    (candidate / "_manifest.json").write_text(json.dumps(root), encoding="utf-8")
    assert quarantine._read_manifest(candidate / "_manifest.json") == root
    with pytest.raises(AttributeError, match="has no attribute 'get'"):
        quarantine._quarantine_table_id(candidate)
    with pytest.raises(AttributeError, match="has no attribute 'get'"):
        quarantine._restore_abandoned_table_asset_quarantine(candidate, tmp_path)
    assert candidate.exists()


@pytest.fixture
def configured() -> None:
    # Composition runs only inside verify_typed_drawings' synthetic runtime.
    from backend.api import vault_routes

    assert vault_routes.table_domain_dependencies is not None


@pytest.mark.parametrize("entry", [None, 8, [], "entry", {}])
def test_malformed_manifest_entries_remain_recoverable(
    configured: None,
    tmp_path: Path,
    entry: object,
) -> None:
    candidate = tmp_path / "in-progress-fixture"
    candidate.mkdir()
    assert quarantine._planned_restore_moves({"entries": [entry]}, candidate, tmp_path) is None
    assert candidate.exists()


def test_collection_keeps_lock_order_and_database_identity() -> None:
    calls: list[str] = []
    marker = object()
    database: RegistryData = {"id": "new", marker: marker}
    entries: list[object] = ["extension", {"id": "old"}]
    registry: RegistryData = {"databases": entries}

    @contextmanager
    def mutation() -> Iterator[None]:
        calls.append("enter")
        try:
            yield
        finally:
            calls.append("exit")

    def load() -> RegistryData:
        calls.append("load")
        return registry

    def save(value: RegistryData) -> None:
        assert value is registry and value["databases"] is entries
        calls.append("save")

    dependencies = collections.TableCollectionDependencies(load, save, mutation, lambda _: (0, ""))
    assert asyncio.run(collections.create_database(database, dependencies)) is database
    assert calls == ["enter", "load", "save", "exit"]
    assert entries[0] == "extension" and entries[-1] is database


def test_asset_metadata_key_reaches_callback_unchanged(
    configured: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    key = object()
    seen: list[object] = []

    def normalize(value: object) -> str:
        seen.append(value)
        return "field"

    monkeypatch.setattr(
        persistence, "_dependencies", replace(persistence._deps(), normalize_schema_key=normalize)
    )
    assert persistence._metadata_asset_key({key: object()}, "Field") is key
    assert seen == ["Field", key]


def test_nested_asset_mapping_keeps_unknown_keys_and_values(
    configured: None,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    key, extension = object(), object()
    source: RegistryData = {key: extension, "path": "old"}
    calls: list[object] = []

    def persist(value: object, path: Path) -> object:
        calls.append(value)
        assert path is tmp_path
        return "new"

    monkeypatch.setattr(
        persistence, "_dependencies", replace(persistence._deps(), persist_value=persist)
    )
    result = persistence._persist_asset_value(source, tmp_path)
    assert isinstance(result, dict)
    assert result is not source and result[key] is extension
    assert next(iter(result)) is key and source["path"] == "old"
    assert result["path"] == "new" and calls == ["old"]


def test_property_rename_keeps_object_keys_and_nested_identity() -> None:
    key, value = object(), object()
    filter_node: RegistryData = {"field": "Old", key: value}
    widths: RegistryData = {"Old": 60, key: value}
    section: RegistryData = {
        "columns": ["Old", value],
        "filters": [filter_node],
        "columnWidths": widths,
    }
    page: RegistryData = {"sections": [section]}
    registry: RegistryData = {"pages": {key: page}, "views": []}
    assert schema.propagate_property_rename(registry, "table", "Old", "New") == 1
    assert section["filters"] == [filter_node] and filter_node["field"] == "New"
    assert widths[key] is value and widths["New"] == 60 and "Old" not in widths
    assert section["columns"] == ["New", value]


def test_option_catalog_raw_value_is_forwarded(
    configured: None,
) -> None:
    from backend.domains.vault.tables.legacy_composition import table_option_dependencies

    raw = object()
    seen: list[object] = []

    def get_options(prop: RegistryData, catalog: object) -> list[RegistryData]:
        seen.append(catalog)
        return []

    dependencies = replace(table_option_dependencies, get_prop_options=get_options)
    assert options._status_options({"option_catalogs": raw}, dependencies) == []
    assert seen == [raw]


def test_snapshot_joins_reach_owner_with_malformed_items(
    configured: None,
) -> None:
    from backend.domains.vault.tables.legacy_composition import vault_view_snapshot_dependencies

    raw: list[object] = [None, {"tableId": "right"}]
    view: RegistryData = {"id": "view", "table_id": "left", "joins": raw}
    seen: list[object] = []

    def joins(
        values: list[RegistryData],
        definitions: list[object],
        loader: Callable[[str], list[RegistryData]],
    ) -> list[RegistryData]:
        seen.append(definitions)
        return values

    dependencies = replace(
        vault_view_snapshot_dependencies,
        load_registry=lambda: {"views": (view,)},
        pages_for_table=lambda _: [],
        table_by_id=lambda _: None,
        apply_joins=joins,
    )
    resolved, values = snapshots.resolve_view_and_candidates("view", None, dependencies)
    assert resolved is view and values == []
    assert len(seen) == 1 and seen[0] is raw


def test_row_numeric_protocols_and_metadata_values(configured: None) -> None:
    from backend.domains.vault.tables.legacy_composition import table_row_query_dependencies

    calls: list[str] = []

    class Modified:
        def __float__(self) -> float:
            calls.append("float")
            return 1.0

    class Size:
        def __index__(self) -> int:
            calls.append("index")
            return 8

    key, value = "custom", object()
    metadata: RegistryData = {key: value}
    entry: PageCacheEntry = {
        "metadata": metadata,
        "mtime": Modified(),
        "id": "row",
        "title": "Row",
        "size": Size(),
    }
    dependencies = replace(
        table_row_query_dependencies, humanize_title=lambda title, md: str(title)
    )
    page = rows._page_from_entry(entry, "table", dependencies)
    assert page.metadata[key] is value and page.size == 8
    assert calls == ["float", "index"]


@pytest.mark.parametrize(
    "metadata", [{1: "number"}, {b"key": "bytes"}, {"key": object()}, "scalar", 42, None, []]
)
@pytest.mark.parametrize(
    "parent,path", [(None, None), ("parent", "row.md"), (7, []), (b"parent", b"row.md")]
)
def test_row_boundary_matches_page_constructor(
    configured: None,
    metadata: object,
    parent: object,
    path: object,
) -> None:
    from backend.domains.vault.tables.legacy_composition import table_row_query_dependencies

    entry: PageCacheEntry = {
        "id": "row",
        "title": "Row",
        "metadata": metadata,
        "mtime": 1.0,
        "size": 8,
        "parent_id": parent,
        "path": path,
    }
    dependencies = replace(
        table_row_query_dependencies, humanize_title=lambda title, md: str(title)
    )
    fields: dict[str, object] = {
        "id": "row",
        "title": "Row",
        "parent_id": parent,
        "path": path,
        "is_database": False,
        "metadata": metadata if isinstance(metadata, dict) else {},
        "last_modified": datetime.fromtimestamp(1).isoformat(),
        "created_time": datetime.fromtimestamp(1).isoformat(),
        "size": 8,
        "folder": "",
        "resolved_table_id": "table",
    }
    # Call the actual constructor with opaque inputs, without asserting their shape.
    expected = PageInfo.__new__(PageInfo)
    try:
        methodcaller("__init__", **fields)(expected)
    except ValidationError as error:
        with pytest.raises(ValidationError) as actual:
            rows._page_from_entry(entry, "table", dependencies)
        assert actual.value.errors() == error.errors()
    else:
        actual_page = rows._page_from_entry(entry, "table", dependencies)
        assert actual_page.model_dump() == expected.model_dump()


def test_owned_routes_emit_openapi_evidence(configured: None) -> None:
    from fastapi import FastAPI
    from backend.domains.vault.tables import routes

    app = FastAPI()
    app.include_router(routes.router)
    target = Path(__file__).resolve().parents[2] / ".tmp" / "consumer-openapi-current.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(app.openapi(), sort_keys=True, indent=2), encoding="utf-8")
    assert len(app.openapi()["paths"]) == 15


def test_route_payloads_preserve_direct_records_and_extension_values(configured: None) -> None:
    from backend.domains.vault.tables import routes
    from backend.domains.vault.views.contracts import VaultViewInput, ViewReorderRequest

    key, value = object(), object()
    raw: RegistryData = {key: value, "id": "view"}
    assert routes._view_payload(raw) is raw
    assert routes._view_reorder_payload(raw) is raw
    view = VaultViewInput.model_validate({"id": "view", "extension": value})
    serialized = routes._view_payload(view)
    assert serialized == view.model_dump(exclude_unset=True)
    assert serialized["extension"] is value
    order = ViewReorderRequest(table_id="table", ordered_ids=["second", "first"])
    assert routes._view_reorder_payload(order) == order.model_dump()


def test_snapshot_host_object_reaches_row_resolver_unchanged(configured: None) -> None:
    from backend.domains.vault.tables.legacy_composition import vault_view_snapshot_dependencies

    host = object()
    seen: list[object] = []
    view: RegistryData = {"id": "view", "table_id": "table"}

    def resolve(values: list[RegistryData], spec: RegistryData, page_id: object) -> list[str]:
        assert spec is view
        seen.append(page_id)
        return ["page"]

    dependencies = replace(
        vault_view_snapshot_dependencies,
        load_registry=lambda: {"views": [view]},
        pages_for_table=lambda _: [],
        table_by_id=lambda _: None,
        resolve_row_ids=resolve,
    )
    assert snapshots.resolve_view_row_ids("view", host, dependencies) == ["page"]
    assert seen == [host]


def test_enriched_page_validates_response_without_widening_metadata(configured: None) -> None:
    from backend.domains.vault.tables.legacy_composition import table_row_query_dependencies

    page = PageInfo(id="row", title="Row", metadata={"old": "value"}, last_modified="date", size=1)
    calls: list[str] = []
    response: RegistryData = {7: "invalid HTTP metadata key"}

    def refresh(pages: list[PageInfo]) -> None:
        calls.append("refresh")

    def inject(
        table: RegistryData | None, pages: list[PageInfo], loader: Callable[[str], list[PageInfo]]
    ) -> None:
        calls.append("inject")

    def response_names(metadata: object, table: RegistryData) -> RegistryData:
        assert metadata is page.metadata
        calls.append("response")
        return response

    dependencies = replace(
        table_row_query_dependencies,
        refresh_metadata=refresh,
        inject_virtual_fields=inject,
        response_names=response_names,
        table_by_id=lambda _: {"id": "table"},
    )
    with pytest.raises(ValidationError) as error:
        rows.enrich_table_query_pages("table", [page], dependencies)
    assert error.value.errors()[0]["loc"] == ("metadata", 7, "[key]")
    assert page.metadata == {"old": "value"}
    assert calls == ["refresh", "inject", "response"]


def test_quarantine_native_subscription_keeps_callback_order(
    configured: None, tmp_path: Path
) -> None:
    calls: list[str] = []

    class Entry:
        def __getitem__(self, key: str) -> str:
            calls.append(key)
            return "Assets/original" if key == "source" else "detached"

    candidate = tmp_path / "in-progress-fixture"
    candidate.mkdir()
    expected = [(tmp_path / "Assets/original", candidate / "detached")]
    assert (
        quarantine._planned_restore_moves({"entries": [Entry()]}, candidate, tmp_path) == expected
    )
    assert calls == ["source", "destination"]
