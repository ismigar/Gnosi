"""Selected-field queries retain the native protocol of open row metadata."""

from __future__ import annotations

import json

import pytest

from backend.domains.agent import context_core_tools as core
from backend.domains.vault.registry.state import RegistryData


def _handler(monkeypatch: pytest.MonkeyPatch, metadata: object) -> core.ContextCoreTools:
    rows: list[RegistryData] = [{"id": "row", "title": "Synthetic", "metadata": metadata}]
    monkeypatch.setattr(core, "_table_entry", lambda table_id: {"id": "table", "name": "Table"})
    monkeypatch.setattr(core, "_table_rows", lambda table_id, scope: (rows, None))
    return core.ContextCoreTools([{"id": "attached", "type": "table", "ref": "table"}])


def test_query_retains_unknown_keys_and_existing_json_envelope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    value = {7: "nested"}
    metadata: RegistryData = {7: object(), "field": value}
    handler = _handler(monkeypatch, metadata)
    payload: object = json.loads(
        handler.query_context_table("attached", fields=["field", "missing"])
    )
    assert payload == {
        "source_id": "attached",
        "table": {"id": "table", "name": "Table"},
        "active_view": None,
        "matching_count": 1,
        "offset": 0,
        "limit": 100,
        "has_more": False,
        "next_offset": None,
        "records": [
            {
                "id": "row",
                "title": "Synthetic",
                "fields": {"field": {"7": "nested"}, "missing": None},
            }
        ],
    }
    assert metadata["field"] is value and list(metadata) == [7, "field"]
    assert list(value) == [7]


class _MetadataProbe:
    def __init__(self, events: list[str]) -> None:
        self.events = events

    def __bool__(self) -> bool:
        self.events.append("bool")
        return True

    def get(self, key: str) -> object:
        self.events.append(key)
        return key


def test_query_uses_native_get_once_per_selected_field_in_order(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    handler = _handler(monkeypatch, _MetadataProbe(events))
    handler.query_context_table("attached", fields=[" second ", "FIRST", "Second", "", "third"])
    assert events == ["bool", "second", "FIRST", "third"]


@pytest.mark.parametrize("metadata", [7, "malformed", [1]])
def test_query_selected_fields_keeps_native_errors(
    monkeypatch: pytest.MonkeyPatch, metadata: object
) -> None:
    handler = _handler(monkeypatch, metadata)
    with pytest.raises(AttributeError) as expected:
        eval("metadata.get('field')", {"metadata": metadata})
    with pytest.raises(type(expected.value)) as actual:
        handler.query_context_table("attached", fields=["field"])
    assert str(actual.value) == str(expected.value)
    # Unrequested metadata was never read by the original implementation.
    assert '"fields"' not in handler.query_context_table("attached")


@pytest.mark.parametrize("metadata", [None, 0, "", [], {}])
def test_query_falsey_metadata_preserves_empty_default(
    monkeypatch: pytest.MonkeyPatch, metadata: object
) -> None:
    handler = _handler(monkeypatch, metadata)
    assert '"fields": {"field": null}' in handler.query_context_table("attached", fields=["field"])


def test_query_propagates_custom_get_failure_without_reading_later_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    failure = RuntimeError("synthetic getter failure")

    class Metadata:
        def get(self, key: str) -> object:
            events.append(key)
            raise failure

    handler = _handler(monkeypatch, Metadata())
    with pytest.raises(RuntimeError) as actual:
        handler.query_context_table("attached", fields=["first", "second"])
    assert actual.value is failure and events == ["first"]
