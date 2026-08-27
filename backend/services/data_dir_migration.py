"""Journaled and recoverable migration of Gnosi's per-device data directory."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import uuid
from contextlib import AbstractContextManager, closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.utils.safe_io import safe_write_json


JOURNAL_VERSION = 1
SQLITE_HEADER = b"SQLite format 3\x00"


class DataMigrationError(RuntimeError):
    """A recoverable data-directory migration failure."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _absolute(path: str | Path) -> Path:
    candidate = Path(path).expanduser()
    if not candidate.is_absolute():
        raise DataMigrationError(f"Migration paths must be absolute: {path}")
    return Path(os.path.abspath(candidate))


def _is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def _validate_paths(source: Path, destination: Path) -> None:
    forbidden = {Path(source.anchor), Path.home().absolute()}
    if source in forbidden or destination in forbidden:
        raise DataMigrationError("Refusing to migrate a filesystem root or the home directory")
    if source == destination:
        raise DataMigrationError("Source and destination must be different")
    if _is_relative_to(destination, source) or _is_relative_to(source, destination):
        raise DataMigrationError("Source and destination cannot contain one another")
    if source.is_symlink() or destination.is_symlink():
        raise DataMigrationError("Source and destination roots cannot be symlinks")
    if not source.is_dir():
        raise DataMigrationError(f"Source data directory does not exist: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)


def default_journal_path(source: Path, destination: Path) -> Path:
    digest = hashlib.sha256(f"{source}\0{destination}".encode("utf-8")).hexdigest()[:16]
    return destination.parent / f".gnosi-data-migration-{digest}.json"


class _JournalLock(AbstractContextManager):
    def __init__(self, journal_path: Path):
        self.path = journal_path.with_suffix(journal_path.suffix + ".lock")
        self.handle = None

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = self.path.open("a+", encoding="utf-8")
        try:
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (OSError, BlockingIOError) as exc:
            self.handle.close()
            raise DataMigrationError(f"Another migration holds {self.path}") from exc
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        if self.handle is not None:
            try:
                if os.name == "nt":
                    import msvcrt

                    self.handle.seek(0)
                    msvcrt.locking(self.handle.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
            finally:
                self.handle.close()
        return False


def _save_journal(path: Path, journal: dict[str, Any], status: str | None = None) -> None:
    if status:
        journal["status"] = status
    journal["updated_at"] = _now()
    safe_write_json(path, journal, indent=2, sort_keys=True)


def _event(path: Path, journal: dict[str, Any], phase: str, detail: str) -> None:
    journal.setdefault("events", []).append({"at": _now(), "phase": phase, "detail": detail})
    _save_journal(path, journal, phase)


def _is_sqlite(path: Path) -> bool:
    if not path.is_file() or path.is_symlink():
        return False
    try:
        with path.open("rb") as handle:
            return handle.read(len(SQLITE_HEADER)) == SQLITE_HEADER
    except OSError:
        return False


def _is_ephemeral_sqlite_sidecar(path: Path) -> bool:
    """Return whether `path` is a sidecar for an actual adjacent SQLite file."""
    for suffix in ("-wal", "-shm", "-journal"):
        if path.name.endswith(suffix):
            database = path.with_name(path.name[: -len(suffix)])
            return _is_sqlite(database)
    return False


def verify_sqlite_databases(root: Path, *, checkpoint: bool) -> list[dict[str, Any]]:
    """Checkpoint and integrity-check every SQLite database below `root`."""
    results = []
    for path in sorted(candidate for candidate in root.rglob("*") if _is_sqlite(candidate)):
        relative = path.relative_to(root).as_posix()
        try:
            with closing(sqlite3.connect(str(path), timeout=10)) as connection:
                checkpoint_result = None
                if checkpoint:
                    checkpoint_result = list(connection.execute("PRAGMA wal_checkpoint(TRUNCATE)"))[0]
                    if checkpoint_result[0] != 0:
                        raise DataMigrationError(
                            f"SQLite WAL remains busy for {relative}: {checkpoint_result}"
                        )
                integrity = [row[0] for row in connection.execute("PRAGMA integrity_check")]
                if integrity != ["ok"]:
                    raise DataMigrationError(
                        f"SQLite integrity_check failed for {relative}: {integrity[:5]}"
                    )
            results.append(
                {
                    "path": relative,
                    "size": path.stat().st_size,
                    "integrity": "ok",
                    "checkpoint": checkpoint_result,
                }
            )
        except sqlite3.Error as exc:
            raise DataMigrationError(f"Could not verify SQLite database {relative}: {exc}") from exc
    return results


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def inventory_tree(root: Path, *, hashes: bool) -> dict[str, dict[str, Any]]:
    """Inventory files and contained symlinks without following them."""
    inventory: dict[str, dict[str, Any]] = {}
    resolved_root = root.resolve()
    for directory, dirnames, filenames in os.walk(root, followlinks=False):
        directory_path = Path(directory)
        for name in list(dirnames):
            path = directory_path / name
            if not path.is_symlink():
                continue
            target = path.resolve()
            if not _is_relative_to(target, resolved_root):
                raise DataMigrationError(f"Symlink escapes the data directory: {path}")
            relative = path.relative_to(root).as_posix()
            inventory[relative] = {"kind": "symlink", "target": os.readlink(path)}
            dirnames.remove(name)
        for name in filenames:
            path = directory_path / name
            relative = path.relative_to(root).as_posix()
            if _is_ephemeral_sqlite_sidecar(path):
                continue
            if path.is_symlink():
                target = path.resolve()
                if not _is_relative_to(target, resolved_root):
                    raise DataMigrationError(f"Symlink escapes the data directory: {path}")
                inventory[relative] = {"kind": "symlink", "target": os.readlink(path)}
                continue
            stat_result = path.stat()
            item: dict[str, Any] = {
                "kind": "file",
                "size": stat_result.st_size,
                "mtime_ns": stat_result.st_mtime_ns,
            }
            if hashes:
                item["sha256"] = _hash_file(path)
            inventory[relative] = item
    return inventory


def _verify_inventory(expected: dict[str, Any], actual: dict[str, Any]) -> None:
    if set(expected) != set(actual):
        missing = sorted(set(expected) - set(actual))[:10]
        extra = sorted(set(actual) - set(expected))[:10]
        raise DataMigrationError(f"Inventory mismatch; missing={missing}, extra={extra}")
    for relative, source_item in expected.items():
        target_item = actual[relative]
        for field in ("kind", "size", "sha256", "target"):
            if field in source_item and source_item[field] != target_item.get(field):
                raise DataMigrationError(
                    f"Inventory mismatch for {relative}: {field} differs"
                )


def _empty_directory(path: Path) -> bool:
    return path.is_dir() and next(path.iterdir(), None) is None


def _copy_tree(source: Path, staging: Path) -> None:
    staging.mkdir(parents=True, exist_ok=True)
    for directory, dirnames, filenames in os.walk(source, followlinks=False):
        source_dir = Path(directory)
        relative_dir = source_dir.relative_to(source)
        target_dir = staging / relative_dir
        target_dir.mkdir(parents=True, exist_ok=True)
        shutil.copystat(source_dir, target_dir, follow_symlinks=False)
        for name in list(dirnames):
            source_path = source_dir / name
            if source_path.is_symlink():
                target_path = target_dir / name
                if not target_path.exists() and not target_path.is_symlink():
                    target_path.symlink_to(os.readlink(source_path), target_is_directory=True)
                dirnames.remove(name)
        for name in filenames:
            source_path = source_dir / name
            target_path = target_dir / name
            if _is_ephemeral_sqlite_sidecar(source_path):
                continue
            if source_path.is_symlink():
                if not target_path.exists() and not target_path.is_symlink():
                    target_path.symlink_to(os.readlink(source_path))
            else:
                shutil.copy2(source_path, target_path)


def _prepare_destination(journal_path: Path, journal: dict[str, Any], destination: Path) -> None:
    if not destination.exists():
        return
    if not _empty_directory(destination):
        raise DataMigrationError(f"Destination is not empty: {destination}")
    displaced = destination.parent / f".{destination.name}.pre-migration-{journal['id']}"
    if displaced.exists():
        raise DataMigrationError(f"Displaced destination already exists: {displaced}")
    os.replace(destination, displaced)
    journal["displaced_empty_destination"] = str(displaced)
    _event(journal_path, journal, "destination_prepared", "empty scaffold displaced")


def _restore_displaced(journal: dict[str, Any], destination: Path) -> None:
    displaced_raw = journal.get("displaced_empty_destination")
    if not displaced_raw:
        return
    displaced = Path(displaced_raw)
    if displaced.exists() and not destination.exists():
        os.replace(displaced, destination)


def _new_journal(source: Path, destination: Path, method: str) -> dict:
    migration_id = uuid.uuid4().hex[:16]
    staging = (
        destination.parent / f".{destination.name}.gnosi-migration-{migration_id}.staging"
        if method == "copy"
        else None
    )
    return {
        "version": JOURNAL_VERSION,
        "id": migration_id,
        "status": "planned",
        "created_at": _now(),
        "updated_at": _now(),
        "source": str(source),
        "destination": str(destination),
        "method": method,
        "staging": str(staging) if staging else None,
        "source_device": source.stat().st_dev,
        "destination_device": destination.parent.stat().st_dev,
        "events": [],
    }


def plan_data_migration(
    source: str | Path,
    destination: str | Path,
    *,
    force_copy: bool = False,
) -> dict[str, Any]:
    source_path, destination_path = _absolute(source), _absolute(destination)
    _validate_paths(source_path, destination_path)
    if destination_path.exists() and not _empty_directory(destination_path):
        raise DataMigrationError(f"Destination is not empty: {destination_path}")
    same_volume = source_path.stat().st_dev == destination_path.parent.stat().st_dev
    method = "copy" if force_copy or not same_volume else "rename"
    files = inventory_tree(source_path, hashes=False)
    total_bytes = sum(item.get("size", 0) for item in files.values())
    if method == "copy" and shutil.disk_usage(destination_path.parent).free < total_bytes * 1.05:
        raise DataMigrationError("Insufficient free space for verified cross-volume staging")
    return {
        "source": str(source_path),
        "destination": str(destination_path),
        "method": method,
        "files": len(files),
        "bytes": total_bytes,
        "sqlite_databases": sum(1 for path in source_path.rglob("*") if _is_sqlite(path)),
    }


def migrate_data_dir(
    source: str | Path,
    destination: str | Path,
    *,
    journal_path: str | Path | None = None,
    force_copy: bool = False,
    writers_stopped: bool = False,
) -> dict[str, Any]:
    if not writers_stopped:
        raise DataMigrationError("Stop every Gnosi writer and confirm writers_stopped before migration")
    source_path, destination_path = _absolute(source), _absolute(destination)
    journal_file = _absolute(journal_path) if journal_path else default_journal_path(source_path, destination_path)
    with _JournalLock(journal_file):
        if journal_file.exists():
            journal = json.loads(journal_file.read_text(encoding="utf-8"))
            if journal.get("source") != str(source_path) or journal.get("destination") != str(destination_path):
                raise DataMigrationError("Existing migration journal targets different paths")
            if journal.get("status") in {"completed", "finalized"}:
                return journal
            if journal.get("status") == "failed":
                journal.setdefault("failures", []).append(
                    {
                        "at": journal.get("updated_at"),
                        "error": journal.get("error"),
                        "rollback": journal.get("rollback"),
                    }
                )
                journal.pop("error", None)
                journal.pop("rollback", None)
        else:
            plan = plan_data_migration(source_path, destination_path, force_copy=force_copy)
            journal = _new_journal(source_path, destination_path, plan["method"])
            _save_journal(journal_file, journal)

        method = journal["method"]
        hashes = method == "copy"
        if source_path.exists():
            _event(journal_file, journal, "verifying_source", "checkpoint and integrity checks")
            journal["source_sqlite"] = verify_sqlite_databases(source_path, checkpoint=True)
            journal["source_inventory"] = inventory_tree(source_path, hashes=hashes)
            _save_journal(journal_file, journal, "source_verified")

        try:
            if method == "rename":
                if source_path.exists() and not destination_path.exists():
                    _prepare_destination(journal_file, journal, destination_path)
                    _event(journal_file, journal, "moving", "same-volume atomic rename")
                    os.replace(source_path, destination_path)
                elif source_path.exists() and destination_path.exists():
                    if _empty_directory(destination_path):
                        _prepare_destination(journal_file, journal, destination_path)
                        _event(journal_file, journal, "moving", "same-volume atomic rename")
                        os.replace(source_path, destination_path)
                    else:
                        raise DataMigrationError(f"Destination is not empty: {destination_path}")
                elif not destination_path.exists():
                    raise DataMigrationError("Neither source nor destination is available for resume")
            else:
                if not source_path.exists():
                    raise DataMigrationError("Cross-volume migration requires the preserved source")
                staging = Path(journal["staging"])
                _event(journal_file, journal, "copying", "copying into verified staging")
                _copy_tree(source_path, staging)
                staging_inventory = inventory_tree(staging, hashes=True)
                _verify_inventory(journal["source_inventory"], staging_inventory)
                verify_sqlite_databases(staging, checkpoint=False)
                if not destination_path.exists():
                    os.replace(staging, destination_path)
                elif _empty_directory(destination_path):
                    _prepare_destination(journal_file, journal, destination_path)
                    os.replace(staging, destination_path)
                elif destination_path != staging:
                    raise DataMigrationError("Destination already contains data")

            _event(journal_file, journal, "verifying_destination", "final inventory and SQLite checks")
            destination_inventory = inventory_tree(destination_path, hashes=hashes)
            _verify_inventory(journal["source_inventory"], destination_inventory)
            journal["destination_sqlite"] = verify_sqlite_databases(
                destination_path, checkpoint=False
            )
            journal["source_preserved"] = source_path.exists()
            _event(journal_file, journal, "completed", "destination verified")
            return journal
        except Exception as exc:
            journal["error"] = str(exc)
            if method == "rename" and destination_path.exists() and not source_path.exists():
                os.replace(destination_path, source_path)
                _restore_displaced(journal, destination_path)
                journal["rollback"] = "automatic"
            _save_journal(journal_file, journal, "failed")
            raise


def rollback_data_migration(
    journal_path: str | Path,
    *,
    writers_stopped: bool = False,
) -> dict[str, Any]:
    if not writers_stopped:
        raise DataMigrationError("Stop every Gnosi writer before rollback")
    journal_file = _absolute(journal_path)
    with _JournalLock(journal_file):
        journal = json.loads(journal_file.read_text(encoding="utf-8"))
        if journal.get("status") == "rolled_back":
            return journal
        source = Path(journal["source"])
        destination = Path(journal["destination"])
        method = journal["method"]
        _event(journal_file, journal, "rolling_back", "operator-requested rollback")
        if method == "rename":
            if destination.exists() and not source.exists():
                os.replace(destination, source)
            elif not source.exists():
                raise DataMigrationError("Cannot locate migrated data for rollback")
        else:
            if not source.exists():
                raise DataMigrationError("Preserved cross-volume source is missing")
            if destination.exists():
                actual = inventory_tree(destination, hashes=True)
                _verify_inventory(journal["source_inventory"], actual)
                shutil.rmtree(destination)
        _restore_displaced(journal, destination)
        journal["source_preserved"] = source.exists()
        _event(journal_file, journal, "rolled_back", "source path restored")
        return journal


def finalize_data_migration(journal_path: str | Path) -> dict[str, Any]:
    """Remove only an empty displaced scaffold; never delete user source data."""
    journal_file = _absolute(journal_path)
    with _JournalLock(journal_file):
        journal = json.loads(journal_file.read_text(encoding="utf-8"))
        if journal.get("status") == "finalized":
            return journal
        if journal.get("status") != "completed":
            raise DataMigrationError("Only a completed migration can be finalized")
        displaced_raw = journal.get("displaced_empty_destination")
        if displaced_raw:
            displaced = Path(displaced_raw)
            if displaced.exists():
                if not _empty_directory(displaced):
                    raise DataMigrationError(f"Displaced scaffold is no longer empty: {displaced}")
                displaced.rmdir()
        _event(journal_file, journal, "finalized", "rollback scaffold released")
        return journal


def load_migration_journal(journal_path: str | Path) -> dict[str, Any]:
    return json.loads(_absolute(journal_path).read_text(encoding="utf-8"))
