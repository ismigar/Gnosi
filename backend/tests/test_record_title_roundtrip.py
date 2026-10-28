"""A header rename must survive schema-name resolution and both save paths."""
from __future__ import annotations

import asyncio
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi import BackgroundTasks

from backend.domains.vault.pages.foundation_values import PageMetadata
from backend.domains.vault.pages.patch_service import patch_page
from backend.domains.vault.pages.save_service import save_page
from backend.domains.vault.schemas.pages import PagePatchRequest, PageSaveRequest
from backend.services.field_resolver import to_response_names, to_storage_names
from backend.tests.page_write_open_fixtures import _patch_dependencies, _save_dependencies


@pytest.mark.parametrize("method", ["patch", "save"])
@pytest.mark.parametrize("name", ["Title", "Record name", "title"])
def test_header_rename_updates_registered_title_without_changing_other_fields(
    tmp_path: Path, method: str, name: str,
) -> None:
    path = tmp_path / "record.md"
    path.write_text("body stays intact", encoding="utf-8")
    table: PageMetadata = {"properties": [
        {"id": "fld_name", "name": name, "type": "title", "aliases": ["Old title"]},
        {"id": "fld_status", "name": "Status", "type": "select"},
    ]}
    original: PageMetadata = {"id": "record", "title": "Old", name: "Old", "Status": "Open", "local": False}
    saved: list[tuple[PageMetadata, str]] = []

    def prepare(metadata: PageMetadata, _path: Path | None) -> tuple[PageMetadata, PageMetadata]:
        return to_storage_names(metadata, table)[0], table

    def capture(_path: Path, metadata: PageMetadata, content: str) -> None:
        saved.append((dict(metadata), content))

    if method == "patch":
        dependencies = replace(_patch_dependencies(path, dict(original), []),
                               prepare_metadata=prepare, save_page=capture)
        asyncio.run(patch_page("record", PagePatchRequest(title="Renamed", metadata=dict(original)),
                               BackgroundTasks(), None, dependencies))
    else:
        dependencies_save = replace(_save_dependencies(path, original, []), prepare_metadata=prepare,
            write_with_version=lambda _id, target, metadata, content: capture(target, metadata, content))
        asyncio.run(save_page("record", PageSaveRequest(title="Renamed", content="body stays intact", metadata=dict(original)),
                              BackgroundTasks(), None, dependencies_save))
    metadata, body = saved[0]
    assert metadata["title"] == "Renamed"
    assert to_response_names(metadata, table)[name] == "Renamed"
    assert metadata["Status"] == "Open" and metadata["local"] is False
    assert body == ("before" if method == "patch" else "body stays intact")


def test_metadata_only_edit_keeps_the_registered_title(tmp_path: Path) -> None:
    path = tmp_path / "record.md"
    original: PageMetadata = {"title": "Header", "Title": "Registered", "Status": "Open"}
    table: PageMetadata = {"properties": [{"id": "fld_name", "name": "Title", "type": "title"}]}
    saved: list[PageMetadata] = []
    dependencies = replace(_patch_dependencies(path, original, []),
        prepare_metadata=lambda metadata, _path: (to_storage_names(metadata, table)[0], table),
        save_page=lambda _path, metadata, _body: saved.append(dict(metadata)))
    asyncio.run(patch_page("record", PagePatchRequest(metadata={"Status": "Done"}), BackgroundTasks(), None, dependencies))
    assert saved[0]["Title"] == "Registered"
    assert saved[0]["Status"] == "Done"
