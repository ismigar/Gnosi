"""Disposable page-runtime cache characterization, without personal data."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.api import vault_routes
from backend.domains.vault.pages import runtime
from backend.domains.vault.pages.disk_cache import prepare_page_index
from backend.domains.vault.pages.index_entries import PageCacheEntry

CacheState = tuple[
    Path,
    dict[str, dict[str, PageCacheEntry]],
    dict[str, bool],
    dict[str, dict[object, str]],
    list[str],
]


@pytest.fixture
def cache_state(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> CacheState:
    cache = tmp_path / "cache.json"
    entries: dict[str, dict[str, PageCacheEntry]] = {"other": {"other.md": {"id": "keep"}}}
    initialized: dict[str, bool] = {"other": True}
    ids: dict[str, dict[object, str]] = {"other": {"keep": "other.md"}}
    versions: list[str] = []
    monkeypatch.setattr(runtime, "get_page_index_cache_path", lambda key=None: cache)
    monkeypatch.setattr(runtime, "_page_index_entries", entries)
    monkeypatch.setattr(runtime, "_page_index_initialized", initialized)
    monkeypatch.setattr(runtime, "_page_id_to_path", ids)
    monkeypatch.setattr(vault_routes, "_bump_page_index_version", versions.append)
    monkeypatch.setattr(vault_routes.path_resolver, "update_index", lambda *args: None)
    return cache, entries, initialized, ids, versions


def test_cache_rehydrates_unknown_fields_and_raw_hashable_ids(cache_state: CacheState) -> None:
    cache, entries, initialized, ids, versions = cache_state
    document = {"page.md": {"id": 17, "unknown": [None, False, {"raw": 8}]}}
    cache.write_text(json.dumps(document), encoding="utf-8")
    assert runtime._load_page_index_from_disk("synthetic") is True
    assert entries["synthetic"] == document
    assert initialized == {"other": True, "synthetic": True}
    assert ids == {"other": {"keep": "other.md"}, "synthetic": {17: "page.md"}}
    assert versions == ["synthetic"]


@pytest.mark.parametrize("document", [None, 1, [], {"page.md": None}, {"page.md": {"id": [1]}}])
@pytest.mark.parametrize("existing", [False, True])
def test_corrupt_cache_does_not_publish_partial_state(
    cache_state: CacheState, document: object, existing: bool
) -> None:
    cache, entries, initialized, ids, versions = cache_state
    previous: dict[str, PageCacheEntry] = {"old.md": {"id": "old"}}
    previous_ids: dict[object, str] = {"old": "old.md"}
    if existing:
        entries["synthetic"] = previous
        ids["synthetic"] = previous_ids
        initialized["synthetic"] = True
    cache.write_text(json.dumps(document), encoding="utf-8")
    original = cache.read_bytes()
    assert runtime._load_page_index_from_disk("synthetic") is False
    if existing:
        assert entries["synthetic"] is previous
        assert ids["synthetic"] is previous_ids
        assert initialized["synthetic"] is True
    else:
        assert "synthetic" not in entries
        assert "synthetic" not in ids
        assert "synthetic" not in initialized
    assert entries["other"] == {"other.md": {"id": "keep"}}
    assert versions == []
    assert cache.read_bytes() == original


@pytest.mark.parametrize("page_id", [None, False, 0, "", [], {}])
def test_cache_keeps_falsy_ids_without_indexing_them(
    cache_state: CacheState, page_id: object
) -> None:
    cache, entries, initialized, ids, versions = cache_state
    document = {"page.md": {"id": page_id}}
    cache.write_text(json.dumps(document), encoding="utf-8")
    assert runtime._load_page_index_from_disk("synthetic") is True
    assert entries["synthetic"] == document
    assert ids["synthetic"] == {}


def test_prepare_retains_document_and_entry_identity() -> None:
    document = {"one.md": {"id": 3, "raw": {"nested": [False]}}}
    prepared, ids, paths = prepare_page_index(document)
    assert prepared is document
    assert prepared["one.md"] is document["one.md"]
    assert ids == {3: "one.md"}
    assert paths == [Path("one.md")]


def test_cache_invalid_json_is_retained(cache_state: CacheState) -> None:
    cache, entries, initialized, ids, versions = cache_state
    cache.write_bytes(b'{"unfinished":')
    assert runtime._load_page_index_from_disk("synthetic") is False
    assert cache.read_bytes() == b'{"unfinished":'
    assert "synthetic" not in entries
    assert "synthetic" not in initialized
    assert "synthetic" not in ids
    assert versions == []
