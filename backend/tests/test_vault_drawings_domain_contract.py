"""Behavior and architecture contracts for Vault drawing persistence."""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
from pathlib import Path

import pytest

from backend.domains.vault.drawings import service


def _dependencies(tmp_path: Path) -> service.DrawingDependencies:
    vault = tmp_path / "vault"
    drawings = vault / "Drawings"
    trash = vault / ".trash"

    def write_json(path: Path, payload: object) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload), encoding="utf-8")

    def move_to_trash(drawing_id: str, source: Path) -> service.JsonObject:
        entry = trash / drawing_id
        entry.mkdir(parents=True, exist_ok=True)
        shutil.move(source, entry / "page.md")
        return {"id": drawing_id, "deleted_at": "2026-08-28T00:00:00"}

    return service.DrawingDependencies(
        drawings_directory=lambda: drawings,
        vault_root=lambda: vault,
        move_to_trash=move_to_trash,
        trash_entry_directory=lambda drawing_id: trash / drawing_id,
        write_drawing_json=write_json,
        write_trash_json=write_json,
        copy_file=lambda source, target: shutil.copy2(source, target),
        current_time=lambda: 1_000.0,
        timestamp_label=lambda: "20260828_000000",
        modified_iso=lambda timestamp: f"mtime:{timestamp}",
        logger=logging.getLogger(__name__),
    )


def test_listing_prefers_tldraw_and_retains_legacy_drawings(tmp_path: Path) -> None:
    dependencies = _dependencies(tmp_path)
    drawings = dependencies.drawings_directory()
    drawings.mkdir(parents=True)
    (drawings / "same.tldraw.json").write_text(
        json.dumps({"title": "Current", "data": {"x": 1}}),
        encoding="utf-8",
    )
    (drawings / "same.excalidraw.json").write_text(
        json.dumps({"metadata": {"title": "Duplicate legacy"}}),
        encoding="utf-8",
    )
    (drawings / "legacy.excalidraw.json").write_text(
        json.dumps({"metadata": {"title": "Legacy"}}),
        encoding="utf-8",
    )

    listed = asyncio.run(service.list_drawings(dependencies))

    assert {item["id"] for item in listed} == {"same", "legacy"}
    assert next(item for item in listed if item["id"] == "same")["title"] == ("Current")


def test_save_snapshots_previous_drawing_and_returns_inner_data(tmp_path: Path) -> None:
    dependencies = _dependencies(tmp_path)
    drawings = dependencies.drawings_directory()
    drawings.mkdir(parents=True)
    current = drawings / "diagram.tldraw.json"
    current.write_text(
        json.dumps({"title": "Before", "data": {"version": 1}}),
        encoding="utf-8",
    )

    result = asyncio.run(
        service.save_drawing(
            "diagram",
            "After",
            {"version": 2},
            {},
            dependencies,
        )
    )

    assert result == {"status": "success", "id": "diagram"}
    backup = dependencies.vault_root() / ".history" / "diagram" / "20260828_000000.tldraw.json"
    assert json.loads(backup.read_text(encoding="utf-8"))["data"] == {"version": 1}
    assert asyncio.run(service.get_drawing("diagram", dependencies)) == {"version": 2}


def test_missing_and_invalid_drawings_have_distinct_failures(tmp_path: Path) -> None:
    dependencies = _dependencies(tmp_path)
    drawings = dependencies.drawings_directory()
    drawings.mkdir(parents=True)
    (drawings / "broken.tldraw.json").write_text("[]", encoding="utf-8")

    with pytest.raises(service.DrawingNotFoundError):
        asyncio.run(service.get_drawing("missing", dependencies))
    with pytest.raises(service.DrawingReadError):
        asyncio.run(service.get_drawing("broken", dependencies))


def test_drawings_domain_does_not_import_http_facade() -> None:
    source_path = Path(service.__file__ or "")
    assert source_path.is_file()
    assert "backend.api.vault_routes" not in source_path.read_text(encoding="utf-8")
