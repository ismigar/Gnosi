"""Safety tests for property asset cleanup during schema updates."""

from pathlib import Path

import backend.api.vault_routes as vault_routes


def _point_property_dir(monkeypatch, path: Path) -> None:
    monkeypatch.setattr(
        vault_routes,
        "_property_assets_dir",
        lambda _table, _database, _prop_name: path,
    )


def test_property_asset_cleanup_removes_empty_folder(tmp_path, monkeypatch):
    property_dir = tmp_path / "Assets" / "Database" / "Table" / "Files"
    property_dir.mkdir(parents=True)
    _point_property_dir(monkeypatch, property_dir)

    vault_routes._delete_asset_property_dir({}, None, "Files")

    assert not property_dir.exists()


def test_property_asset_cleanup_preserves_non_empty_folder(tmp_path, monkeypatch):
    property_dir = tmp_path / "Assets" / "Database" / "Table" / "Files"
    property_dir.mkdir(parents=True)
    attachment = property_dir / "important.pdf"
    attachment.write_bytes(b"user data")
    _point_property_dir(monkeypatch, property_dir)

    vault_routes._delete_asset_property_dir({}, None, "Files")

    assert attachment.read_bytes() == b"user data"
