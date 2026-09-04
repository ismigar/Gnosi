"""Regression coverage for open trash/assets ports and optional active vaults."""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path

import pytest
from fastapi import HTTPException, UploadFile
from fastapi.responses import FileResponse

from backend.api import vault_routes
from backend.domains.vault.api import trash as trash_api
from backend.domains.vault.assets import service as assets_service
from backend.domains.vault.comments.repository import PageCommentMap
from backend.domains.vault.files import api as files_api
from backend.domains.vault.files import local_service, property_service
from backend.domains.vault.pages.foundation_values import PageMetadata
from backend.domains.vault.registry.state import RegistryData
from backend.domains.vault.trash import purge
from backend.domains.vault.trash.repository import TrashMetadata
from backend.services.library_paths import library_roots


async def _materialize(path: Path, label: str) -> None:
    return None


def _trash_dependencies(root: Path) -> trash_api.TrashDependencies:
    async def lock(page_id: str) -> asyncio.Lock:
        return asyncio.Lock()

    async def materialize(page_id: str) -> None:
        return None

    def purged(page_id: str) -> purge.PurgeResult:
        return {"id": page_id, "freed_bytes": 7}

    return trash_api.TrashDependencies(
        retention_days=90,
        validate_page_id=lambda value: value.strip(),
        get_page_write_lock=lock,
        find_page=lambda page_id: root / "sample.md",
        move_page=lambda page_id, path: {},
        remove_link_index=lambda page_id: None,
        remove_page_index=lambda page_id, path: None,
        emit_page_deleted=lambda page_id: None,
        materialize_sidecar=materialize,
        restore_page=lambda page_id: {},
        add_page_index=lambda path: None,
        vault_root=lambda: root,
        read_entries=lambda: [],
        trash_root=lambda: root,
        purge_entry=purged,
        safe_error_detail=lambda error, label: f"safe:{label}:{error}",
    )


def test_delete_retains_opaque_response_values_and_callback_order(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    path = tmp_path / "sample.md"
    path.write_text("synthetic", encoding="utf-8")
    events: list[str] = []
    title = object()
    original = object()
    sidecar: TrashMetadata = {
        "title": title,
        "original_path": original,
        "deleted_at": "malformed",
        7: object(),
    }

    async def lock(page_id: str) -> asyncio.Lock:
        assert page_id == " sample "
        events.append("lock")
        return asyncio.Lock()

    def validate(page_id: str) -> str:
        events.append("validate")
        return page_id.strip()

    def find(page_id: str) -> Path:
        assert page_id == "sample"
        events.append("find")
        return path

    def move(page_id: str, source: Path) -> TrashMetadata:
        assert source == path and page_id == "sample"
        events.append("move")
        return sidecar

    dependencies = replace(
        _trash_dependencies(tmp_path),
        get_page_write_lock=lock,
        validate_page_id=validate,
        find_page=find,
        move_page=move,
        remove_link_index=lambda page_id: events.append("links"),
        remove_page_index=lambda page_id, path: events.append("index"),
        emit_page_deleted=lambda page_id: events.append("emit"),
    )
    monkeypatch.setattr(trash_api, "_dependencies", dependencies)
    result = asyncio.run(trash_api.delete_page(" sample "))
    assert result["title"] is title and result["original_path"] is original
    assert result["deleted_at"] == "malformed" and result["restorable_until"] is None
    assert result["id"] == "sample" and result["retention_days"] == 90
    assert events == ["lock", "validate", "find", "move", "links", "index", "emit"]


@pytest.mark.parametrize(
    ("error", "status", "detail"),
    [
        (FileNotFoundError("missing"), 404, "Trash entry not found"),
        (FileExistsError("taken"), 409, "A file already exists at the target path: taken"),
        (PermissionError("escape"), 400, "escape"),
        (ValueError("invalid"), 500, "safe:POST /pages/{page_id}/restore:invalid"),
    ],
)
def test_restore_keeps_error_mapping_and_materializes_first(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    error: Exception,
    status: int,
    detail: str,
) -> None:
    events: list[str] = []

    async def materialize(page_id: str) -> None:
        assert page_id == "sample"
        events.append("materialize")

    def restore(page_id: str) -> TrashMetadata:
        events.append("restore")
        raise error

    monkeypatch.setattr(
        trash_api,
        "_dependencies",
        replace(
            _trash_dependencies(tmp_path), materialize_sidecar=materialize, restore_page=restore
        ),
    )
    with pytest.raises(HTTPException) as actual:
        asyncio.run(trash_api.restore_page(" sample "))
    assert actual.value.status_code == status and actual.value.detail == detail
    assert actual.value.__cause__ is error
    assert events == ["materialize", "restore"]


def test_list_trash_never_waits_for_bulk_cloud_hydration(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    events: list[str] = []

    def read_entries() -> list[TrashMetadata]:
        events.append("read")
        return [{"id": "synthetic", "title": "Synthetic"}]

    dependencies = replace(
        _trash_dependencies(tmp_path),
        read_entries=read_entries,
    )
    monkeypatch.setattr(trash_api, "_dependencies", dependencies)

    result = asyncio.run(trash_api.list_trash(None))

    assert result == {
        "items": [{"id": "synthetic", "title": "Synthetic"}],
        "retention_days": 90,
    }
    assert events == ["read"]


@pytest.mark.parametrize("purging", [False, True])
def test_materialization_error_stays_outside_http_error_mapping(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, purging: bool
) -> None:
    error = OSError("synthetic provider failure")

    async def materialize(page_id: str) -> None:
        raise error

    monkeypatch.setattr(
        trash_api,
        "_dependencies",
        replace(_trash_dependencies(tmp_path), materialize_sidecar=materialize),
    )
    with pytest.raises(OSError) as actual:
        asyncio.run(
            trash_api.purge_trash_entry("sample") if purging else trash_api.restore_page("sample")
        )
    assert actual.value is error


@pytest.mark.parametrize("bad_root", [None, [], "not a record", 3, {}, {"deleted_at": None}])
def test_retention_rejects_malformed_sidecars_without_purging(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, bad_root: object
) -> None:
    now = datetime(2026, 8, 31, tzinfo=timezone.utc)
    for name, value in (
        ("old", {"deleted_at": (now - timedelta(days=91)).isoformat()}),
        ("fresh", {"deleted_at": now.isoformat()}),
        ("malformed", bad_root),
    ):
        slot = tmp_path / name
        slot.mkdir()
        (slot / "_trash.json").write_text(json.dumps(value), encoding="utf-8")
    seen: list[str] = []

    def purged(page_id: str) -> purge.PurgeResult:
        seen.append(page_id)
        return {"id": page_id, "freed_bytes": 7}

    monkeypatch.setattr(
        trash_api, "_dependencies", replace(_trash_dependencies(tmp_path), purge_entry=purged)
    )
    assert trash_api.purge_expired_trash(now) == {"purged_count": 1, "freed_bytes": 7, "skipped": 1}
    assert seen == ["old"]
    assert all(path.is_dir() for path in tmp_path.iterdir())


@pytest.mark.parametrize("cleanup_fails", [False, True])
def test_purge_retains_open_metadata_comments_and_best_effort_order(
    tmp_path: Path, cleanup_fails: bool
) -> None:
    slot = tmp_path / "slot"
    slot.mkdir()
    (slot / "page.md").write_text("body", encoding="utf-8")
    history = tmp_path / ".history" / "sample"
    history.mkdir(parents=True)
    key = object()
    opaque = object()
    metadata: PageMetadata = {key: opaque, "table_id": 23}
    comments: PageCommentMap = {"sample": [opaque], key: opaque}
    events: list[str] = []
    saved: list[PageCommentMap] = []

    def parse(content: str, path: Path) -> tuple[PageMetadata, str]:
        assert content == "body" and path == slot / "page.md"
        events.append("parse")
        return metadata, content

    def remove(path: Path) -> None:
        events.append("remove-slot" if path == slot else "remove-history")
        assert path in (slot, history)

    def inverse(page_id: str, table_id: str, old: PageMetadata, new: PageMetadata) -> None:
        assert page_id == "sample" and table_id == "23"
        assert old is metadata and old[key] is opaque and new == {}
        events.append("inverse")
        if cleanup_fails:
            raise ValueError("synthetic inverse failure")

    def delete_sidecar(root: Path, page_id: str) -> None:
        assert root == tmp_path and page_id == "sample"
        events.append("sidecar")
        if cleanup_fails:
            raise ValueError("synthetic sidecar failure")

    def load_comments() -> PageCommentMap:
        events.append("load-comments")
        return comments

    def save_comments(value: PageCommentMap) -> None:
        events.append("save-comments")
        saved.append(value)

    dependencies = purge.PurgeDependencies(
        entry_directory=lambda page_id: slot,
        parse_frontmatter=parse,
        remove_tree=remove,
        propagate_relation_inverse=inverse,
        vault_root=lambda: tmp_path,
        delete_metadata_sidecar=delete_sidecar,
        validate_page_id=lambda value: value,
        load_comments=load_comments,
        save_comments=save_comments,
        inline_comments_path=lambda page_id: tmp_path / "missing-inline.json",
        logger=logging.getLogger(__name__),
    )
    assert purge.purge_trash_entry("sample", dependencies) == {"id": "sample", "freed_bytes": 4}
    assert saved[0] is comments and comments == {key: opaque}
    assert events == [
        "parse",
        "remove-slot",
        "inverse",
        "sidecar",
        "remove-history",
        "load-comments",
        "save-comments",
    ]
    assert (slot / "page.md").read_text() == "body"


def _property_dependencies(root: Path) -> property_service.PropertyFileDependencies:
    return property_service.PropertyFileDependencies(
        get_path=lambda key: root,
        load_registry=lambda: {},
        resolve_table=lambda table_id, registry: (None, None),
        find_property=lambda table, name: None,
        property_config_value=lambda prop, key: "",
        property_assets_dir=lambda table, database, name: root / "Assets",
        sanitize_filename=lambda value: value,
        sanitize_segment=lambda value, fallback: value,
        active_vault_path=lambda: None,
        library_roots=lambda path: [root / "Library"],
    )


def test_property_upload_preserves_open_registry_and_free_storage_guard(tmp_path: Path) -> None:
    key = object()
    opaque = object()
    table: RegistryData = {"id": "table", key: opaque}
    database: RegistryData = {key: opaque}
    prop: RegistryData = {"storage_folder": "", key: opaque}
    registry: RegistryData = {"tables": [table], key: opaque}
    events: list[str] = []

    def resolve(table_id: str, value: RegistryData) -> tuple[RegistryData, RegistryData]:
        assert table_id == "table" and value is registry
        events.append("resolve")
        return table, database

    def find(value: RegistryData | None, name: str) -> RegistryData:
        assert value is table and name == "Files"
        events.append("property")
        return prop

    def config(value: RegistryData | None, name: str) -> object:
        assert value is prop and name == "storage_folder"
        events.append("config")
        return prop[name]

    def target(value: RegistryData, parent: RegistryData | None, name: str) -> Path:
        assert value is table and parent is database and name == "Files"
        events.append("assets")
        return tmp_path / "Assets"

    dependencies = replace(
        _property_dependencies(tmp_path),
        load_registry=lambda: registry,
        resolve_table=resolve,
        find_property=find,
        property_config_value=config,
        property_assets_dir=target,
    )
    upload = UploadFile(file=BytesIO(b"payload"), filename="sample.txt")
    result = asyncio.run(
        property_service.upload_property_file(
            table_id="table",
            property_name=" Files ",
            storage_folder="free",
            target_name="named",
            file=upload,
            dest_folder=str(tmp_path / "not-authorized"),
            dependencies=dependencies,
        )
    )
    assert result == {
        "path": "Assets/named.txt",
        "url": "/api/vault/assets/named.txt",
        "storage": "assets",
    }
    assert (tmp_path / "Assets" / "named.txt").read_bytes() == b"payload"
    assert not (tmp_path / "not-authorized").exists()
    assert events == ["resolve", "property", "config", "assets"]
    assert table[key] is opaque and registry[key] is opaque


def test_asset_upload_keeps_open_table_identity(tmp_path: Path) -> None:
    key = object()
    opaque = object()
    table: RegistryData = {"id": "table", key: opaque}
    database: RegistryData = {key: opaque}
    registry: RegistryData = {"tables": [table], key: opaque}
    events: list[str] = []

    def resolve(table_id: str, value: RegistryData) -> tuple[RegistryData, RegistryData]:
        assert value is registry and table_id == "table"
        events.append("resolve")
        return table, database

    def target(value: RegistryData, parent: RegistryData | None) -> Path:
        assert value is table and parent is database
        events.append("target")
        return tmp_path / "Assets" / "Table"

    def save(upload: UploadFile, directory: Path, name: str) -> str:
        assert directory == tmp_path / "Assets" / "Table" / "Files" and name == "named"
        events.append("save")
        return "Assets/Table/Files/named.txt"

    dependencies = assets_service.AssetDependencies(
        get_path=lambda key: tmp_path,
        load_registry=lambda: registry,
        resolve_table=resolve,
        table_assets_dir=target,
        save_uploaded_asset=save,
        safe_write_bytes=lambda path, payload: None,
        validate_external_url=lambda url: (True, ""),
    )
    upload = UploadFile(file=BytesIO(b"payload"), filename="sample.txt")
    result = asyncio.run(assets_service.upload_asset(upload, "table", "named", dependencies))
    assert result == {
        "url": "/api/vault/assets/Table/Files/named.txt",
        "path": "Assets/Table/Files/named.txt",
        "is_image": False,
    }
    assert events == ["resolve", "target", "save"]
    assert registry[key] is opaque and table[key] is opaque


def test_optional_vault_reaches_library_ports_without_substitution(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    root = tmp_path / "Library"
    root.mkdir()
    path = root / "sample.txt"
    path.write_text("payload", encoding="utf-8")
    seen: list[Path | None] = []

    def roots(value: Path | None) -> list[Path]:
        seen.append(value)
        return [root]

    property_dependencies = replace(_property_dependencies(tmp_path), library_roots=roots)
    assert property_service.file_response_payload(path, "absolute", property_dependencies) == {
        "path": str(path),
        "url": "/api/vault/library/sample.txt",
        "storage": "absolute",
    }
    link_dependencies = local_service.LinkFileDependencies(
        resolve_target=lambda value: path,
        materialize=_materialize,
        sanitize_filename=lambda value: value,
        library_roots=roots,
        active_vault_path=lambda: None,
        get_path=lambda key: tmp_path,
        host_home_path=lambda: tmp_path,
    )
    result = asyncio.run(
        local_service.link_existing_file({"file_path": str(path)}, link_dependencies)
    )
    assert result["url"] == "/api/vault/library/sample.txt" and result["renamed"] is False
    assert vault_routes.files_api is files_api
    monkeypatch.setattr(
        files_api,
        "_dependencies",
        replace(files_api._deps(), active_vault_path=lambda: None, library_roots=roots),
    )
    response = FileResponse(path)

    async def serve(directory: Path, relative: str) -> FileResponse:
        assert directory == root and relative == "sample.txt"
        return response

    monkeypatch.setattr(files_api, "_serve_file_with_containment", serve)
    assert asyncio.run(files_api.serve_library_file("sample.txt")) is response
    assert seen == [None, None, None]


def test_optional_vault_keeps_native_library_error(tmp_path: Path) -> None:
    dependencies = replace(_property_dependencies(tmp_path), library_roots=library_roots)
    with pytest.raises(TypeError) as direct:
        library_roots(None)
    with pytest.raises(TypeError) as actual:
        property_service.file_response_payload(tmp_path / "sample.txt", "absolute", dependencies)
    assert str(actual.value) == str(direct.value)
