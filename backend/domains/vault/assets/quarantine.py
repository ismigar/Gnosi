"""Crash-safe quarantine lifecycle for table-owned asset trees."""

from __future__ import annotations

import json
import logging
import os
import shutil
import uuid
from collections.abc import Callable, Iterable
from contextlib import AbstractContextManager
from contextvars import ContextVar
from dataclasses import dataclass
from pathlib import Path
from typing import cast

from backend.domains.vault.registry.state import RegistryData

AssetMoves = list[tuple[Path, Path]]


@dataclass(frozen=True)
class TableAssetQuarantineDependencies:
    """Narrow persistence and synchronization ports for quarantine recovery."""

    get_path: Callable[[str], Path]
    table_asset_paths: Callable[[RegistryData, RegistryData | None], list[Path]]
    revision: Callable[[Iterable[tuple[str, Path]]], str]
    write_json: Callable[[Path, RegistryData], None]
    registry_mutation: Callable[[], AbstractContextManager[None]]
    active_vault_path: ContextVar[Path | None]
    logger: logging.Logger


_dependencies: TableAssetQuarantineDependencies | None = None


def configure(dependencies: TableAssetQuarantineDependencies) -> None:
    """Configure quarantine lifecycle exactly once for one dependency set."""
    global _dependencies
    if _dependencies is not None and _dependencies != dependencies:
        raise RuntimeError("Table asset quarantine is already configured")
    _dependencies = dependencies


def _deps() -> TableAssetQuarantineDependencies:
    if _dependencies is None:
        raise RuntimeError("Table asset quarantine has not been configured")
    return _dependencies


def _table_asset_cleanup_root(vault_root: Path) -> Path:
    root = Path(vault_root).resolve()
    cleanup_root = (root / ".gnosi" / "pending-cleanup" / "table-assets").resolve()
    try:
        cleanup_root.relative_to(root)
    except ValueError as error:
        raise RuntimeError("The table asset cleanup path escapes the active Vault.") from error
    return cleanup_root


def _active_asset_sources(
    table: RegistryData,
    database: RegistryData | None,
) -> list[Path]:
    return [
        path
        for path in _deps().table_asset_paths(table, database)
        if path.exists() or path.is_symlink()
    ]


def _quarantine_manifest(
    table: RegistryData,
    sources: list[Path],
    destinations: list[str],
    vault_root: Path,
) -> RegistryData:
    return {
        "table_id": str((table or {}).get("id") or ""),
        "entries": [
            {
                "source": source.relative_to(vault_root).as_posix(),
                "destination": destination,
            }
            for source, destination in zip(sources, destinations)
        ],
    }


def _rollback_asset_moves(quarantine: Path, moved: AssetMoves) -> None:
    for source, destination in reversed(moved):
        source.parent.mkdir(parents=True, exist_ok=True)
        os.replace(destination, source)
    shutil.rmtree(quarantine, ignore_errors=True)


def _quarantine_table_asset_dirs(
    table: RegistryData,
    database: RegistryData | None,
) -> tuple[Path | None, AssetMoves]:
    """Atomically detach active asset trees before asynchronous deletion."""
    sources = _active_asset_sources(table, database)
    if not sources:
        return None, []
    vault_root = _deps().get_path("VAULT").resolve()
    quarantine = _table_asset_cleanup_root(vault_root) / (f"in-progress-{uuid.uuid4().hex}")
    quarantine.mkdir(parents=True, exist_ok=False)
    destinations = [f"{index:02d}-{source.name}" for index, source in enumerate(sources)]
    moved: AssetMoves = []
    try:
        _deps().write_json(
            quarantine / "_manifest.json",
            _quarantine_manifest(table, sources, destinations, vault_root),
        )
        for source, destination_name in zip(sources, destinations):
            destination = quarantine / destination_name
            os.replace(source, destination)
            moved.append((source, destination))
    except Exception:
        _rollback_asset_moves(quarantine, moved)
        raise
    return quarantine, moved


def _mark_table_asset_quarantine_ready(quarantine: Path) -> Path:
    """Make a committed quarantine eligible for asynchronous cleanup."""
    source = Path(quarantine)
    if not source.name.startswith("in-progress-"):
        raise ValueError("The table asset quarantine is not in progress.")
    destination = source.with_name(f"ready-{source.name.removeprefix('in-progress-')}")
    os.replace(source, destination)
    return destination


def _quarantined_table_asset_revision(
    table: RegistryData,
    database: RegistryData | None,
    moved: AssetMoves,
) -> str:
    """Hash sealed trees under their original logical asset labels."""
    assets_root = _deps().get_path("ASSETS").resolve()
    destinations = {str(source): destination for source, destination in moved}
    logical_paths = {
        str(path): path
        for path in (
            [source for source, _destination in moved] + _deps().table_asset_paths(table, database)
        )
    }
    return _deps().revision(
        (
            (
                source.relative_to(assets_root).as_posix(),
                destinations.get(str(source), source),
            )
            for source in sorted(logical_paths.values(), key=lambda path: str(path))
        )
    )


def _restore_quarantined_table_assets(
    quarantine: Path | None,
    moved: AssetMoves,
) -> None:
    for source, destination in reversed(moved):
        if not destination.exists():
            continue
        source.parent.mkdir(parents=True, exist_ok=True)
        os.replace(destination, source)
    if quarantine:
        shutil.rmtree(quarantine, ignore_errors=True)


def _delete_table_asset_quarantine(quarantine: Path, vault_root: Path) -> None:
    """Purge one server-created committed quarantine."""
    cleanup_root = _table_asset_cleanup_root(vault_root)
    target = Path(quarantine).resolve()
    try:
        target.relative_to(cleanup_root)
    except ValueError:
        _deps().logger.error(
            "Refusing to purge an unsafe table cleanup path: %s",
            target,
        )
        return
    if not target.name.startswith("ready-"):
        _deps().logger.error(
            "Refusing to purge an uncommitted table quarantine: %s",
            target,
        )
        return
    shutil.rmtree(target, ignore_errors=True)


def _read_manifest(path: Path) -> RegistryData:
    return cast(RegistryData, json.loads(path.read_text(encoding="utf-8")))


def _planned_restore_moves(
    manifest: RegistryData,
    quarantine: Path,
    vault_root: Path,
) -> AssetMoves | None:
    planned: AssetMoves = []
    for raw_entry in manifest.get("entries") or []:
        entry = cast(RegistryData, raw_entry)
        try:
            source = (vault_root / str(entry["source"])).resolve()
            source.relative_to(vault_root)
            destination = (quarantine / str(entry["destination"])).resolve()
            if source == vault_root or destination.parent != quarantine.resolve():
                raise ValueError
        except (KeyError, OSError, TypeError, ValueError):
            _deps().logger.error(
                "Unsafe table quarantine manifest entry: %s",
                quarantine,
            )
            return None
        if source.exists() and destination.exists():
            _deps().logger.error(
                "Cannot restore table quarantine over an active path: %s",
                source,
            )
            return None
        planned.append((source, destination))
    return planned


def _restore_abandoned_table_asset_quarantine(
    quarantine: Path,
    vault_root: Path,
) -> bool:
    """Restore a pre-commit quarantine from its path-contained manifest."""
    try:
        manifest = _read_manifest(quarantine / "_manifest.json")
    except (OSError, ValueError, TypeError):
        _deps().logger.error(
            "Cannot recover table quarantine without a manifest: %s",
            quarantine,
        )
        return False
    root = Path(vault_root).resolve()
    planned = _planned_restore_moves(manifest, quarantine, root)
    if planned is None:
        return False
    for source, destination in reversed(planned):
        if not destination.exists():
            continue
        source.parent.mkdir(parents=True, exist_ok=True)
        os.replace(destination, source)
    shutil.rmtree(quarantine, ignore_errors=True)
    return not quarantine.exists()


def _cleanup_registry_table_ids(vault_root: Path) -> set[str] | None:
    """Read durable table IDs, returning ``None`` if commit state is unknown."""
    root = Path(vault_root).resolve()
    try:
        registry_path = _deps().get_path("REGISTRY").resolve()
        registry_path.relative_to(root)
        registry = _read_manifest(registry_path)
        tables: object = registry["tables"]
        if not isinstance(tables, list):
            raise TypeError
    except (KeyError, OSError, TypeError, ValueError):
        _deps().logger.error(
            "Cannot verify table deletion commit; leaving in-progress quarantines untouched in %s",
            root,
        )
        return None
    return {str(table.get("id") or "") for table in tables if isinstance(table, dict)}


def _quarantine_table_id(candidate: Path) -> str | None:
    try:
        manifest = _read_manifest(candidate / "_manifest.json")
        table_id = str(manifest.get("table_id") or "")
        if not table_id:
            raise ValueError
    except (OSError, ValueError, TypeError):
        _deps().logger.error(
            "Leaving an unreadable table quarantine untouched: %s",
            candidate,
        )
        return None
    return table_id


def _purge_candidate(candidate: Path) -> int:
    shutil.rmtree(candidate, ignore_errors=True)
    return int(not candidate.exists())


def _handle_in_progress_candidate(
    candidate: Path,
    vault_root: Path,
    active_table_ids: set[str] | None,
) -> tuple[int, set[str] | None]:
    table_id = _quarantine_table_id(candidate)
    if table_id is None:
        return 0, active_table_ids
    if active_table_ids is None:
        active_table_ids = _cleanup_registry_table_ids(vault_root)
    if active_table_ids is None:
        return 0, None
    if table_id in active_table_ids:
        restored = _restore_abandoned_table_asset_quarantine(
            candidate,
            vault_root,
        )
        return int(restored), active_table_ids
    return _purge_candidate(candidate), active_table_ids


def cleanup_pending_table_asset_quarantines(vault_root: Path) -> int:
    """Restore uncommitted quarantines and purge committed quarantines."""
    vault_root = Path(vault_root).resolve()
    cleanup_root = _table_asset_cleanup_root(vault_root)
    if not cleanup_root.exists():
        return 0
    handled = 0
    token = _deps().active_vault_path.set(vault_root)
    try:
        with _deps().registry_mutation():
            active_table_ids: set[str] | None = None
            for candidate in list(cleanup_root.iterdir()):
                if not candidate.is_dir() or candidate.is_symlink():
                    continue
                if candidate.name.startswith("in-progress-"):
                    delta, active_table_ids = _handle_in_progress_candidate(
                        candidate,
                        vault_root,
                        active_table_ids,
                    )
                    handled += delta
                    continue
                if candidate.name.startswith("ready-"):
                    handled += _purge_candidate(candidate)
                    continue
                _deps().logger.warning(
                    "Leaving an unknown table quarantine entry untouched: %s",
                    candidate,
                )
    finally:
        _deps().active_vault_path.reset(token)
    return handled


__all__ = [
    "AssetMoves",
    "TableAssetQuarantineDependencies",
    "_cleanup_registry_table_ids",
    "_delete_table_asset_quarantine",
    "_mark_table_asset_quarantine_ready",
    "_quarantine_table_asset_dirs",
    "_quarantined_table_asset_revision",
    "_restore_abandoned_table_asset_quarantine",
    "_restore_quarantined_table_assets",
    "_table_asset_cleanup_root",
    "cleanup_pending_table_asset_quarantines",
    "configure",
]
