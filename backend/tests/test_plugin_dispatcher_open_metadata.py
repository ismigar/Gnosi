"""Synthetic plugin host boundaries preserve open records and native operations."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from pathlib import Path

import pytest

from backend.domains.vault.registry.state import RegistryData
from backend.services import plugin_dispatcher as dispatcher
from backend.services import plugin_events


def _outcome(operation: Callable[[], object]) -> tuple[object, ...]:
    try:
        return ("value", operation())
    except Exception as error:
        return (type(error), error.args)


def _original_tables(root: object) -> object:
    # Fixed test-owned expression: exercise Python's original native protocols.
    result: object = eval(
        "{'tables': [{'id': t.get('id'), 'name': t.get('name') or t.get('id'), "
        "'fields': len(t.get('properties') or [])} "
        "for t in (root or {}).get('tables', []) or []]}",
        {},
        {"root": root},
    )
    return result


@pytest.mark.parametrize(
    "root",
    [None, False, 0, [], 7, "bad", {}, {"tables": None}, {"tables": 0},
     {"tables": 7}, {"tables": "bad"}, {"tables": {"unexpected": 1}},
     {"tables": [None]}, {"tables": [7]}, {"tables": [[1]]},
     {"tables": [{"id": "t", "properties": 7}]},
     {"tables": [{"id": "t", "properties": "abc"}]},
     {"tables": ({"id": "t", "properties": {7: False}},)}],
)
def test_list_tables_matches_native_results_and_errors(
    monkeypatch: pytest.MonkeyPatch, root: object
) -> None:
    from backend.domains.vault.registry import runtime

    monkeypatch.setattr(runtime, "load_registry", lambda: root)
    assert _outcome(lambda: dispatcher._handle_list_tables({}, "synthetic")) == _outcome(
        lambda: _original_tables(root)
    )


def test_table_iteration_and_field_length_have_exact_native_order(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.domains.vault.registry import runtime

    events: list[str] = []
    identifier = object()

    class Properties:
        def __bool__(self) -> bool:
            events.append("properties.bool")
            return True

        def __len__(self) -> int:
            events.append("properties.len")
            return 3

    properties = Properties()

    class Table:
        def get(self, key: str) -> object:
            events.append(key)
            return {"id": identifier, "properties": properties}.get(key)

    class Tables(Iterator[object]):
        def __init__(self) -> None:
            self.done = False

        def __iter__(self) -> Iterator[object]:
            events.append("iter")
            return self

        def __next__(self) -> object:
            events.append("next")
            if self.done:
                raise StopIteration
            self.done = True
            return Table()

    monkeypatch.setattr(runtime, "load_registry", lambda: {"tables": Tables()})
    assert dispatcher._handle_list_tables({}, "synthetic") == {
        "tables": [{"id": identifier, "name": identifier, "fields": 3}]
    }
    assert events == [
        "iter", "next", "id", "name", "id", "properties",
        "properties.bool", "properties.len", "next",
    ]


@pytest.mark.parametrize("length", [-1, 2**100])
def test_field_length_keeps_native_validation(
    monkeypatch: pytest.MonkeyPatch, length: int
) -> None:
    from backend.domains.vault.registry import runtime

    class Properties:
        def __bool__(self) -> bool:
            return True

        def __len__(self) -> int:
            return length

    root: RegistryData = {"tables": [{"properties": Properties()}]}
    monkeypatch.setattr(runtime, "load_registry", lambda: root)
    assert _outcome(lambda: dispatcher._handle_list_tables({}, "synthetic")) == _outcome(
        lambda: _original_tables(root)
    )


def test_create_page_preserves_owner_capture_and_operation_order(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from backend.domains.vault.api import core_routes
    from backend.domains.vault.links import runtime as links
    from backend.domains.vault.pages import foundation, runtime

    events: list[str] = []
    saved: list[RegistryData] = []
    target = tmp_path / "Synthetic.md"

    def wrong_save(path: Path, metadata: RegistryData, body: str) -> None:
        raise AssertionError("save callback was resolved too late")

    def unique_path(folder: Path, title: str) -> Path:
        events.append("path")
        assert folder == tmp_path and title == "Synthetic"
        monkeypatch.setattr(foundation, "save_page_md", wrong_save)
        return target

    def save(path: Path, metadata: RegistryData, body: str) -> None:
        events.append("save")
        assert path == target and body == "body"
        saved.append(metadata)

    def register(path: Path) -> None:
        assert path == target
        events.append("index")

    def emit(name: str, payload: object) -> None:
        assert name == "page:created"
        events.append("event")

    monkeypatch.setattr(runtime, "get_p", lambda _key: tmp_path)
    monkeypatch.setattr(core_routes, "_get_unique_filepath", unique_path)
    monkeypatch.setattr(foundation, "save_page_md", save)
    monkeypatch.setattr(links, "register_page_in_index", register)
    monkeypatch.setattr(plugin_events, "emit", emit)
    result = dispatcher._handle_create_page(
        {"title": " Synthetic ", "content": "body"}, "synthetic"
    )
    assert saved == [{"id": result["pageId"], "title": "Synthetic"}]
    assert events == ["path", "save", "index", "event"]
