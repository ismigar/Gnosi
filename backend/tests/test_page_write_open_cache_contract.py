"""Cache identity, native failures and opaque IDs in synthetic page writes."""

from __future__ import annotations

import logging
from dataclasses import replace
from pathlib import Path

import pytest

from backend.domains.vault.pages import patch_helpers
from backend.domains.vault.pages.foundation_values import PageMetadata
from backend.domains.vault.registry.records import is_record
from backend.tests.page_write_open_fixtures import _patch_helpers


@pytest.mark.parametrize("existing", [False, True])
def test_patch_cache_preserves_entry_and_list_identity_with_shallow_copy(
    tmp_path: Path,
    existing: bool,
) -> None:
    path = tmp_path / "page.md"
    path.write_text("body", encoding="utf-8")
    nested: list[object] = [object()]
    metadata: PageMetadata = {42: nested, "Citation Key": "new"}
    entry: patch_helpers.PageCacheEntry = {"id": "page", "metadata": metadata}
    docs: list[patch_helpers.IterDocument] = [(path, {}, "old", False)] if existing else []
    cache: patch_helpers.IterDocsCache = {str(tmp_path): {"docs": docs}}
    indices: patch_helpers.PageIndexEntries = {}
    ids: patch_helpers.PageIdPaths = {}
    bodies: patch_helpers.BodyCache = {str(path): (1, "old")}
    events: list[str] = []
    helper = replace(
        _patch_helpers(tmp_path),
        index_entries=lambda: indices,
        id_to_path=lambda: ids,
        body_cache=lambda: bodies,
        iter_docs_cache=lambda: cache,
        build_cache_entry=lambda path, stat, metadata, body: entry,
        bump_index_version=lambda key: events.append("bump"),
        add_to_path_resolver=lambda root, page_id, path: events.append("resolver"),
        invalidate_page_responses=lambda: events.append("pages"),
        invalidate_citation_index=lambda: events.append("citations"),
        is_dashboard_file=lambda path: True,
    )
    patch_helpers.update_patch_caches(
        "page", path, metadata, "new", {"Citation Key": "old"}, helper
    )
    assert indices[str(tmp_path)][str(path)] is entry
    assert ids[str(tmp_path)]["page"] == str(path) and bodies == {}
    assert cache[str(tmp_path)]["docs"] is docs and len(docs) == 1
    assert docs[0][1] is not metadata and docs[0][1][42] is nested
    assert docs[0][2:] == ("new", True)
    assert events == ["bump", "resolver", "pages", "citations"]


@pytest.mark.parametrize("cache_id", [None, "", "renamed"])
def test_patch_cache_id_fallback_preserves_resolver_argument(
    tmp_path: Path,
    cache_id: str | None,
) -> None:
    path = tmp_path / "page.md"
    path.write_text("body", encoding="utf-8")
    ids: patch_helpers.PageIdPaths = {}
    resolved: list[object] = []
    helper = replace(
        _patch_helpers(tmp_path),
        id_to_path=lambda: ids,
        build_cache_entry=lambda path, stat, metadata, body: {"id": cache_id},
        add_to_path_resolver=lambda root, page_id, path: resolved.append(page_id),
    )
    patch_helpers.update_patch_caches("original", path, {}, "new", {}, helper)
    assert resolved == [cache_id or "original"]
    assert ids == ({str(tmp_path): {cache_id: str(path)}} if cache_id else {})


def test_patch_malformed_docs_keeps_native_error_after_invalidation(
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    path = tmp_path / "page.md"
    path.write_text("body", encoding="utf-8")
    cache: patch_helpers.IterDocsCache = {str(tmp_path): {}}
    # Deliberately violate the cache contract to exercise native failure order.
    malformed_entry: object = cache[str(tmp_path)]
    assert is_record(malformed_entry)
    malformed_entry["docs"] = ((path, {}, "old", False),)
    events: list[str] = []
    helper = replace(
        _patch_helpers(tmp_path),
        iter_docs_cache=lambda: cache,
        invalidate_page_responses=lambda: events.append("invalidate"),
    )
    # Capture the injected logger: the shared fixture has its own module name.
    with caplog.at_level(logging.DEBUG, logger=helper.logger().name):
        patch_helpers.update_patch_caches("page", path, {}, "new", {}, helper)
    assert events == ["invalidate"]
    assert "'tuple' object does not support item assignment" in caplog.text


@pytest.mark.parametrize("cache_id,hashable", [(42, True), ((1, 2), True), ([42], False)])
def test_patch_override_id_is_not_coerced_and_keeps_partial_failure_order(
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
    cache_id: object,
    hashable: bool,
) -> None:
    path = tmp_path / "page.md"
    path.write_text("body", encoding="utf-8")
    entry: patch_helpers.PageCacheEntry = {"id": cache_id}
    indices: patch_helpers.PageIndexEntries = {}
    ids: patch_helpers.PageIdPaths = {}
    events: list[str] = []
    resolved: list[object] = []

    def resolver(root: Path, page_id: object, file_path: Path) -> None:
        events.append("resolver")
        resolved.append(page_id)

    helper = replace(
        _patch_helpers(tmp_path),
        index_entries=lambda: indices,
        id_to_path=lambda: ids,
        build_cache_entry=lambda path, stat, metadata, body: entry,
        bump_index_version=lambda key: events.append("bump"),
        add_to_path_resolver=resolver,
        invalidate_page_responses=lambda: events.append("invalidate"),
    )
    with caplog.at_level(logging.DEBUG, logger=helper.logger().name):
        patch_helpers.update_patch_caches("page", path, {}, "new", {}, helper)
    assert indices[str(tmp_path)][str(path)] is entry
    if hashable:
        assert ids == {str(tmp_path): {cache_id: str(path)}}
        assert resolved[0] is cache_id
        assert events == ["bump", "resolver", "invalidate"]
    else:
        assert ids == {str(tmp_path): {}} and resolved == []
        assert events == ["invalidate"]
        assert "unhashable type: 'list'" in caplog.text
