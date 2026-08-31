"""Open document contracts across Brain migration, graph and index consumers."""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.domains.configuration import llm_wiki_records as records
from backend.domains.graph import nodes
from backend.domains.llm_wiki import dimensions, legacy_ports
from backend.domains.vault.pages.foundation_values import PageMetadata
from backend.services import llm_wiki_config as config
from backend.services import llm_wiki_indices as indices
from backend.services import llm_wiki_storage as storage


@pytest.mark.parametrize("raw", [None, 42, "not a document", ["note_type"]])
def test_note_kind_keeps_non_dictionary_fallback(raw: object) -> None:
    assert config.metadata_note_type(raw) == ""


def test_migration_guards_keep_unknown_keys_and_nested_identity() -> None:
    nested: list[object] = [object()]
    document: PageMetadata = {7: nested, "note_type": "reading"}
    values: list[object] = [document, nested]
    assert records._mapping(document) is document
    assert records._items(values) is values
    assert config.metadata_note_type(document) == "lectura"
    assert document[7] is nested
    # Existing serialization rejects incomparable keys; typing must not sort/coerce them.
    with pytest.raises(TypeError):
        records._serialized(document)


class _VisibleNoteKey:
    def __str__(self) -> str:
        return "Tipus de nota"


def test_note_kind_resolves_visible_non_text_key_without_rebuilding_document() -> None:
    key = _VisibleNoteKey()
    document: PageMetadata = {key: "Nota permanent", 8: object()}
    assert config.metadata_note_type(document) == "permanent"
    assert next(iter(document)) is key


class _Options:
    def __init__(self, events: list[str]) -> None:
        self.events = events

    def __getitem__(self, index: int) -> object:
        self.events.append(f"item:{index}")
        if index == 0:
            return {"name": " Reading note "}
        raise IndexError(index)


class _Property:
    def __init__(self, events: list[str]) -> None:
        self.events = events

    def get(self, key: str) -> object:
        self.events.append(f"get:{key}")
        return {"options": _Options(self.events)} if key == "config" else None


def test_option_protocol_preserves_lazy_fallback_and_legacy_sequence() -> None:
    events: list[str] = []
    assert config.note_type_value("reading", {"ui_locale": "ca"}, _Property(events)) == "Reading note"
    assert events == ["get:options", "get:config", "item:0", "item:1"]


@pytest.mark.parametrize("raw", [7, "bad", ["bad"]])
def test_option_lookup_keeps_native_attribute_error(raw: object) -> None:
    with pytest.raises(AttributeError) as expected:
        eval("raw.get('options')", {"raw": raw})
    with pytest.raises(AttributeError) as actual:
        config._property_options(raw)
    assert actual.value.args == expected.value.args


def test_graph_retains_merged_document_or_original_on_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original: PageMetadata = {7: object()}
    merged: PageMetadata = {8: object(), "note_type": "reading"}
    calls: list[object] = []

    def merge(value: object, page_id: str) -> PageMetadata:
        assert value is original
        calls.append(page_id)
        return merged

    monkeypatch.setattr(storage, "merge_page_metadata", merge)
    result, kind = nodes._managed_metadata(original, 12)
    assert result is merged and kind == "lectura" and calls == ["12"]

    def failed(value: object, page_id: str) -> PageMetadata:
        raise OSError("synthetic unavailable sidecar")

    monkeypatch.setattr(storage, "merge_page_metadata", failed)
    result, kind = nodes._managed_metadata(original, 12)
    assert result is original and kind == ""


def test_index_write_preserves_open_document_and_prepare_save_register_order(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    path = tmp_path / "synthetic.md"
    original: PageMetadata = {7: object(), "id": "synthetic"}
    portable: PageMetadata = {8: object(), "id": "synthetic"}
    events: list[str] = []

    def prepare(value: PageMetadata) -> PageMetadata:
        assert value is original
        events.append("prepare")
        return portable

    def save(target: Path, value: PageMetadata, body: str) -> None:
        assert target is path and value is portable and body == "Body\n"
        events.append("save")

    def register(target: Path) -> None:
        assert target is path
        events.append("register")

    monkeypatch.setattr(storage, "prepare_managed_markdown", prepare)
    monkeypatch.setattr(legacy_ports, "save_page", save)
    monkeypatch.setattr(legacy_ports, "register_page", register)
    indices._save_existing_page(path, original, "Body  \n\n")
    assert events == ["prepare", "save", "register"]
    assert not path.exists()


class _MetadataReader:
    def __init__(self, value: object) -> None:
        self.value = value
        self.calls: list[str] = []

    def get(self, key: str) -> object:
        self.calls.append(key)
        return self.value if key == "stable-id" else None


def test_dimension_read_only_port_returns_same_unknown_value() -> None:
    nested = [object()]
    reader = _MetadataReader(nested)
    result = dimensions.metadata_property_value(reader, {"name": "Old", "id": "stable-id"})
    assert result is nested
    assert reader.calls == ["Old", "stable-id", "stable-id"]
