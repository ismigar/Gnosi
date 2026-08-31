"""Synthetic service boundaries retain raw values and original error ordering."""

from __future__ import annotations

import asyncio
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi import BackgroundTasks, HTTPException

from backend.api import vault_routes
from backend.domains.vault.drupal import composition, matching, service
from backend.domains.vault.pages.foundation_values import PageMetadata
from backend.domains.vault.schemas.pages import PageInfo, PagePatchRequest


class SyncError(Exception):
    pass


class MissingNode(SyncError):
    pass


class SyntheticConnector:
    DrupalSyncError = SyncError
    DrupalNotFound = MissingNode


@pytest.fixture
def dependencies(monkeypatch: pytest.MonkeyPatch) -> service.DrupalSyncDependencies:
    monkeypatch.setattr(vault_routes, "_drupal_client_module", SyntheticConnector)
    return composition._drupal_sync_dependencies()


@pytest.mark.parametrize("raw_mapping", [{"title": "title"}, ["malformed"], 7])
def test_context_preserves_unvalidated_mapping_and_callback_order(
    dependencies: service.DrupalSyncDependencies, tmp_path: Path, raw_mapping: object,
) -> None:
    path = tmp_path / "synthetic.md"
    path.write_text("Synthetic raw document", encoding="utf-8")
    marker = object()
    metadata: PageMetadata = {"id": "row", marker: marker}
    table: PageMetadata = {
        "id": "table", "drupal_sync_enabled": True, "drupal_bundle": " article ",
        "drupal_field_mapping": raw_mapping,
    }
    trace: list[object] = []

    def find(page_id: str) -> Path:
        trace.append(("find", page_id))
        return path

    async def materialize(received: Path, label: str) -> None:
        assert received is path
        trace.append(("materialize", label))

    def parse(raw: str, received: Path) -> tuple[PageMetadata, str]:
        assert received is path and raw == "Synthetic raw document"
        trace.append("parse")
        return metadata, "Body"

    def table_id(received: PageMetadata) -> str:
        assert received is metadata
        trace.append("table-id")
        return "table"

    def table_by_id(identifier: str | None) -> PageMetadata:
        trace.append(("table", identifier))
        return table

    def inject(received: PageMetadata, page_id: str, data: PageMetadata, loader: object) -> None:
        assert received is table and data is metadata
        assert loader is dependencies.virtual_page_loader
        trace.append(("inject", page_id))

    def requires(received: PageMetadata, action: str, data: PageMetadata) -> tuple[bool, None]:
        assert received is table and data is metadata
        trace.append(("requires", action))
        return True, None

    async def list_fields(bundle: str) -> list[dict[str, object]]:
        trace.append(("fields", bundle))
        return [{"field_name": "field_tags", "field_type": "entity_reference", "target_bundles": [marker]}]

    def properties(received: PageMetadata) -> dict[str, PageMetadata]:
        assert received is table
        trace.append("properties")
        return {}

    async def language(data: PageMetadata) -> str:
        assert data is metadata
        trace.append("language")
        return "ca"

    selected = replace(
        dependencies, find_page=find, materialize=materialize, parse_frontmatter=parse,
        table_id=table_id, table_by_id=table_by_id, inject_virtual_fields=inject,
        check_requires=requires, list_fields=list_fields, props_by_ref=properties,
        resolve_langcode=language,
    )
    context = asyncio.run(service._load_context("row", selected))
    assert context.mapping is raw_mapping and context.metadata is metadata and context.table is table
    assert context.field_metadata["field_tags"]["vocab"] is marker
    assert trace == [
        ("find", "row"), ("materialize", "drupal-sync"), "parse", "table-id",
        ("table", "table"), ("inject", "row"), ("requires", dependencies.action_sync_drupal),
        ("fields", "article"), "properties", "language",
    ]


@pytest.mark.parametrize("raw_mapping", [None, {}, [], "", 0])
def test_context_rejects_empty_mapping_only_after_requirements(
    dependencies: service.DrupalSyncDependencies, tmp_path: Path, raw_mapping: object,
) -> None:
    path = tmp_path / "synthetic.md"
    path.write_text("body", encoding="utf-8")
    trace: list[str] = []
    table: PageMetadata = {
        "drupal_sync_enabled": True, "drupal_bundle": "article", "drupal_field_mapping": raw_mapping,
    }

    async def materialize(_path: Path, _label: str) -> None:
        trace.append("materialize")

    def requires(*_args: object) -> tuple[bool, None]:
        trace.append("requires")
        return True, None

    async def fields(_bundle: str) -> list[dict[str, object]]:
        pytest.fail("Field discovery must follow mapping validation")

    selected = replace(
        dependencies, find_page=lambda _id: path, materialize=materialize,
        parse_frontmatter=lambda _raw, _path: ({}, "body"), table_id=lambda _md: "table",
        table_by_id=lambda _id: table, inject_virtual_fields=lambda *_args: trace.append("inject"),
        check_requires=requires, list_fields=fields,
    )
    with pytest.raises(HTTPException) as error:
        asyncio.run(service._load_context("row", selected))
    assert error.value.status_code == 400
    assert error.value.detail == "Drupal content type or field mapping not configured"
    assert trace == ["materialize", "inject", "requires"]


def test_matching_keeps_raw_connector_fields_and_ignored_patch_receipt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    marker = object()
    table: PageMetadata = {"drupal_bundle": "article", marker: "unknown"}
    row = PageInfo.model_construct(id="row", title="  Title  ", metadata={marker: marker})
    tasks = BackgroundTasks()
    trace: list[object] = []

    async def find(bundle: str, title: str) -> list[dict[str, object]]:
        trace.append(("find", bundle, title))
        return [{"uuid": marker, "nid": marker, "url": marker}]

    def identity(received: PageMetadata, uuid: object, nid: object, url: object) -> PageMetadata:
        assert received is table and uuid is marker and nid is marker and url is marker
        trace.append("identity")
        return {"opaque": marker}

    async def patch(page_id: str, request: PagePatchRequest, background: BackgroundTasks) -> object:
        assert background is tasks and request.metadata and request.metadata["opaque"] is marker
        trace.append(("patch", page_id))
        return marker

    monkeypatch.setattr(vault_routes, "_drupal_client_module", SyntheticConnector)
    deps = replace(
        composition._drupal_matching_dependencies(), table_by_id=lambda _id: table,
        pages_for_table=lambda _id: [row], find_nodes_by_title=find,
        identity_metadata=identity, patch_page=patch,
    )
    result = asyncio.run(matching.match_drupal_rows(tasks, {"table_id": 42, "dry_run": False}, deps))
    assert result == {
        "status": "ok", "dry_run": False, "bundle": "article",
        "counts": {"matched": 1, "unmatched": 0, "ambiguous": 0},
        "matched": [{"row_id": "row", "title": "Title", "uuid": marker, "nid": marker, "url": marker, "applied": True}],
        "unmatched": [], "ambiguous": [],
    }
    assert trace == [("find", "article", "Title"), "identity", ("patch", "row")]


def test_matching_invalid_identity_remains_per_row_error(monkeypatch: pytest.MonkeyPatch) -> None:
    row = PageInfo.model_construct(id="row", title="Title", metadata={})

    async def find(_bundle: str, _title: str) -> list[dict[str, object]]:
        return [{"uuid": "node", "nid": 3, "url": "url"}]

    async def patch(*_args: object) -> object:
        pytest.fail("Invalid metadata must fail at the existing request constructor")

    monkeypatch.setattr(vault_routes, "_drupal_client_module", SyntheticConnector)
    deps = replace(
        composition._drupal_matching_dependencies(), table_by_id=lambda _id: {"drupal_bundle": "article"},
        pages_for_table=lambda _id: [row], find_nodes_by_title=find,
        identity_metadata=lambda *_args: {7: "invalid key"}, patch_page=patch,
    )
    result = asyncio.run(matching.match_drupal_rows(BackgroundTasks(), {"table_id": "table", "dry_run": False}, deps))
    assert result["counts"] == {"matched": 1, "unmatched": 0, "ambiguous": 0}
    matched_rows = result["matched"]
    assert isinstance(matched_rows, list) and len(matched_rows) == 1
    assert matched_rows[0]["applied"] is False
    assert "metadata.7.[key]" in matched_rows[0]["error"]
