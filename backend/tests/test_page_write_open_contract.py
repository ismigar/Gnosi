"""Synthetic contracts for page writes with open metadata and deferred callbacks."""

from __future__ import annotations

import asyncio
import errno
from collections.abc import Callable
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi import BackgroundTasks, HTTPException

from backend.domains.vault.pages import patch_helpers, patch_service, save_helpers, save_service
from backend.domains.vault.pages.foundation_values import PageMetadata
from backend.domains.vault.schemas.pages import PagePatchRequest, PageSaveRequest
from backend.tests.page_write_open_fixtures import (
    _patch_dependencies,
    _patch_helpers,
    _save_dependencies,
    _save_helpers,
)


@pytest.mark.parametrize("kind", ["save", "patch"])
def test_metadata_normalization_preserves_open_keys_and_identity(tmp_path: Path, kind: str) -> None:
    opaque = object()
    nested: list[object] = [opaque]
    original: PageMetadata = {42: nested, "title": opaque}
    normalized: PageMetadata = {**original, "normalized": True}
    stored: PageMetadata = {**normalized, "storage": True}
    table: PageMetadata = {42: opaque, "id": "table"}
    events: list[str] = []

    def normalize(metadata: PageMetadata) -> PageMetadata:
        assert metadata is original
        events.append("ids")
        return normalized

    def context(metadata: PageMetadata) -> PageMetadata:
        assert metadata is normalized
        events.append("context")
        return metadata

    def storage(metadata: PageMetadata, record: PageMetadata) -> tuple[PageMetadata, bool]:
        assert metadata is normalized and record is table
        events.append("storage")
        return stored, True

    def stamp(
        metadata: PageMetadata, record: PageMetadata, create: bool, fallback: str | None
    ) -> PageMetadata:
        assert metadata is stored and record is table
        assert create is (kind == "save")
        assert fallback is None
        events.append("stamp")
        return {"ignored-return": True}

    if kind == "save":
        dependencies = replace(
            _save_helpers(tmp_path),
            normalize_metadata_ids=normalize,
            normalize_table_context=context,
            table_by_id=lambda table_id: table,
            to_storage_names=storage,
            stamp_system_dates=stamp,
        )
        result, returned_table = save_helpers.prepare_save_metadata(original, None, dependencies)
    else:
        patch_dependencies = replace(
            _patch_helpers(tmp_path),
            normalize_metadata_ids=normalize,
            normalize_table_context=context,
            table_by_id=lambda table_id: table,
            to_storage_names=storage,
            stamp_system_dates=stamp,
        )
        result, returned_table = patch_helpers.prepare_patch_metadata(
            original,
            tmp_path / "absent.md",
            patch_dependencies,
        )
    assert result is stored and returned_table is table
    assert result[42] is nested and result["title"] is opaque
    assert events == ["ids", "context", "storage", "stamp"]


def test_save_copies_request_once_and_returns_metadata_identity(tmp_path: Path) -> None:
    events: list[str] = []
    opaque = object()
    nested: list[object] = [opaque]

    class RequestMetadata(dict[object, object]):
        def copy(self) -> PageMetadata:
            events.append("copy")
            return super().copy()

    source = RequestMetadata({42: nested, "is_dashboard": True, "content_format": "json"})
    request = PageSaveRequest.model_construct(title="new", content="after", metadata=source)
    seen: list[PageMetadata] = []
    dependencies = _save_dependencies(tmp_path / "page.md", {}, events)

    def persist(metadata: PageMetadata) -> PageMetadata:
        seen.append(metadata)
        metadata["title"] = opaque
        return metadata

    dependencies = replace(dependencies, persist_assets=persist)
    tasks = BackgroundTasks()
    response = asyncio.run(save_service.save_page("page", request, tasks, None, dependencies))
    assert response["metadata"] is seen[0]
    assert seen[0] is not source and seen[0][42] is nested
    assert "title" not in source and "content_format" in source
    assert "content_format" not in seen[0]
    assert response["title"] is opaque and response["etag"] is None
    assert events == [
        "find",
        "copy",
        "prepare",
        "process",
        "author",
        "write",
        "index",
        "invalidate",
        "calendar",
    ]


def test_save_captures_prepare_callback_before_copy_like_original_expression(
    tmp_path: Path,
) -> None:
    path = tmp_path / "page.md"
    trace: list[str] = []
    copies: list[PageMetadata] = []
    nested: list[object] = [object()]

    def original(
        metadata: PageMetadata, file_path: Path | None
    ) -> tuple[
        PageMetadata,
        PageMetadata | None,
    ]:
        trace.append("prepare-original")
        assert metadata is copies[-1]
        return metadata, None

    def replacement(
        metadata: PageMetadata, file_path: Path | None
    ) -> tuple[
        PageMetadata,
        PageMetadata | None,
    ]:
        trace.append("prepare-replacement")
        return metadata, None

    dependencies = replace(_save_dependencies(path, {}, []), prepare_metadata=original)

    class SwitchingMetadata(dict[object, object]):
        def copy(self) -> PageMetadata:
            trace.append("copy")
            object.__setattr__(dependencies, "prepare_metadata", replacement)
            copied = super().copy()
            copies.append(copied)
            return copied

    source = SwitchingMetadata({42: nested})
    request = PageSaveRequest.model_construct(title="page", content="body", metadata=source)
    assert request.metadata is source

    # Differential reference: Python resolves the callable before evaluating
    # the original argument expression, even when copy() replaces that port.
    expected, _table = dependencies.prepare_metadata(source.copy(), path)
    reference_trace = list(trace)
    assert reference_trace == ["copy", "prepare-original"]
    assert expected is copies[0] and len(copies) == 1
    assert dependencies.prepare_metadata is replacement

    object.__setattr__(dependencies, "prepare_metadata", original)
    trace.clear()
    copies.clear()
    result = asyncio.run(
        save_service.save_page(
            "page",
            request,
            BackgroundTasks(),
            None,
            dependencies,
        )
    )
    assert trace == reference_trace
    assert len(copies) == 1 and result["metadata"] is copies[0]
    assert copies[0] is not source and copies[0][42] is nested
    assert dependencies.prepare_metadata is replacement


def test_save_resolves_callbacks_when_queued_and_keeps_order(tmp_path: Path) -> None:
    events: list[str] = []
    dependencies = _save_dependencies(tmp_path / "page.md", {"title": "before"}, events)

    def original(path: Path) -> None:
        events.append("run-original-links")

    callback: Callable[[Path], None] = original

    def resolve_links() -> Callable[[Path], None]:
        events.append("resolve-links")
        return callback

    def rewrite(page_id: str, old: str, new: str) -> int:
        events.append("run-rewrite")
        return 7

    def formulas(table_id: str, page_id: str) -> None:
        events.append("run-formulas")

    def translate(
        page_id: str, old: PageMetadata, new: PageMetadata, body: str, content: str
    ) -> None:
        events.append("run-translation")

    dependencies = replace(
        dependencies,
        update_link_index=resolve_links,
        rewrite_wikilinks=lambda: rewrite,
        get_table_id=lambda metadata: "table",
        recompute_formulas=lambda: formulas,
        propagate_translation=lambda: translate,
    )
    tasks = BackgroundTasks()
    asyncio.run(
        save_service.save_page(
            "page",
            PageSaveRequest(title="after", content="new"),
            tasks,
            None,
            dependencies,
        )
    )
    assert [task.func for task in tasks.tasks] == [original, rewrite, formulas, translate]
    assert events.index("invalidate") < events.index("resolve-links") < events.index("calendar")
    callback = lambda path: events.append("run-replacement-links")
    asyncio.run(tasks())
    assert events[-4:] == ["run-original-links", "run-rewrite", "run-formulas", "run-translation"]


@pytest.mark.parametrize(
    "force,etag,conflict",
    [(False, "current", True), (True, "current", False), (False, None, False)],
)
def test_save_etag_conflict_precedes_lock_and_nullable_etag_allows_write(
    tmp_path: Path,
    force: bool,
    etag: str | None,
    conflict: bool,
) -> None:
    path = tmp_path / "page.md"
    path.write_text("before", encoding="utf-8")
    events: list[str] = []

    async def lock(page_id: str) -> asyncio.Lock:
        events.append("lock")
        return asyncio.Lock()

    dependencies = replace(
        _save_dependencies(path, {}, events), file_etag=lambda path: etag, get_page_write_lock=lock
    )
    request = PageSaveRequest(title="new", content="after", expected_etag="stale", force=force)
    if conflict:
        with pytest.raises(HTTPException) as caught:
            asyncio.run(
                save_service.save_page("page", request, BackgroundTasks(), None, dependencies)
            )
        assert caught.value.status_code == 409
        assert events == ["find"]
    else:
        result = asyncio.run(
            save_service.save_page(
                "page",
                request,
                BackgroundTasks(),
                None,
                dependencies,
            )
        )
        assert events[:2] == ["find", "lock"] and "write" in events
        assert result["etag"] == etag


def test_patch_real_helper_etag_mismatch_remains_404_before_409(tmp_path: Path) -> None:
    events: list[str] = []
    path = tmp_path / "page.md"
    helper = replace(_patch_helpers(tmp_path), file_etag=lambda path: "current")
    result = patch_helpers.find_and_read_patch_page("page", "stale", False, helper)
    assert result == (path, None, None, None, "current")

    async def lock(page_id: str) -> asyncio.Lock:
        events.append("lock")
        return asyncio.Lock()

    def read(page_id: str, etag: str | None, force: bool) -> patch_helpers.PatchReadResult:
        events.append("read")
        return patch_helpers.find_and_read_patch_page(page_id, etag, force, helper)

    dependencies = replace(
        _patch_dependencies(path, {}, events), get_page_write_lock=lock, find_and_read=read
    )
    with pytest.raises(HTTPException) as caught:
        asyncio.run(
            patch_service.patch_page(
                "page",
                PagePatchRequest(expected_etag="stale"),
                BackgroundTasks(),
                None,
                dependencies,
            )
        )
    assert caught.value.status_code == 404 and caught.value.detail == "Page not found"
    assert events == ["lock", "read"]


def test_patch_complete_read_conflict_still_returns_409(tmp_path: Path) -> None:
    path = tmp_path / "page.md"
    events: list[str] = []
    dependencies = replace(
        _patch_dependencies(path, {}, events),
        find_and_read=(lambda page_id, etag, force: (path, {}, "body", "raw", "current")),
    )
    with pytest.raises(HTTPException) as caught:
        asyncio.run(
            patch_service.patch_page(
                "page",
                PagePatchRequest(expected_etag="stale"),
                BackgroundTasks(),
                None,
                dependencies,
            )
        )
    assert caught.value.status_code == 409 and events == []


def test_patch_transient_cloud_read_returns_retryable_503(tmp_path: Path) -> None:
    path = tmp_path / "page.md"
    events: list[str] = []

    async def prepare_read(page_id: str) -> None:
        assert page_id == "page"
        events.append("prepare")

    def transient_read(
        page_id: str,
        expected_etag: str | None,
        force: bool,
    ) -> patch_helpers.PatchReadResult:
        assert (page_id, expected_etag, force) == ("page", None, False)
        events.append("read")
        raise OSError(errno.EDEADLK, "synthetic File Provider contention")

    dependencies = replace(
        _patch_dependencies(path, {}, events),
        prepare_read=prepare_read,
        find_and_read=transient_read,
    )
    with pytest.raises(HTTPException) as caught:
        asyncio.run(
            patch_service.patch_page(
                "page",
                PagePatchRequest(),
                BackgroundTasks(),
                None,
                dependencies,
            )
        )
    assert caught.value.status_code == 503
    assert caught.value.headers == {
        "Cache-Control": "no-store, must-revalidate",
        "Retry-After": "2",
    }
    assert events == ["prepare", "read"]


@pytest.mark.parametrize("dashboard,force", [(False, False), (False, True), (True, True)])
def test_patch_read_retains_metadata_identity_raw_and_nullable_etag(
    tmp_path: Path,
    dashboard: bool,
    force: bool,
) -> None:
    path = tmp_path / "page.md"
    path.write_text("raw", encoding="utf-8")
    metadata: PageMetadata = {42: object()}
    helper = replace(
        _patch_helpers(tmp_path),
        is_dashboard_file=lambda path: dashboard,
        parse_frontmatter=lambda raw, path: (metadata, "body"),
        read_dashboard_file=lambda path: (metadata, "body"),
    )
    result = patch_helpers.find_and_read_patch_page("page", "expected", force, helper)
    assert result[1] is metadata and result[2] == "body" and result[4] is None
    assert result[3] == (None if dashboard else "raw")


def test_patch_snapshots_keep_open_keys_and_copy_at_original_boundaries(tmp_path: Path) -> None:
    path = tmp_path / "page.md"
    opaque = object()
    nested: list[object] = [opaque]
    metadata: PageMetadata = {42: nested, "title": "before", "remove": True}
    events: list[str] = []
    originals: list[PageMetadata] = []
    dependencies = _patch_dependencies(path, metadata, events)

    def process(page_id: str, old: PageMetadata, new: PageMetadata) -> PageMetadata:
        assert old is not metadata and old[42] is nested and old["title"] == "before"
        originals.append(old)
        assert new is metadata and "remove" not in new
        return new

    def write(file_path: Path, current: PageMetadata, content: str) -> None:
        assert current is metadata
        current["during-write"] = True
        events.append("write")

    dependencies = replace(dependencies, process_updates=process, save_page=write)
    request = PagePatchRequest.model_construct(
        title="request-title",
        metadata={"title": opaque, (1, 2): nested},
        remove_metadata_keys=["remove"],
    )
    tasks = BackgroundTasks()
    response = asyncio.run(patch_service.patch_page("page", request, tasks, None, dependencies))
    assert response["metadata"] is metadata and response["title"] is opaque
    assert response["etag"] is None and response["content"] == "before"
    assert metadata[(1, 2)] is nested
    translation = tasks.tasks[-2]
    relations = tasks.tasks[-1]
    assert translation.args[1] is originals[0] and translation.args[2] is metadata
    assert relations.args[2] == originals[0] and relations.args[2] is not originals[0]
    snapshot = relations.args[3]
    assert isinstance(snapshot, dict)
    assert snapshot is not metadata and snapshot[42] is nested
    assert "during-write" not in snapshot and "during-write" in metadata
    assert events == ["author", "write", "cache", "calendar"]


@pytest.mark.parametrize("raw", [None, "", "raw"])
def test_patch_version_callback_selection_and_execution_order(
    tmp_path: Path, raw: str | None
) -> None:
    path = tmp_path / "page.md"
    events: list[str] = []
    metadata: PageMetadata = {}
    dependencies = replace(
        _patch_dependencies(path, metadata, events),
        find_and_read=(lambda page_id, etag, force: (path, metadata, "before", raw, None)),
    )
    tasks = BackgroundTasks()
    asyncio.run(patch_service.patch_page("page", PagePatchRequest(), tasks, None, dependencies))
    assert events == ["author", "write", "cache", "calendar"]
    assert tasks.tasks[0].args == ("page", path if raw is None else raw)
    asyncio.run(tasks())
    assert events[-2:] == ["file-version" if raw is None else "content-version", "links"]


@pytest.mark.parametrize("kind", ["save", "patch"])
def test_automation_failure_keeps_mutated_metadata_and_still_writes(
    tmp_path: Path, kind: str
) -> None:
    path = tmp_path / "page.md"
    events: list[str] = []
    marker = object()

    def failing(page_id: str, old: PageMetadata, new: PageMetadata) -> PageMetadata:
        new[42] = marker
        raise ValueError("synthetic automation failure")

    if kind == "save":
        dependencies = replace(_save_dependencies(path, {}, events), process_updates=failing)
        response = asyncio.run(
            save_service.save_page(
                "page",
                PageSaveRequest(title="page", content="body"),
                BackgroundTasks(),
                None,
                dependencies,
            )
        )
    else:
        patch_dependencies = replace(_patch_dependencies(path, {}, events), process_updates=failing)
        response = asyncio.run(
            patch_service.patch_page(
                "page",
                PagePatchRequest(),
                BackgroundTasks(),
                None,
                patch_dependencies,
            )
        )
    result = response["metadata"]
    assert isinstance(result, dict) and result[42] is marker and "write" in events


@pytest.mark.parametrize("nonempty", [False, True])
def test_patch_unhashable_removal_retains_native_empty_dict_shortcut(
    tmp_path: Path,
    nonempty: bool,
) -> None:
    # Do not assume pop hashes keys on an empty dict: its native shortcut
    # returns the default. Use a populated dict to characterize TypeError.
    events: list[str] = []
    metadata: PageMetadata = {"title": "page"} if nonempty else {}
    dependencies = _patch_dependencies(tmp_path / "page.md", metadata, events)
    request = PagePatchRequest.model_construct(remove_metadata_keys=[["not-hashable"]])
    if not nonempty:
        result = asyncio.run(
            patch_service.patch_page(
                "page",
                request,
                BackgroundTasks(),
                None,
                dependencies,
            )
        )
        assert result["metadata"] is metadata and "write" in events
        return
    with pytest.raises(HTTPException) as caught:
        asyncio.run(
            patch_service.patch_page("page", request, BackgroundTasks(), None, dependencies)
        )
    assert caught.value.status_code == 500
    assert type(caught.value.__cause__) is TypeError
    assert str(caught.value.__cause__) == "unhashable type: 'list'"
    assert events == []


def test_save_read_swallows_parser_error_but_patch_read_preserves_it(tmp_path: Path) -> None:
    path = tmp_path / "page.md"
    path.write_text("raw", encoding="utf-8")
    failure = ValueError("synthetic parser failure")

    def read(raw: str, path: Path) -> tuple[PageMetadata, str]:
        raise failure

    assert save_helpers.read_save_page(
        path, replace(_save_helpers(tmp_path), parse_frontmatter=read)
    ) == ({}, "")
    helper = replace(_patch_helpers(tmp_path), parse_frontmatter=read)
    with pytest.raises(ValueError) as caught:
        patch_helpers.find_and_read_patch_page("page", None, False, helper)
    assert caught.value is failure


@pytest.mark.parametrize("kind", ["save", "patch"])
def test_failed_write_preserves_exception_cause_and_does_not_queue_tasks(
    tmp_path: Path,
    kind: str,
) -> None:
    path = tmp_path / "page.md"
    events: list[str] = []
    tasks = BackgroundTasks()
    failure = OSError("synthetic disk failure")

    def write(path: Path, metadata: PageMetadata, content: str) -> None:
        events.append("failed-write")
        raise failure

    with pytest.raises(HTTPException) as caught:
        if kind == "save":
            dependencies = replace(
                _save_dependencies(path, {}, events),
                write_with_version=(
                    lambda page_id, path, metadata, content: write(path, metadata, content)
                ),
            )
            asyncio.run(
                save_service.save_page(
                    "page",
                    PageSaveRequest(title="new", content="body"),
                    tasks,
                    None,
                    dependencies,
                )
            )
        else:
            patch_dependencies = replace(_patch_dependencies(path, {}, events), save_page=write)
            asyncio.run(
                patch_service.patch_page(
                    "page",
                    PagePatchRequest(),
                    tasks,
                    None,
                    patch_dependencies,
                )
            )
    assert caught.value.status_code == 500 and caught.value.__cause__ is failure
    assert caught.value.detail == ("Error writing file to disk" if kind == "save" else str(failure))
    assert events[-1] == "failed-write"
    assert not {"index", "cache", "invalidate", "calendar"}.intersection(events)
    assert tasks.tasks == []


def test_save_metadata_copy_error_is_native_and_not_a_disk_500(tmp_path: Path) -> None:
    failure = ValueError("synthetic copy failure")

    class InvalidCopy(dict[object, object]):
        def copy(self) -> PageMetadata:
            raise failure

    request = PageSaveRequest.model_construct(title="page", content="body", metadata=InvalidCopy())
    events: list[str] = []
    dependencies = _save_dependencies(tmp_path / "page.md", {}, events)
    with pytest.raises(ValueError) as caught:
        asyncio.run(save_service.save_page("page", request, BackgroundTasks(), None, dependencies))
    assert caught.value is failure and events == ["find"]


def test_save_version_failure_prevents_file_write(tmp_path: Path) -> None:
    path = tmp_path / "page.md"
    path.write_text("before", encoding="utf-8")
    failure = OSError("synthetic snapshot failure")
    events: list[str] = []

    def version(page_id: str, path: Path) -> None:
        events.append("version")
        raise failure

    helper = replace(
        _save_helpers(tmp_path),
        create_page_version=version,
        save_page=lambda path, metadata, content: events.append("write"),
    )
    with pytest.raises(OSError) as caught:
        save_helpers.write_save_page_with_version("page", path, {}, "after", helper)
    assert caught.value is failure and events == ["version"]
    assert path.read_text(encoding="utf-8") == "before"


def test_patch_version_supplier_is_resolved_after_write_but_before_execution(
    tmp_path: Path,
) -> None:
    path = tmp_path / "page.md"
    events: list[str] = []

    def initial(page_id: str, raw: str) -> None:
        events.append("initial")

    def replacement(page_id: str, raw: str) -> None:
        events.append("replacement")

    callback: Callable[[str, str], None] = initial

    def write(path: Path, metadata: PageMetadata, content: str) -> None:
        nonlocal callback
        events.append("write")
        callback = replacement

    def resolve_version() -> Callable[[str, str], None]:
        events.append("resolve-version")
        return callback

    dependencies = replace(
        _patch_dependencies(path, {}, events),
        save_page=write,
        create_content_version=resolve_version,
    )
    tasks = BackgroundTasks()
    asyncio.run(patch_service.patch_page("page", PagePatchRequest(), tasks, None, dependencies))
    assert events == ["author", "write", "cache", "resolve-version", "calendar"]
    assert tasks.tasks[0].func is replacement
    callback = initial
    asyncio.run(tasks())
    assert events[-2:] == ["replacement", "links"]
