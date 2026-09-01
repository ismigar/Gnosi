"""Architecture and behavior contracts for table-scoped asset lifecycle."""

from __future__ import annotations

import ast
import inspect
from pathlib import Path

import pytest

from backend.api import vault_routes
from backend.domains.vault.assets import persistence, quarantine, table_paths
from backend.domains.vault.tables import folders

CANONICAL_EXPORTS = {
    "_ensure_table_vault_folder": folders._ensure_table_vault_folder,
    "_table_vault_dir": folders._table_vault_dir,
    "_asset_segments_collide": table_paths._asset_segments_collide,
    "_delete_asset_property_dir": table_paths._delete_asset_property_dir,
    "_delete_asset_table_dir": table_paths._delete_asset_table_dir,
    "_ensure_asset_dirs_for_table_entry": table_paths._ensure_asset_dirs_for_table_entry,
    "_find_table_property": table_paths._find_table_property,
    "_move_loose_files": table_paths._move_loose_files,
    "_property_assets_dir": table_paths._property_assets_dir,
    "_property_config_value": table_paths._property_config_value,
    "_resolve_table_and_database_for_assets": (table_paths._resolve_table_and_database_for_assets),
    "_rewrite_inline_asset_refs": table_paths._rewrite_inline_asset_refs,
    "_table_asset_paths": table_paths._table_asset_paths,
    "_table_asset_revision": table_paths._table_asset_revision,
    "_table_assets_dir": table_paths._table_assets_dir,
    "_copy_local_file_to_assets": persistence._copy_local_file_to_assets,
    "_delete_asset_files_for_page": persistence._delete_asset_files_for_page,
    "_persist_asset_value": persistence._persist_asset_value,
    "_persist_metadata_assets": persistence._persist_metadata_assets,
    "_save_data_url_image_to_assets": persistence._save_data_url_image_to_assets,
    "_save_uploaded_file_to_assets": persistence._save_uploaded_file_to_assets,
    "_cleanup_registry_table_ids": quarantine._cleanup_registry_table_ids,
    "_delete_table_asset_quarantine": quarantine._delete_table_asset_quarantine,
    "_mark_table_asset_quarantine_ready": quarantine._mark_table_asset_quarantine_ready,
    "_quarantine_table_asset_dirs": quarantine._quarantine_table_asset_dirs,
    "_quarantined_table_asset_revision": quarantine._quarantined_table_asset_revision,
    "_restore_abandoned_table_asset_quarantine": (
        quarantine._restore_abandoned_table_asset_quarantine
    ),
    "_restore_quarantined_table_assets": quarantine._restore_quarantined_table_assets,
    "_table_asset_cleanup_root": quarantine._table_asset_cleanup_root,
    "cleanup_pending_table_asset_quarantines": (quarantine.cleanup_pending_table_asset_quarantines),
}


def _point_vault_paths(monkeypatch: pytest.MonkeyPatch, vault: Path) -> None:
    paths = {
        "VAULT": vault,
        "ASSETS": vault / "Assets",
        "DATABASES": vault / "BD",
        "REGISTRY": vault / "BD" / "vault_db_registry.json",
    }
    monkeypatch.setattr(vault_routes, "get_p", lambda key: paths[key])


def test_legacy_facade_exports_canonical_table_asset_callables() -> None:
    for name, implementation in CANONICAL_EXPORTS.items():
        assert getattr(vault_routes, name) is implementation


def test_legacy_facade_no_longer_owns_extracted_functions() -> None:
    tree = ast.parse(inspect.getsource(vault_routes))
    definitions = {
        node.name for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }
    assert definitions.isdisjoint(CANONICAL_EXPORTS)


def test_table_asset_domains_do_not_import_legacy_http_facade() -> None:
    for module in (folders, persistence, quarantine, table_paths):
        source_path = Path(module.__file__ or "")
        assert source_path.is_file()
        assert "backend.api.vault_routes" not in source_path.read_text(encoding="utf-8")


def test_table_folder_migration_resolves_monkeypatched_facade_path(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    vault = tmp_path / "vault"
    legacy = vault / "Records"
    legacy.mkdir(parents=True)
    page = legacy / "record.md"
    page.write_text("content", encoding="utf-8")
    _point_vault_paths(monkeypatch, vault)

    vault_routes._ensure_table_vault_folder(
        {"id": "table", "folder": "Records", "database_id": "database"},
        {
            "databases": [
                {
                    "id": "database",
                    "name": "Database",
                    "folder": "BD/Database",
                }
            ]
        },
    )

    migrated = vault / "BD" / "Database" / "Records" / "record.md"
    assert migrated.read_text(encoding="utf-8") == "content"
    assert not legacy.exists()


def test_page_asset_cleanup_deletes_only_contained_references(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    vault = tmp_path / "vault"
    asset = vault / "Assets" / "Files" / "owned.txt"
    asset.parent.mkdir(parents=True)
    asset.write_text("owned", encoding="utf-8")
    outside = tmp_path / "outside.txt"
    outside.write_text("preserve", encoding="utf-8")
    _point_vault_paths(monkeypatch, vault)

    vault_routes._delete_asset_files_for_page(
        {"Files": ["Assets/Files/owned.txt", "Assets/../../outside.txt"]},
        {
            "id": "table",
            "database_id": "database",
            "properties": [{"name": "Files", "type": "files"}],
        },
        {"databases": [{"id": "database"}]},
    )

    assert not asset.exists()
    assert outside.read_text(encoding="utf-8") == "preserve"


def test_asset_value_persistence_keeps_shape_and_copies_local_files(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    vault = tmp_path / "vault"
    target = vault / "Assets" / "Database" / "Table" / "Files"
    source = tmp_path / "source.txt"
    source.write_text("payload", encoding="utf-8")
    _point_vault_paths(monkeypatch, vault)

    result = vault_routes._persist_asset_value(
        {
            "path": source.as_posix(),
            "url": "/api/vault/assets/Inline/image.png",
            "nested": [{"src": "https://example.test/remote.png"}],
        },
        target,
    )

    assert isinstance(result, dict)
    assert result["path"] == "Assets/Database/Table/Files/source.txt"
    assert result["url"] == "Assets/Inline/image.png"
    assert result["nested"] == [{"src": "https://example.test/remote.png"}]
    assert (target / "source.txt").read_text(encoding="utf-8") == "payload"
