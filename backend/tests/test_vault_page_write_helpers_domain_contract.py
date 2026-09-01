"""Characterization contracts for extracted page save and PATCH helpers."""

from __future__ import annotations

import ast
import inspect
import logging
import threading
from dataclasses import fields, replace
from pathlib import Path
from typing import Any

import pytest

from backend.api import vault_routes
from backend.domains.vault.pages import patch_helpers, save_helpers

FACADE_SIGNATURES = {
    "_prepare_save_metadata": ("metadata", "file_path"),
    "_locate_save_file": ("page_id", "title", "metadata", "file_path"),
    "_read_save_page": ("file_path",),
    "_write_save_page_with_version": (
        "page_id",
        "file_path",
        "metadata",
        "content",
    ),
    "_find_and_read_patch_page": ("page_id", "expected_etag", "force"),
    "_prepare_patch_metadata": ("metadata", "file_path"),
    "_relocate_patch_file": ("page_id", "file_path", "metadata", "title"),
    "_update_patch_caches": (
        "page_id",
        "file_path",
        "metadata",
        "content",
        "original_metadata",
    ),
}


def _save_dependencies(vault: Path) -> save_helpers.SaveHelperDependencies:
    return save_helpers.SaveHelperDependencies(
        normalize_metadata_ids=lambda metadata: metadata,
        normalize_table_context=lambda metadata: metadata,
        get_table_id=lambda _metadata: None,
        table_by_id=lambda _table_id: None,
        to_storage_names=lambda metadata, _table: (metadata, False),
        created_iso=lambda timestamp: str(timestamp),
        stamp_system_dates=lambda _metadata, _table, _is_create, _created: None,
        get_path=lambda _name: vault,
        is_calendar_entry=lambda _metadata: False,
        resolve_table_folder=lambda _metadata: None,
        canonicalize_id=lambda value: str(value).replace("-", "").lower(),
        parse_frontmatter=lambda content, _path: ({}, content),
        active_vault_path=lambda: vault,
        index_lock=lambda: threading.RLock(),
        id_to_path=dict,
        safe_filename=lambda title, _target: title,
        ensure_correct_location=lambda path, _metadata: path,
        rename_to_title=lambda path, _title: path,
        remove_from_index=lambda _page_id, _path: None,
        add_to_index=lambda _path: None,
        create_page_version=lambda _page_id, _path: None,
        save_page=lambda _path, _metadata, _content: None,
        logger=lambda: logging.getLogger(__name__),
    )


def _patch_dependencies(vault: Path) -> patch_helpers.PatchHelperDependencies:
    return patch_helpers.PatchHelperDependencies(
        find_page_for_write=lambda _page_id: None,
        file_etag=lambda _path: None,
        is_dashboard_file=lambda _path: False,
        read_dashboard_file=lambda _path: ({}, ""),
        parse_frontmatter=lambda content, _path: ({}, content),
        normalize_metadata_ids=lambda metadata: metadata,
        normalize_table_context=lambda metadata: metadata,
        get_table_id=lambda _metadata: None,
        table_by_id=lambda _table_id: None,
        to_storage_names=lambda metadata, _table: (metadata, False),
        created_iso=lambda timestamp: str(timestamp),
        stamp_system_dates=lambda _metadata, _table, _is_create, _created: None,
        ensure_correct_location=lambda path, _metadata: path,
        rename_to_title=lambda path, _title: path,
        remove_from_index=lambda _page_id, _path: None,
        add_to_index=lambda _path: None,
        active_vault_path=lambda: vault,
        index_lock=lambda: threading.RLock(),
        index_entries=dict,
        id_to_path=dict,
        build_cache_entry=lambda path, _stat, metadata, _content: {
            "id": metadata.get("id"),
            "path": str(path),
        },
        bump_index_version=lambda _vault_key: None,
        add_to_path_resolver=lambda _vault, _page_id, _path: None,
        body_cache_lock=lambda: threading.RLock(),
        body_cache=dict,
        invalidate_page_responses=lambda: None,
        invalidate_citation_index=lambda: None,
        iter_docs_lock=lambda: threading.RLock(),
        iter_docs_cache=dict,
        path_factory=Path,
        logger=lambda: logging.getLogger(__name__),
    )


def test_legacy_helpers_preserve_signatures_and_are_thin_facades() -> None:
    for name, parameter_names in FACADE_SIGNATURES.items():
        helper = getattr(vault_routes, name)
        assert tuple(inspect.signature(helper).parameters) == parameter_names

        tree = ast.parse(inspect.getsource(helper))
        function = tree.body[0]
        assert isinstance(function, ast.FunctionDef)
        assert len(function.body) == 1
        assert isinstance(function.body[0], (ast.Expr, ast.Return))


def test_page_write_domains_do_not_import_the_http_facade() -> None:
    for module in (save_helpers, patch_helpers):
        source_path = Path(module.__file__ or "")
        assert source_path.is_file()
        assert "backend.api.vault_routes" not in source_path.read_text(encoding="utf-8")


def test_every_helper_dependency_is_a_late_bound_port() -> None:
    dependency_sets = (
        vault_routes._SAVE_HELPER_DEPENDENCIES,
        vault_routes._PATCH_HELPER_DEPENDENCIES,
    )
    for dependencies in dependency_sets:
        for field in fields(dependencies):
            assert callable(getattr(dependencies, field.name)), field.name


def test_route_services_resolve_all_historical_helpers_late(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    marker = object()
    metadata: dict[str, Any] = {}
    path = tmp_path / "page.md"

    save_cases: tuple[tuple[str, str, tuple[object, ...]], ...] = (
        ("_prepare_save_metadata", "prepare_metadata", (metadata, None)),
        ("_locate_save_file", "locate_file", ("page", "Title", metadata, None)),
        ("_read_save_page", "read_page", (path,)),
        (
            "_write_save_page_with_version",
            "write_with_version",
            ("page", path, metadata, "Body"),
        ),
    )
    for facade_name, dependency_name, save_arguments in save_cases:
        monkeypatch.setattr(vault_routes, facade_name, lambda *_args: marker)
        dependency = getattr(vault_routes._SAVE_PAGE_DEPENDENCIES, dependency_name)
        assert dependency(*save_arguments) is marker

    patch_cases: tuple[tuple[str, str, tuple[object, ...]], ...] = (
        (
            "_find_and_read_patch_page",
            "find_and_read",
            ("page", "etag", False),
        ),
        ("_prepare_patch_metadata", "prepare_metadata", (metadata, path)),
        (
            "_relocate_patch_file",
            "relocate_file",
            ("page", path, metadata, "Title"),
        ),
        (
            "_update_patch_caches",
            "update_caches",
            ("page", path, metadata, "Body", metadata),
        ),
    )
    for facade_name, dependency_name, patch_arguments in patch_cases:
        monkeypatch.setattr(vault_routes, facade_name, lambda *_args: marker)
        dependency = getattr(vault_routes._PATCH_PAGE_DEPENDENCIES, dependency_name)
        assert dependency(*patch_arguments) is marker


def test_save_helper_ports_follow_replaced_facade_symbols(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    replacement_paths: dict[str, dict[str, str]] = {}
    marker = {"normalized": True}
    monkeypatch.setattr(vault_routes, "normalize_metadata_ids", lambda _value: marker)
    monkeypatch.setattr(vault_routes, "_page_id_to_path", replacement_paths)

    dependencies = vault_routes._SAVE_HELPER_DEPENDENCIES
    assert dependencies.normalize_metadata_ids({}) is marker
    assert dependencies.id_to_path() is replacement_paths


def test_complete_save_reuses_matching_id_and_snapshots_before_write(
    tmp_path: Path,
) -> None:
    vault = tmp_path / "vault"
    vault.mkdir()
    existing = vault / "existing.md"
    existing.write_text("page-id", encoding="utf-8")
    id_to_path: save_helpers.PageIdPaths = {}
    events: list[str] = []
    dependencies = replace(
        _save_dependencies(vault),
        parse_frontmatter=lambda content, _path: ({"id": content}, ""),
        id_to_path=lambda: id_to_path,
        create_page_version=lambda _page_id, _path: events.append("version"),
        save_page=lambda _path, _metadata, _content: events.append("write"),
    )

    located = save_helpers.locate_save_file(
        "page-id",
        "Different title",
        {},
        None,
        dependencies,
    )
    save_helpers.write_save_page_with_version(
        "page-id",
        located,
        {"id": "page-id"},
        "Body",
        dependencies,
    )

    assert located == existing
    assert id_to_path[str(vault)]["page-id"] == str(existing)
    assert events == ["version", "write"]


def test_metadata_helpers_preserve_storage_dates_and_dashboard_rules(
    tmp_path: Path,
) -> None:
    page = tmp_path / "page.md"
    page.write_text("Body", encoding="utf-8")
    table: dict[str, Any] = {"id": "table"}
    save_stamps: list[tuple[bool, str | None]] = []
    patch_stamps: list[tuple[bool, str | None]] = []

    def stamp_save(
        _metadata: dict[str, Any],
        _table: dict[str, Any],
        is_create: bool,
        created_fallback: str | None,
    ) -> None:
        save_stamps.append((is_create, created_fallback))

    def stamp_patch(
        _metadata: dict[str, Any],
        _table: dict[str, Any],
        is_create: bool,
        created_fallback: str | None,
    ) -> None:
        patch_stamps.append((is_create, created_fallback))

    save_dependencies = replace(
        _save_dependencies(tmp_path),
        normalize_metadata_ids=lambda metadata: {**metadata, "ids": True},
        normalize_table_context=lambda metadata: {**metadata, "context": True},
        get_table_id=lambda _metadata: "table",
        table_by_id=lambda _table_id: table,
        to_storage_names=lambda metadata, _table: (
            {**metadata, "storage": True},
            True,
        ),
        created_iso=lambda _timestamp: "created",
        stamp_system_dates=stamp_save,
    )
    saved_metadata, saved_table = save_helpers.prepare_save_metadata(
        {"id": "page"},
        page,
        save_dependencies,
    )

    patch_dependencies = replace(
        _patch_dependencies(tmp_path),
        get_table_id=lambda _metadata: "table",
        table_by_id=lambda _table_id: table,
        to_storage_names=lambda metadata, _table: (metadata, False),
        created_iso=lambda _timestamp: "created",
        stamp_system_dates=stamp_patch,
    )
    patched_metadata, patched_table = patch_helpers.prepare_patch_metadata(
        {"id": "page", "is_dashboard": True, "content_format": "json"},
        page,
        patch_dependencies,
    )

    assert saved_metadata == {
        "id": "page",
        "ids": True,
        "context": True,
        "storage": True,
    }
    assert saved_table is table
    assert save_stamps == [(False, "created")]
    assert patched_metadata == {"id": "page", "is_dashboard": True}
    assert patched_table is table
    assert patch_stamps == [(False, "created")]


def test_save_read_fallback_and_patch_relocation_preserve_index_updates(
    tmp_path: Path,
) -> None:
    page = tmp_path / "page.md"
    page.write_text("not valid", encoding="utf-8")

    def invalid_frontmatter(
        _content: str,
        _path: Path,
    ) -> tuple[dict[str, Any], str]:
        raise ValueError("invalid")

    failing_reader = replace(
        _save_dependencies(tmp_path),
        parse_frontmatter=invalid_frontmatter,
    )
    assert save_helpers.read_save_page(page, failing_reader) == ({}, "")
    assert save_helpers.read_save_page(tmp_path / "missing.md", failing_reader) == (
        {},
        "",
    )

    moved = tmp_path / "moved.md"
    id_to_path: patch_helpers.PageIdPaths = {}
    events: list[tuple[str, Path]] = []
    relocation_dependencies = replace(
        _patch_dependencies(tmp_path),
        ensure_correct_location=lambda _path, _metadata: moved,
        rename_to_title=lambda path, _title: path,
        remove_from_index=lambda _page_id, path: events.append(("remove", path)),
        add_to_index=lambda path: events.append(("add", path)),
        id_to_path=lambda: id_to_path,
    )
    relocated = patch_helpers.relocate_patch_file(
        "page-id",
        page,
        {"id": "page-id"},
        "Moved",
        relocation_dependencies,
    )

    assert relocated == moved
    assert events == [("remove", page), ("add", moved)]
    assert id_to_path[str(tmp_path)]["page-id"] == str(moved)


def test_patch_read_short_circuits_on_etag_and_preserves_dashboard_shape(
    tmp_path: Path,
) -> None:
    page = tmp_path / "page.md"
    page.write_text("raw markdown", encoding="utf-8")
    parse_calls: list[Path] = []

    def parse_frontmatter(content: str, path: Path) -> tuple[dict[str, Any], str]:
        parse_calls.append(path)
        return {"id": "page"}, content

    dependencies = replace(
        _patch_dependencies(tmp_path),
        find_page_for_write=lambda _page_id: page,
        file_etag=lambda _path: "current",
        parse_frontmatter=parse_frontmatter,
    )

    conflict = patch_helpers.find_and_read_patch_page(
        "page",
        "stale",
        False,
        dependencies,
    )
    assert conflict == (page, None, None, None, "current")
    assert parse_calls == []

    dashboard_dependencies = replace(
        dependencies,
        is_dashboard_file=lambda _path: True,
        read_dashboard_file=lambda _path: ({"id": "page"}, "dashboard"),
    )
    dashboard = patch_helpers.find_and_read_patch_page(
        "page",
        None,
        False,
        dashboard_dependencies,
    )
    assert dashboard == (page, {"id": "page"}, "dashboard", None, None)


def test_patch_cache_update_refreshes_every_derived_cache(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    vault.mkdir()
    page = vault / "page.md"
    page.write_text("Body", encoding="utf-8")
    vault_key = str(vault)
    index_entries: patch_helpers.PageIndexEntries = {}
    id_to_path: patch_helpers.PageIdPaths = {}
    body_cache: patch_helpers.BodyCache = {str(page): (1, "stale")}
    iter_docs: patch_helpers.IterDocsCache = {
        vault_key: {"docs": [(page, {"id": "old"}, "Old", False)]}
    }
    events: list[str] = []
    resolver_calls: list[tuple[Path, str | None, Path]] = []
    dependencies = replace(
        _patch_dependencies(vault),
        active_vault_path=lambda: vault,
        index_entries=lambda: index_entries,
        id_to_path=lambda: id_to_path,
        build_cache_entry=lambda path, _stat, metadata, content: {
            "id": "new-id",
            "path": str(path),
            "metadata": dict(metadata),
            "body": content,
        },
        bump_index_version=lambda key: events.append(f"bump:{key}"),
        add_to_path_resolver=lambda root, page_id, path: resolver_calls.append(
            (root, page_id, path)
        ),
        body_cache=lambda: body_cache,
        invalidate_page_responses=lambda: events.append("pages"),
        invalidate_citation_index=lambda: events.append("citations"),
        iter_docs_cache=lambda: iter_docs,
    )

    patch_helpers.update_patch_caches(
        "page-id",
        page,
        {"id": "new-id", "Citation Key": "new"},
        "New body",
        {"id": "new-id", "Citation Key": "old"},
        dependencies,
    )

    assert index_entries[vault_key][str(page)]["body"] == "New body"
    assert id_to_path[vault_key]["new-id"] == str(page)
    assert resolver_calls == [(vault, "new-id", page)]
    assert str(page) not in body_cache
    assert events == [f"bump:{vault_key}", "pages", "citations"]
    assert iter_docs[vault_key]["docs"] == [
        (page, {"id": "new-id", "Citation Key": "new"}, "New body", False)
    ]
