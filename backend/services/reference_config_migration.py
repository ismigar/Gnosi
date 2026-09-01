"""Explicit, recoverable migration of legacy references JSON into local data."""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Literal

from backend.services.reference_migration_io import (
    ReferenceMigrationError,
    checked_path,
    configuration_bytes,
    digest,
    link_exclusive,
    migration_lock,
    read_regular,
    sync_directory,
    write_exclusive,
    write_journal,
)


@dataclass(frozen=True)
class MigrationPaths:
    """All writable paths are deterministic siblings in the chosen data directory."""

    source: Path
    target: Path
    journal: Path
    payload: Path
    recovered: Path


@dataclass
class MigrationJournal:
    """Only identities and digests are journaled, never configuration values."""

    version: int
    source: str
    destination: str
    sha256: str
    size: int
    ownership: Literal["new", "existing"]
    status: Literal["planned", "prepared", "completed", "rolling_back", "rolled_back"]


def migration_paths(source: str | Path, data_dir: str | Path) -> MigrationPaths:
    root = checked_path(data_dir)
    target = checked_path(root / "config" / "references.json")
    origin = checked_path(source)
    paths = MigrationPaths(
        origin,
        target,
        target.with_name(".references-migration.json"),
        target.with_name(".references-migration.payload"),
        target.with_name(".references-migration.recovered.json"),
    )
    for path in (paths.journal, paths.payload, paths.recovered):
        checked_path(path)
    if origin in (
        paths.target,
        paths.journal,
        paths.payload,
        paths.recovered,
        paths.journal.with_suffix(".lock"),
    ):
        raise ReferenceMigrationError("Source must be separate from migration output")
    if target.exists() and origin.exists() and target.samefile(origin):
        raise ReferenceMigrationError("Source and destination must not share a file")
    return paths


def _verify(path: Path, journal: MigrationJournal) -> bytes:
    data = configuration_bytes(path)
    if len(data) != journal.size or digest(data) != journal.sha256:
        raise ReferenceMigrationError(f"File differs from the migration journal: {path}")
    return data


def _load(paths: MigrationPaths) -> MigrationJournal:
    try:
        loaded: object = json.loads(read_regular(paths.journal))
    except (ValueError, UnicodeError):
        raise ReferenceMigrationError("Migration journal is not valid JSON") from None
    if not isinstance(loaded, dict):
        raise ReferenceMigrationError("Migration journal must be an object")
    source, target = loaded.get("source"), loaded.get("destination")
    sha, size = loaded.get("sha256"), loaded.get("size")
    owner, state = loaded.get("ownership"), loaded.get("status")
    if loaded.get("version") != 1 or source != str(paths.source) or target != str(paths.target):
        raise ReferenceMigrationError("Migration journal version or paths do not match")
    if not isinstance(sha, str) or len(sha) != 64 or any(c not in "0123456789abcdef" for c in sha):
        raise ReferenceMigrationError("Migration journal has an invalid digest")
    if not isinstance(size, int) or isinstance(size, bool) or size < 0:
        raise ReferenceMigrationError("Migration journal has an invalid size")
    if owner not in ("new", "existing"):
        raise ReferenceMigrationError("Migration journal has an invalid ownership value")
    if state not in ("planned", "prepared", "completed", "rolling_back", "rolled_back"):
        raise ReferenceMigrationError("Migration journal has an invalid state")
    # Literal refinements are explicit; no unchecked deserialization casts.
    ownership: Literal["new", "existing"] = "new" if owner == "new" else "existing"
    status: Literal["planned", "prepared", "completed", "rolling_back", "rolled_back"]
    if state == "planned":
        status = "planned"
    elif state == "prepared":
        status = "prepared"
    elif state == "completed":
        status = "completed"
    elif state == "rolling_back":
        status = "rolling_back"
    else:
        status = "rolled_back"
    return MigrationJournal(1, str(paths.source), str(paths.target), sha, size, ownership, status)


def _save(paths: MigrationPaths, journal: MigrationJournal) -> None:
    checked_path(paths.journal)
    write_journal(paths.journal, json.dumps(asdict(journal), sort_keys=True).encode())


def _report(paths: MigrationPaths, journal: MigrationJournal) -> dict[str, object]:
    return {
        **asdict(journal),
        "journal": str(paths.journal),
        "payload": str(paths.payload),
        "recovered": str(paths.recovered),
        "source_preserved": True,
    }


def plan_reference_migration(source: str | Path, data_dir: str | Path) -> dict[str, object]:
    """Validate inputs and conflicts without creating directories, locks or journals."""
    paths = migration_paths(source, data_dir)
    data = configuration_bytes(paths.source)
    journal = MigrationJournal(
        1,
        str(paths.source),
        str(paths.target),
        digest(data),
        len(data),
        "existing" if paths.target.exists() else "new",
        "planned",
    )
    if paths.journal.exists():
        journal = _load(paths)
        _verify(paths.source, journal)
    if paths.target.exists():
        _verify(paths.target, journal)
    return _report(paths, journal)


def _prepare(paths: MigrationPaths, journal: MigrationJournal) -> None:
    data = _verify(paths.source, journal)
    if paths.payload.exists():
        _verify(paths.payload, journal)
    else:
        write_exclusive(paths.payload, data)
    if os.name != "nt" and paths.payload.stat().st_mode & 0o777 != 0o600:
        raise ReferenceMigrationError("Migration payload is not private; inspect its permissions")
    journal.status = "prepared"
    _save(paths, journal)


def _publish(paths: MigrationPaths, journal: MigrationJournal) -> None:
    _verify(paths.source, journal)
    _verify(paths.payload, journal)
    if paths.target.exists():
        if not paths.target.samefile(paths.payload):
            raise ReferenceMigrationError(
                "Destination appeared independently; refusing to replace it"
            )
    else:
        link_exclusive(paths.payload, paths.target)
    _verify(paths.target, journal)
    journal.status = "completed"
    _save(paths, journal)


def migrate_reference_config(
    source: str | Path,
    data_dir: str | Path,
    *,
    writers_stopped: bool = False,
) -> dict[str, object]:
    """Publish one exact private copy, preserving the original and recovery state."""
    if not writers_stopped:
        raise ReferenceMigrationError("Stop every Gnosi writer and confirm writers_stopped")
    plan_reference_migration(source, data_dir)
    paths = migration_paths(source, data_dir)
    paths.target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with migration_lock(paths.journal):
        plan_reference_migration(source, data_dir)
        if paths.journal.exists():
            journal = _load(paths)
        else:
            if paths.payload.exists() or paths.recovered.exists():
                raise ReferenceMigrationError(
                    "Recovery files exist without their journal; preserve them"
                )
            data = configuration_bytes(paths.source)
            journal = MigrationJournal(
                1,
                str(paths.source),
                str(paths.target),
                digest(data),
                len(data),
                "existing" if paths.target.exists() else "new",
                "planned",
            )
            write_exclusive(paths.journal, json.dumps(asdict(journal), sort_keys=True).encode())
        if journal.status in ("rolling_back", "rolled_back"):
            raise ReferenceMigrationError("Transaction was rolled back; retain its recovery files")
        if journal.status == "completed":
            _verify(paths.target, journal)
            return _report(paths, journal)
        if journal.ownership == "existing":
            _verify(paths.target, journal)
            journal.status = "completed"
            _save(paths, journal)
        else:
            _prepare(paths, journal)
            _publish(paths, journal)
        return _report(paths, journal)


def reference_migration_status(source: str | Path, data_dir: str | Path) -> dict[str, object]:
    """Inspect journal and source without modifying files."""
    paths = migration_paths(source, data_dir)
    journal = _load(paths)
    _verify(paths.source, journal)
    if paths.target.exists():
        _verify(paths.target, journal)
    if journal.status == "completed" and not paths.target.exists():
        raise ReferenceMigrationError("Completed migration destination is missing")
    if paths.recovered.exists():
        _verify(paths.recovered, journal)
    return _report(paths, journal)


def _recover_owned_target(paths: MigrationPaths, journal: MigrationJournal) -> None:
    _verify(paths.payload, journal)
    if paths.target.exists():
        _verify(paths.target, journal)
        if not paths.target.samefile(paths.payload):
            raise ReferenceMigrationError("Destination was replaced after migration; preserve it")
        if not paths.recovered.exists():
            link_exclusive(paths.target, paths.recovered)
        _verify(paths.recovered, journal)
        if not paths.recovered.samefile(paths.payload):
            raise ReferenceMigrationError("Recovery destination is owned by another file")
        paths.target.unlink()
        sync_directory(paths.target.parent)
    elif paths.recovered.exists():
        _verify(paths.recovered, journal)


def rollback_reference_migration(
    source: str | Path,
    data_dir: str | Path,
    *,
    writers_stopped: bool = False,
) -> dict[str, object]:
    """Recover only a verified owned target; never remove a pre-existing config."""
    if not writers_stopped:
        raise ReferenceMigrationError("Stop every Gnosi writer and confirm writers_stopped")
    paths = migration_paths(source, data_dir)
    with migration_lock(paths.journal):
        journal = _load(paths)
        _verify(paths.source, journal)
        if journal.status == "rolled_back":
            return reference_migration_status(source, data_dir)
        if journal.ownership == "new":
            if journal.status == "completed" and not paths.target.exists():
                raise ReferenceMigrationError("Completed migration destination is missing")
            if journal.status == "planned" and not paths.payload.exists():
                if paths.target.exists():
                    raise ReferenceMigrationError(
                        "Unprepared destination is not owned by migration"
                    )
                journal.status = "rolled_back"
                _save(paths, journal)
                return _report(paths, journal)
            journal.status = "rolling_back"
            _save(paths, journal)
            _recover_owned_target(paths, journal)
        else:
            _verify(paths.target, journal)
        journal.status = "rolled_back"
        _save(paths, journal)
        return _report(paths, journal)
