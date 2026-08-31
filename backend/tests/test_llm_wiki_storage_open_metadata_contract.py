"""Synthetic storage contracts for opaque frontmatter and managed sidecars."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import pytest

from backend.domains.vault.pages.foundation_values import PageMetadata
from backend.domains.vault.registry.records import is_record
from backend.services import llm_wiki_storage as storage


@pytest.fixture(autouse=True)
def isolated_storage(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(storage, "synced_root", lambda: tmp_path)
    monkeypatch.setattr(storage, "_PAGE_STATE_CACHE", {})


def test_merge_copies_unknown_keys_and_overlays_sidecar(tmp_path: Path) -> None:
    path = storage.page_state_path("note")
    path.parent.mkdir(parents=True)
    path.write_text(
        json.dumps({"metadata": {"llm_wiki_key": "stored", "extension": [4]}}),
        encoding="utf-8",
    )
    nested = {7: [1, 2]}
    metadata: PageMetadata = {
        "id": "note",
        ("opaque", 3): nested,
        "llm_wiki_key": "legacy",
        "note_type": "lectura",
    }
    result = storage.merge_page_metadata(metadata)
    assert list(result) == ["id", ("opaque", 3), "llm_wiki_key", "note_type", "extension"]
    assert result[("opaque", 3)] == nested and result[("opaque", 3)] is not nested
    assert result["llm_wiki_key"] == "stored" and result["note_type"] == "lectura"
    assert metadata["llm_wiki_key"] == "legacy" and "extension" not in metadata
    assert result["extension"] is not storage._PAGE_STATE_CACHE[str(path)][2]["extension"]


@pytest.mark.parametrize("value", [None, 7, "scalar", [1], False])
def test_merge_non_records_preserves_existing_fallback(value: object) -> None:
    assert storage.merge_page_metadata(value) == {}


def test_merge_resolves_explicit_id_after_deepcopy(monkeypatch: pytest.MonkeyPatch) -> None:
    metadata: PageMetadata = {"id": "embedded", 7: [1], "llm_wiki_key": "legacy"}
    events: list[str] = []

    def load(page_id: str, legacy_metadata: object = None) -> dict[str, object]:
        events.append("load")
        assert page_id == "explicit"
        assert is_record(legacy_metadata)
        assert legacy_metadata == metadata and legacy_metadata is not metadata
        assert legacy_metadata[7] is not metadata[7]
        return {"llm_wiki_key": "stored"}

    monkeypatch.setattr(storage, "load_page_state", load)
    result = storage.merge_page_metadata(metadata, "explicit")
    assert result["llm_wiki_key"] == "stored" and events == ["load"]


@dataclass
class _Page:
    metadata: object
    id: object = ""


@pytest.mark.parametrize("dictionary", [False, True])
def test_page_metadata_accepts_dict_and_attribute_pages(dictionary: bool) -> None:
    metadata: PageMetadata = {7: [1], "title": "Synthetic"}
    page: object = {"metadata": metadata} if dictionary else _Page(metadata)
    result = storage.page_metadata(page)
    assert result == metadata and result is not metadata and result[7] is not metadata[7]


class _MetadataProbe:
    def __init__(self, events: list[str]) -> None:
        self.events = events

    def __bool__(self) -> bool:
        self.events.append("bool")
        return True

    def get(self, key: str) -> object:
        self.events.append(f"get:{key}")
        return "fallback"


class _PageProbe:
    def __init__(self, metadata: object, page_id: str, events: list[str]) -> None:
        self._metadata = metadata
        self._id = page_id
        self.events = events

    @property
    def metadata(self) -> object:
        self.events.append("metadata")
        return self._metadata

    @property
    def id(self) -> str:
        self.events.append("id")
        return self._id


@pytest.mark.parametrize("page_id", ["", "explicit"])
def test_page_lookup_order_and_lazy_native_get(
    monkeypatch: pytest.MonkeyPatch, page_id: str
) -> None:
    events: list[str] = []
    raw = _MetadataProbe(events)
    page = _PageProbe(raw, page_id, events)
    merged: PageMetadata = {7: object()}

    def merge(metadata: object, resolved_id: str = "") -> PageMetadata:
        assert metadata is raw and resolved_id == (page_id or "fallback")
        events.append("merge")
        return merged

    monkeypatch.setattr(storage, "merge_page_metadata", merge)
    assert storage.page_metadata(page) is merged
    assert events == ["metadata", "bool", "id", *([] if page_id else ["get:id"]), "merge"]


@pytest.mark.parametrize("metadata", [7, "malformed", [1]])
def test_page_metadata_preserves_native_get_errors(metadata: object) -> None:
    with pytest.raises(AttributeError) as expected:
        eval("metadata.get('id')", {"metadata": metadata})
    with pytest.raises(type(expected.value)) as actual:
        storage.page_metadata(_Page(metadata))
    assert str(actual.value) == str(expected.value)
    # An explicit page id still short-circuits the malformed metadata lookup.
    assert storage.page_metadata(_Page(metadata, "explicit")) == {}


def test_prepare_keeps_unknown_keys_and_sidecar_cache_detached() -> None:
    nested = {11: [2]}
    managed = ["evidence"]
    metadata: PageMetadata = {
        "id": "note",
        7: nested,
        ("opaque", 3): "preserved",
        "llm_wiki_sources": managed,
        "note_type": "lectura",
    }
    portable = storage.prepare_managed_markdown(metadata)
    assert list(portable) == ["id", 7, ("opaque", 3)]
    assert portable[7] == nested and portable[7] is not nested
    assert metadata["llm_wiki_sources"] is managed and metadata["note_type"] == "lectura"
    path = storage.page_state_path("note")
    payload: object = json.loads(path.read_text(encoding="utf-8"))
    assert payload == {
        "version": 1,
        "page_id": "note",
        "metadata": {"llm_wiki_sources": ["evidence"], "note_type": "lectura"},
    }
    cached = storage._PAGE_STATE_CACHE[str(path)][2]
    assert cached["llm_wiki_sources"] is not managed
    restored = storage.merge_page_metadata(portable)
    assert restored == metadata and restored["llm_wiki_sources"] is not cached["llm_wiki_sources"]


def test_prepare_without_id_returns_detached_unstripped_copy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def no_load(*args: object) -> dict[str, object]:
        raise AssertionError("Missing id must not load a sidecar")

    monkeypatch.setattr(storage, "load_page_state", no_load)
    metadata: PageMetadata = {7: [1], "llm_wiki_key": "keep", "note_type": "keep"}
    result = storage.prepare_managed_markdown(metadata)
    assert result == metadata and result is not metadata and result[7] is not metadata[7]


def test_prepare_write_failure_preserves_original_and_exception(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    failure = OSError("synthetic write failure")
    metadata: PageMetadata = {"id": "note", 7: [1], "llm_wiki_key": "keep"}

    def fail_write(path: Path, payload: object, **kwargs: object) -> None:
        assert path == storage.page_state_path("note")
        assert kwargs == {"indent": 2, "ensure_ascii": False}
        assert metadata["llm_wiki_key"] == "keep"
        raise failure

    monkeypatch.setattr(storage, "safe_write_json", fail_write)
    with pytest.raises(OSError) as actual:
        storage.prepare_managed_markdown(metadata)
    assert actual.value is failure
    assert metadata == {"id": "note", 7: [1], "llm_wiki_key": "keep"}
    assert storage._PAGE_STATE_CACHE == {}


def test_sidecar_prefix_still_stringifies_nontext_managed_keys() -> None:
    class ManagedKey:
        def __str__(self) -> str:
            return "llm_wiki_extension"

    key = ManagedKey()
    metadata: PageMetadata = {"id": "note", key: [1], 7: "portable"}
    portable = storage.prepare_managed_markdown(metadata)
    assert portable == {"id": "note", 7: "portable"}
    assert storage.load_page_state("note") == {"llm_wiki_extension": [1]}
    assert key in metadata
