"""Synthetic cache, callback capture and sidecar materialization contracts."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
from threading import Lock, get_ident

import pytest
from fastapi.responses import FileResponse

from backend.api import vault_routes
from backend.domains.vault.api import trash as trash_api
from backend.domains.vault.assets import api as assets_api
from backend.domains.vault.files import api as files_api
from backend.domains.vault.files import route_composition as composition
from backend.domains.vault.files import serving
from backend.domains.vault.files.state import FileServingState, file_serving_state
from backend.domains.vault.links.document_inventory import DocumentCache, LinkableDocument
from backend.domains.vault.pages.foundation_values import PageMetadata
from backend.domains.vault.pages.index_entries import PageCacheEntry
from backend.domains.vault.trash import purge
from backend.platform.files.base import FilesProvider
from backend.platform.files.local import LocalProvider
from backend.services import context_vars


def test_captured_callbacks_and_state_keep_original_owner(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    captured_provider = composition._LOCAL_FILE_DEPENDENCIES.provider
    captured_validation = trash_api._deps().validate_page_id
    captured_error = trash_api._deps().safe_error_detail
    monkeypatch.setattr(vault_routes, "get_files_provider", lambda: LocalProvider())
    monkeypatch.setattr(vault_routes, "_validate_safe_page_id", lambda page_id: "new")
    monkeypatch.setattr(vault_routes, "safe_error_detail", lambda error, label: "new")
    monkeypatch.setattr(vault_routes, "get_p", lambda key: tmp_path / key)
    assert composition._LOCAL_FILE_DEPENDENCIES.provider is captured_provider
    assert composition._THUMBNAIL_DEPENDENCIES.provider is captured_provider
    assert files_api._deps().provider is captured_provider
    assert trash_api._deps().validate_page_id is captured_validation
    assert trash_api._deps().safe_error_detail is captured_error
    assert composition._PROPERTY_FILE_DEPENDENCIES.get_path("ASSETS") == tmp_path / "ASSETS"
    assert composition._VAULT_IMAGE_SEMAPHORE is file_serving_state.semaphore
    assert composition._LOCAL_LINKS_LOCK is composition._LOCAL_LINK_STORE.lock
    assert composition._custom_icons_lock is composition._CUSTOM_ICON_STORE.lock


def test_late_trash_callbacks_preserve_dictionary_identity(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    events: list[str] = []
    result: dict[object, object] = {object(): object(), "deleted_at": None}

    def move(page_id: str, path: Path) -> dict[object, object]:
        assert page_id == "sample" and path == tmp_path
        events.append("move")
        return result

    def restored(page_id: str) -> dict[object, object]:
        events.append("restore")
        return result

    def purged(page_id: str) -> purge.PurgeResult:
        events.append("purge")
        return {"id": page_id, "freed_bytes": 17}

    monkeypatch.setattr(vault_routes, "_move_page_to_trash", move)
    monkeypatch.setattr(composition, "_restore_page_from_trash", restored)
    monkeypatch.setattr(vault_routes, "_purge_trash_entry", purged)
    dependencies = trash_api._deps()
    assert dependencies.move_page("sample", tmp_path) is result
    assert dependencies.restore_page("sample") is result
    assert dependencies.purge_entry("sample") == {"id": "sample", "freed_bytes": 17}
    assert events == ["move", "restore", "purge"]


def test_purge_delegates_to_real_owner_without_calling_real_cleanup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    expected: purge.PurgeResult = {"id": "sample", "freed_bytes": 23}

    def perform(page_id: str, dependencies: purge.PurgeDependencies) -> purge.PurgeResult:
        assert page_id == "sample"
        assert dependencies is composition._TRASH_PURGE_DEPENDENCIES
        return expected

    monkeypatch.setattr(purge, "purge_trash_entry", perform)
    assert composition._purge_trash_entry("sample") is expected


def test_asset_image_uses_current_provider_and_preserves_evaluation_order(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    events: list[str] = []
    provider = LocalProvider()
    expected = FileResponse(tmp_path / "synthetic.png")

    def provide() -> FilesProvider:
        events.append("provider")
        # Python resolves the serving function before invoking this factory.
        monkeypatch.setattr(serving, "serve_vault_image", unexpected)
        return provider

    async def unexpected(
        root: Path, relative: str, *, state: FileServingState, provider: FilesProvider
    ) -> FileResponse:
        raise AssertionError("serving callback was looked up after provider evaluation")

    async def serve(
        root: Path, relative: str, *, state: FileServingState, provider: FilesProvider
    ) -> FileResponse:
        assert root == tmp_path and relative == "synthetic.png"
        assert state is file_serving_state and provider.name == "local"
        events.append("serve")
        return expected

    monkeypatch.setattr(vault_routes, "get_files_provider", provide)

    async def run() -> FileResponse:
        return await assets_api._deps().serve_image(tmp_path, "synthetic.png")

    monkeypatch.setattr(serving, "serve_vault_image", serve)
    assert asyncio.run(run()) is expected
    assert events == ["provider", "serve"]


@pytest.mark.parametrize("exists", [False, True])
def test_one_sidecar_scan_is_off_loop_and_materializer_is_late(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, exists: bool
) -> None:
    slot = tmp_path / "sample"
    slot.mkdir()
    sidecar = slot / "_trash.json"
    if exists:
        sidecar.write_text("{}", encoding="utf-8")
    loop_thread = get_ident()
    events: list[str] = []

    def entry(page_id: str) -> Path:
        assert page_id == "sample" and get_ident() != loop_thread
        events.append("scan")
        return slot

    async def materialize(path: Path, label: str) -> None:
        assert get_ident() == loop_thread
        assert path == sidecar and label == "trash/sample"
        events.append("materialize")

    monkeypatch.setattr(composition, "_trash_entry_dir", entry)
    monkeypatch.setattr(vault_routes, "_materialize_if_online_only", materialize)
    asyncio.run(composition._materialize_trash_sidecar("sample"))
    assert events == (["scan", "materialize"] if exists else ["scan"])


def test_all_sidecars_include_missing_files_and_keep_scan_order(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    for name in ("first", "second"):
        (tmp_path / name).mkdir()
    (tmp_path / "first" / "_trash.json").write_text("{}", encoding="utf-8")
    (tmp_path / "ignored.txt").write_text("ignored", encoding="utf-8")
    expected = [path / "_trash.json" for path in tmp_path.iterdir() if path.is_dir()]
    loop_thread = get_ident()
    seen: list[Path] = []

    def root() -> Path:
        assert get_ident() != loop_thread
        return tmp_path

    async def materialize(path: Path, label: str) -> None:
        assert get_ident() == loop_thread and label == f"trash/{path.parent.name}"
        seen.append(path)

    monkeypatch.setattr(composition, "_trash_root", root)
    monkeypatch.setattr(vault_routes, "_materialize_if_online_only", materialize)
    asyncio.run(composition._materialize_all_trash_sidecars())
    assert seen == expected


@pytest.mark.parametrize("error_type", [OSError, ValueError])
def test_sidecar_scan_catches_only_oserror(
    monkeypatch: pytest.MonkeyPatch, error_type: type[Exception]
) -> None:
    def entry(page_id: str) -> Path:
        raise error_type("synthetic scan")

    monkeypatch.setattr(composition, "_trash_entry_dir", entry)
    if error_type is OSError:
        asyncio.run(composition._materialize_trash_sidecar("sample"))
    else:
        with pytest.raises(ValueError, match="synthetic scan"):
            asyncio.run(composition._materialize_trash_sidecar("sample"))


def test_materializer_error_is_not_swallowed(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    (tmp_path / "_trash.json").write_text("{}", encoding="utf-8")

    async def materialize(path: Path, label: str) -> None:
        raise OSError("synthetic materialization")

    monkeypatch.setattr(composition, "_trash_entry_dir", lambda page_id: tmp_path)
    monkeypatch.setattr(vault_routes, "_materialize_if_online_only", materialize)
    with pytest.raises(OSError, match="synthetic materialization"):
        asyncio.run(composition._materialize_trash_sidecar("sample"))


def test_remove_updates_canonical_caches_without_clearing_siblings(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    current, old, keep = [tmp_path / f"{name}.md" for name in ("current", "old", "keep")]
    entry: PageCacheEntry = {"id": "sample"}
    index = {str(current): entry, str(old): entry, str(keep): {"id": "keep"}}
    ids: dict[object, str] = {"sample": str(current), "keep": str(keep)}
    docs: list[LinkableDocument] = [(path, {}, "body", False) for path in (current, old, keep)]
    cache: DocumentCache = {str(tmp_path): {"docs": docs, "ts": 12.0}}
    titles = {"sample": "Sample", "keep": "Keep"}
    events: list[str] = []

    def remove(root: Path, page_id: str, path: Path | None) -> None:
        assert root == tmp_path and page_id == "sample" and path == old
        assert "sample" not in ids and str(current) not in index and str(old) not in index
        events.append("resolver")

    monkeypatch.setattr(context_vars, "get_active_vault_path", lambda: tmp_path)
    monkeypatch.setattr(vault_routes, "_page_index_lock", Lock())
    monkeypatch.setattr(vault_routes, "_iter_docs_lock", Lock())
    monkeypatch.setattr(vault_routes, "_id_title_lock", Lock())
    monkeypatch.setattr(vault_routes, "_page_index_entries", {str(tmp_path): index})
    monkeypatch.setattr(vault_routes, "_page_id_to_path", {str(tmp_path): ids})
    monkeypatch.setattr(vault_routes, "_iter_docs_cache", cache)
    monkeypatch.setattr(vault_routes, "_id_title_cache", {str(tmp_path): {"index": titles}})
    monkeypatch.setattr(vault_routes.path_resolver, "remove_file", remove)
    monkeypatch.setattr(
        vault_routes, "_pages_cache_invalidate_all", lambda: events.append("invalidate")
    )
    composition._remove_page_from_index_cache("sample", old)
    assert index == {str(keep): {"id": "keep"}} and ids == {"keep": str(keep)}
    assert cache[str(tmp_path)]["docs"] == [docs[2]]
    assert cache[str(tmp_path)]["docs"] is not docs and len(docs) == 3
    assert cache[str(tmp_path)]["ts"] == 12.0
    assert titles == {"keep": "Keep"} and events == ["resolver", "invalidate"]


@pytest.mark.parametrize("existing", [False, True])
def test_add_updates_document_list_in_place_and_retains_opaque_ids(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, existing: bool
) -> None:
    path = tmp_path / "sample.md"
    path.write_text("synthetic body", encoding="utf-8")
    raw_id = object()
    opaque = object()
    metadata: PageMetadata = {"id": raw_id, "title": 23, opaque: opaque}
    entry: PageCacheEntry = {"id": raw_id, "metadata": metadata}
    index: dict[str, PageCacheEntry] = {}
    ids: dict[object, str] = {}
    docs: list[LinkableDocument] = [(path, {}, "old", False)] if existing else []
    cache: DocumentCache = {str(tmp_path): {"docs": docs}}
    titles: dict[str, str] = {}
    events: list[str] = []

    def build(file_path: Path, stat: os.stat_result) -> PageCacheEntry:
        assert file_path == path and stat.st_size == len("synthetic body")
        events.append("build")
        return entry

    def add(root: Path, page_id: object, file_path: Path) -> None:
        assert root == tmp_path and page_id is raw_id and file_path == path
        assert index[str(path)] is entry and ids[raw_id] == str(path)
        events.append("resolver")

    def parse(content: str, file_path: Path) -> tuple[PageMetadata, str]:
        assert content == "synthetic body" and file_path == path
        events.append("parse")
        return metadata, "new body"

    monkeypatch.setattr(context_vars, "get_active_vault_path", lambda: tmp_path)
    monkeypatch.setattr(vault_routes, "_page_index_lock", Lock())
    monkeypatch.setattr(vault_routes, "_iter_docs_lock", Lock())
    monkeypatch.setattr(vault_routes, "_id_title_lock", Lock())
    monkeypatch.setattr(vault_routes, "_page_index_entries", {str(tmp_path): index})
    monkeypatch.setattr(vault_routes, "_page_id_to_path", {str(tmp_path): ids})
    monkeypatch.setattr(vault_routes, "_iter_docs_cache", cache)
    monkeypatch.setattr(vault_routes, "_id_title_cache", {str(tmp_path): {"index": titles}})
    monkeypatch.setattr(vault_routes, "_build_page_cache_entry", build)
    monkeypatch.setattr(vault_routes.path_resolver, "add_file", add)
    monkeypatch.setattr(vault_routes, "parse_frontmatter", parse)
    monkeypatch.setattr(vault_routes, "_is_dashboard_file_path", lambda file_path: True)
    monkeypatch.setattr(
        vault_routes, "_pages_cache_invalidate_all", lambda: events.append("invalidate")
    )
    composition._add_page_to_index_cache(path)
    assert cache[str(tmp_path)]["docs"] is docs and len(docs) == 1
    assert docs[0] == (path, metadata, "new body", True) and docs[0][1] is metadata
    assert titles == {str(raw_id): "23"}
    assert events == ["build", "resolver", "parse", "invalidate"]


def test_missing_vault_does_not_touch_caches(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(context_vars, "get_active_vault_path", lambda: None)

    def unexpected() -> None:
        raise AssertionError("cache invalidation must not run")

    monkeypatch.setattr(vault_routes, "_pages_cache_invalidate_all", unexpected)
    composition._remove_page_from_index_cache("sample")
    composition._add_page_to_index_cache(Path("synthetic-missing.md"))


def test_unhashable_id_keeps_partial_cache_write_and_native_failure(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    path = tmp_path / "sample.md"
    path.write_text("body", encoding="utf-8")
    entry: PageCacheEntry = {"id": ["unhashable"]}
    index: dict[str, PageCacheEntry] = {}
    ids: dict[object, str] = {}

    def unexpected(*args: object) -> None:
        raise AssertionError("must stop before updating derived caches")

    monkeypatch.setattr(context_vars, "get_active_vault_path", lambda: tmp_path)
    monkeypatch.setattr(vault_routes, "_page_index_lock", Lock())
    monkeypatch.setattr(vault_routes, "_page_index_entries", {str(tmp_path): index})
    monkeypatch.setattr(vault_routes, "_page_id_to_path", {str(tmp_path): ids})
    monkeypatch.setattr(vault_routes, "_build_page_cache_entry", lambda path, stat: entry)
    monkeypatch.setattr(vault_routes.path_resolver, "add_file", unexpected)
    monkeypatch.setattr(vault_routes, "_pages_cache_invalidate_all", unexpected)
    with pytest.raises(TypeError) as error:
        composition._add_page_to_index_cache(path)
    assert str(error.value) == "unhashable type: 'list'"
    assert index[str(path)] is entry and ids == {}


@pytest.mark.parametrize("fail_build", [False, True])
def test_add_error_boundaries_preserve_invalidation_order(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, fail_build: bool
) -> None:
    path = tmp_path / "sample.md"
    path.write_text("body", encoding="utf-8")
    index: dict[str, PageCacheEntry] = {}
    events: list[str] = []

    def build(path: Path, stat: os.stat_result) -> PageCacheEntry:
        events.append("build")
        if fail_build:
            raise ValueError("synthetic build failure")
        return {"id": "sample"}

    def parse(content: str, path: Path) -> tuple[PageMetadata, str]:
        events.append("parse")
        raise ValueError("synthetic parse failure")

    def add(root: Path, page_id: object, path: Path) -> None:
        events.append("resolver")

    monkeypatch.setattr(context_vars, "get_active_vault_path", lambda: tmp_path)
    monkeypatch.setattr(vault_routes, "_page_index_lock", Lock())
    monkeypatch.setattr(vault_routes, "_page_index_entries", {str(tmp_path): index})
    monkeypatch.setattr(vault_routes, "_page_id_to_path", {})
    monkeypatch.setattr(vault_routes, "_build_page_cache_entry", build)
    monkeypatch.setattr(vault_routes.path_resolver, "add_file", add)
    monkeypatch.setattr(vault_routes, "parse_frontmatter", parse)
    monkeypatch.setattr(
        vault_routes, "_pages_cache_invalidate_all", lambda: events.append("invalidate")
    )
    composition._add_page_to_index_cache(path)
    assert events == (["build"] if fail_build else ["build", "resolver", "parse", "invalidate"])
    assert index == ({} if fail_build else {str(path): {"id": "sample"}})


def test_resolver_failure_stops_after_index_removal(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    path = tmp_path / "sample.md"
    index: dict[str, PageCacheEntry] = {str(path): {"id": "sample"}}
    ids: dict[object, str] = {"sample": str(path)}
    docs: list[LinkableDocument] = [(path, {}, "body", False)]
    cache: DocumentCache = {str(tmp_path): {"docs": docs}}

    def remove(root: Path, page_id: str, old_path: Path | None) -> None:
        assert old_path == path
        raise ValueError("synthetic resolver failure")

    monkeypatch.setattr(context_vars, "get_active_vault_path", lambda: tmp_path)
    monkeypatch.setattr(vault_routes, "_page_index_lock", Lock())
    monkeypatch.setattr(vault_routes, "_page_index_entries", {str(tmp_path): index})
    monkeypatch.setattr(vault_routes, "_page_id_to_path", {str(tmp_path): ids})
    monkeypatch.setattr(vault_routes, "_iter_docs_cache", cache)
    monkeypatch.setattr(vault_routes.path_resolver, "remove_file", remove)
    with pytest.raises(ValueError, match="synthetic resolver failure"):
        composition._remove_page_from_index_cache("sample")
    assert index == {} and ids == {}
    assert cache[str(tmp_path)]["docs"] is docs and len(docs) == 1
