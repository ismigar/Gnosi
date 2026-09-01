"""Synthetic open-row contracts for attached agent context."""

from __future__ import annotations

from collections.abc import Iterator

import pytest

from backend.domains.agent import context_storage
from backend.domains.vault.registry.records import is_record
from backend.domains.vault.registry.state import RegistryData
from backend.services import view_snapshot


def test_page_row_preserves_unknown_keys_and_native_shallow_copy() -> None:
    key = object()
    value = object()
    metadata: RegistryData = {key: value, 7: value}
    page: RegistryData = {"id": "page", "title": "Synthetic", "metadata": metadata}
    row = context_storage._page_row(page)
    copied = row["metadata"]
    assert is_record(copied)
    assert copied is not metadata
    assert copied[key] is value and copied[7] is value
    assert list(row) == ["id", "title", "metadata"]
    assert row["id"] == "page" and row["title"] == "Synthetic"


def test_resolve_rows_receives_open_records_and_returns_original_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    key = object()
    value = object()
    metadata: RegistryData = {key: value, "field": "visible"}
    page: RegistryData = {"id": "page", "title": "Synthetic", "metadata": metadata}
    template: RegistryData = {"metadata": {"is_template": True}, "id": "template"}
    view: RegistryData = {"id": "view", "table_id": "table", key: value}
    result: list[RegistryData] = [{"id": "resolved", key: value}]
    events: list[str] = []

    def pages(table_id: str) -> list[RegistryData]:
        assert table_id == "table"
        events.append("pages")
        return [page, template]

    def registry() -> RegistryData:
        events.append("registry")
        return {"views": [view]}

    def resolve(
        rows: list[RegistryData], actual_view: RegistryData, host_page_id: object
    ) -> list[RegistryData]:
        events.append("resolve")
        assert actual_view is view and host_page_id is None
        assert len(rows) == 1 and rows[0]["id"] == "page"
        raw_metadata = rows[0]["metadata"]
        assert is_record(raw_metadata) and raw_metadata[key] is value
        assert raw_metadata is not metadata
        return result

    monkeypatch.setattr(context_storage, "_table_pages", pages)
    monkeypatch.setattr(context_storage, "_registry", registry)
    monkeypatch.setattr(view_snapshot, "resolve_rows", resolve)
    rows, found_view = context_storage._table_rows("table", {"view_id": "view"})
    assert rows is result and found_view is view
    assert events == ["pages", "registry", "resolve"]


def test_actual_view_resolution_keeps_unknown_metadata_keys(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    value = object()
    monkeypatch.setattr(
        context_storage,
        "_table_pages",
        lambda table_id: [
            {"id": "page", "title": "Synthetic", "metadata": {7: value}},
        ],
    )
    view: RegistryData = {"id": "view", "table_id": "table", 11: value}
    monkeypatch.setattr(context_storage, "_registry", lambda: {"views": [view]})
    rows, resolved_view = context_storage._table_rows("table", {"view_id": "view"})
    metadata = rows[0]["metadata"]
    assert is_record(metadata) and metadata[7] is value
    assert resolved_view is view


@pytest.mark.parametrize("value", [7, [1], "malformed"])
def test_row_template_probe_retains_native_get_errors(
    monkeypatch: pytest.MonkeyPatch,
    value: object,
) -> None:
    row: RegistryData = {"metadata": value}
    monkeypatch.setattr(context_storage, "_table_pages", lambda table_id: [object()])
    monkeypatch.setattr(context_storage, "_page_row", lambda page: row)
    with pytest.raises(AttributeError) as expected:
        eval("(value or {}).get('is_template')", {"value": value})
    with pytest.raises(type(expected.value)) as actual:
        context_storage._table_rows("table")
    assert str(actual.value) == str(expected.value)


class _OpaqueMetadata:
    def __init__(self, events: list[str]) -> None:
        self.events = events

    def __bool__(self) -> bool:
        self.events.append("bool")
        return True

    def get(self, key: object) -> object:
        assert key == "is_template"
        self.events.append("get")
        return False


def test_row_template_probe_keeps_custom_get_without_shape_validation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    row: RegistryData = {"metadata": _OpaqueMetadata(events)}
    monkeypatch.setattr(context_storage, "_table_pages", lambda table_id: [object()])
    monkeypatch.setattr(context_storage, "_page_row", lambda page: row)
    rows, view = context_storage._table_rows("table")
    assert rows[0] is row and view is None
    assert events == ["bool", "get"]


class _SingleIterator(Iterator[object]):
    def __init__(self, value: object, events: list[str]) -> None:
        self.value = value
        self.events = events
        self.finished = False

    def __iter__(self) -> Iterator[object]:
        raise AssertionError("The existing view loop must not iterate twice")

    def __next__(self) -> object:
        self.events.append("next")
        if self.finished:
            raise StopIteration
        self.finished = True
        return self.value


class _Views:
    def __init__(self, value: object, events: list[str]) -> None:
        self.value = value
        self.events = events

    def __iter__(self) -> Iterator[object]:
        self.events.append("iter")
        return _SingleIterator(self.value, self.events)


def test_table_view_keeps_single_iteration_and_early_exit(monkeypatch: pytest.MonkeyPatch) -> None:
    events: list[str] = []
    view: RegistryData = {"id": "view", "table_id": "table", 7: object()}
    monkeypatch.setattr(context_storage, "_registry", lambda: {"views": _Views(view, events)})
    assert context_storage._table_view("table", {"view_id": "view"}) is view
    assert events == ["iter", "next"]
