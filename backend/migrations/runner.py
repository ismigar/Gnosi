"""Guarded Alembic runner for Gnosi-owned SQLite databases."""

from __future__ import annotations

import hashlib
import importlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine
from sqlalchemy.engine import Connection

from backend.migrations.families import MigrationFamily, migration_family
from backend.migrations.schema_audit import database_fingerprint


ALEMBIC_ROOT = Path(__file__).resolve().parent / "alembic"
FINGERPRINTS_PATH = Path(__file__).resolve().parent / "schema_fingerprints.json"
VERSION_TABLE = "alembic_version"
_READY_LOCK = threading.RLock()
_READY_DATABASES: set[tuple[str, str, int, int]] = set()
_MIN_BACKUP_HEADROOM_BYTES = 256 * 1024 * 1024


class SchemaMigrationError(RuntimeError):
    """Base class for recoverable schema migration failures."""


class UnknownSchemaError(SchemaMigrationError):
    """Raised before mutation when no exact reviewed fingerprint matches."""


def data_dir_for_database(path: Path) -> Path:
    """Resolve the owning data directory for root- and system-level stores."""
    resolved = path.expanduser().resolve()
    for parent in resolved.parents:
        if parent.name == "system":
            return parent.parent
    return resolved.parent


def _load_fingerprints() -> dict[str, Any]:
    payload = json.loads(FINGERPRINTS_PATH.read_text(encoding="utf-8"))
    if payload.get("format") != "gnosi-schema-fingerprints-v1":
        raise SchemaMigrationError("Unsupported Gnosi schema fingerprint manifest.")
    families = payload.get("families")
    if not isinstance(families, dict):
        raise SchemaMigrationError("The schema fingerprint manifest has no families.")
    return families


def _known_revision(family: MigrationFamily, fingerprint: str) -> str | None:
    family_data = _load_fingerprints().get(family.name)
    if not isinstance(family_data, dict):
        return None
    revisions = family_data.get("revisions")
    if not isinstance(revisions, dict):
        return None
    matches = [
        revision
        for revision, fingerprints in revisions.items()
        if isinstance(fingerprints, list) and fingerprint in fingerprints
    ]
    if len(matches) > 1:
        raise SchemaMigrationError(
            f"Fingerprint {fingerprint} is ambiguous in family {family.name}."
        )
    return str(matches[0]) if matches else None


def _expected_fingerprints(family: MigrationFamily, revision: str) -> set[str]:
    family_data = _load_fingerprints().get(family.name, {})
    revisions = family_data.get("revisions", {}) if isinstance(family_data, dict) else {}
    values = revisions.get(revision, []) if isinstance(revisions, dict) else []
    return {str(value) for value in values} if isinstance(values, list) else set()


def _alembic_config(connection: Connection) -> Config:
    config = Config()
    config.set_main_option("script_location", str(ALEMBIC_ROOT))
    config.attributes["connection"] = connection
    return config


def _run_alembic(path: Path, operation: str, revision: str) -> None:
    engine = create_engine(f"sqlite:///{path}")
    try:
        with engine.begin() as connection:
            config = _alembic_config(connection)
            if operation == "upgrade":
                command.upgrade(config, revision)
            elif operation == "stamp":
                command.stamp(config, revision)
            else:
                raise ValueError(f"Unsupported Alembic operation: {operation}")
    finally:
        engine.dispose()


def _current_revision(path: Path) -> str | None:
    engine = create_engine(f"sqlite:///{path}")
    try:
        with engine.connect() as connection:
            return MigrationContext.configure(connection).get_current_revision()
    finally:
        engine.dispose()


def _user_tables(path: Path) -> list[str]:
    if not path.exists() or path.stat().st_size == 0:
        return []
    uri = f"{path.resolve().as_uri()}?mode=ro"
    with sqlite3.connect(uri, uri=True, timeout=30) as connection:
        return [
            str(row[0])
            for row in connection.execute(
                """SELECT name FROM sqlite_schema
                WHERE type='table'
                  AND name NOT LIKE 'sqlite_%'
                  AND name != ?
                ORDER BY name""",
                (VERSION_TABLE,),
            )
        ]


def _integrity_check(path: Path) -> None:
    with sqlite3.connect(path, timeout=30) as connection:
        result = str(connection.execute("PRAGMA integrity_check").fetchone()[0])
    if result != "ok":
        raise SchemaMigrationError(f"SQLite integrity_check failed for {path.name}: {result}")


def _checkpoint(path: Path) -> None:
    with sqlite3.connect(path, timeout=30) as connection:
        result = connection.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
    if result and int(result[0]) != 0:
        raise SchemaMigrationError(f"Could not checkpoint active WAL for {path.name}.")


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _row_counts(path: Path) -> dict[str, int]:
    counts: dict[str, int] = {}
    with sqlite3.connect(path, timeout=30) as connection:
        for table in _user_tables(path):
            quoted = '"' + table.replace('"', '""') + '"'
            counts[table] = int(connection.execute(f"SELECT COUNT(*) FROM {quoted}").fetchone()[0])
    return counts


@contextmanager
def _database_lock(path: Path) -> Iterator[None]:
    lock_path = path.with_name(f".{path.name}.gnosi-migration.lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    handle = lock_path.open("a+b")
    try:
        if os.name == "nt":
            msvcrt: Any = importlib.import_module("msvcrt")
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        yield
    finally:
        if os.name == "nt":
            msvcrt = importlib.import_module("msvcrt")
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        handle.close()


def _try_copy_on_write_clone(source: Path, destination: Path) -> bool:
    """Create a same-volume snapshot without allocating a second full database."""
    if sys.platform == "darwin":
        command_line = ["/bin/cp", "-c", str(source), str(destination)]
    elif sys.platform.startswith("linux"):
        cp = shutil.which("cp")
        if cp is None:
            return False
        command_line = [
            cp,
            "--reflink=always",
            "--sparse=always",
            str(source),
            str(destination),
        ]
    else:
        return False
    completed = subprocess.run(
        command_line,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if completed.returncode == 0:
        return True
    destination.unlink(missing_ok=True)
    return False


def _require_full_backup_capacity(source: Path, backup_dir: Path) -> None:
    free_bytes = shutil.disk_usage(backup_dir).free
    required_bytes = source.stat().st_size + _MIN_BACKUP_HEADROOM_BYTES
    if free_bytes < required_bytes:
        raise SchemaMigrationError(
            f"Not enough free space for a verified backup of {source.name}: "
            f"need at least {required_bytes} bytes, found {free_bytes}. "
            "The database was not modified."
        )


def _backup_database(path: Path, family: MigrationFamily, data_dir: Path) -> dict[str, Any]:
    _checkpoint(path)
    _integrity_check(path)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    identity = hashlib.sha256(str(path.resolve()).encode("utf-8")).hexdigest()[:12]
    backup_dir = data_dir / "backups" / "schema-migrations"
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup = backup_dir / f"{stamp}-{family.name}-{identity}-{path.name}"
    cloned = _try_copy_on_write_clone(path, backup)
    if not cloned:
        _require_full_backup_capacity(path, backup_dir)
        with sqlite3.connect(path, timeout=30) as source:
            with sqlite3.connect(backup) as destination:
                source.backup(destination)
    with sqlite3.connect(backup) as destination:
        destination.execute("PRAGMA journal_mode=DELETE")
    os.chmod(backup, 0o600)
    _integrity_check(backup)
    return {
        "path": str(backup.relative_to(data_dir)),
        "sha256": _file_sha256(backup),
        "bytes": backup.stat().st_size,
    }


def _database_label(path: Path, data_dir: Path) -> str:
    try:
        return path.resolve().relative_to(data_dir.resolve()).as_posix()
    except ValueError:
        return path.name


def _append_report(data_dir: Path, record: dict[str, Any]) -> None:
    report_path = data_dir / "backups" / "schema-migrations" / "migration-report.jsonl"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with report_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
    os.chmod(report_path, 0o600)


def ensure_database_schema(path: Path, family_name: str, data_dir: Path) -> dict[str, Any]:
    """Validate, back up and migrate one database to its family head."""
    family = migration_family(family_name)
    path = path.expanduser().resolve()
    data_dir = data_dir.expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)

    with _database_lock(path):
        tables = _user_tables(path)
        current_revision = _current_revision(path) if path.exists() else None
        fingerprint_before = database_fingerprint(path) if tables else None
        recognized_revision = (
            _known_revision(family, fingerprint_before) if fingerprint_before else None
        )

        if tables and current_revision is None and recognized_revision is None:
            raise UnknownSchemaError(
                f"Unknown {family.name} schema {fingerprint_before} in "
                f"{_database_label(path, data_dir)}. The database was not modified."
            )
        if current_revision is not None:
            expected = _expected_fingerprints(family, current_revision)
            if current_revision not in family.revisions:
                raise UnknownSchemaError(
                    f"Unknown Alembic revision {current_revision!r} for {family.name}."
                )
            if fingerprint_before not in expected:
                raise UnknownSchemaError(
                    f"Schema drift for {family.name} at {current_revision}: "
                    f"{fingerprint_before}. The database was not modified."
                )

        if current_revision == family.head:
            return {
                "family": family.name,
                "database": _database_label(path, data_dir),
                "revision_before": current_revision,
                "revision_after": current_revision,
                "changed": False,
                "fingerprint": fingerprint_before,
            }

        backup = None
        counts_before: dict[str, int] = {}
        if tables:
            counts_before = _row_counts(path)
            backup = _backup_database(path, family, data_dir)

        if current_revision is None and recognized_revision is not None:
            _run_alembic(path, "stamp", recognized_revision)
        _run_alembic(path, "upgrade", family.head)

        fingerprint_after = database_fingerprint(path)
        if fingerprint_after not in _expected_fingerprints(family, family.head):
            raise SchemaMigrationError(
                f"Unexpected {family.name} head fingerprint {fingerprint_after}; "
                f"restore the verified backup before retrying."
            )
        _integrity_check(path)
        counts_after = _row_counts(path)
        for table, count in counts_before.items():
            if counts_after.get(table) != count:
                raise SchemaMigrationError(
                    f"Row-count invariant failed for {family.name}.{table}; "
                    f"restore the verified backup before retrying."
                )
        record = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "family": family.name,
            "database": _database_label(path, data_dir),
            "revision_before": current_revision or recognized_revision,
            "revision_after": family.head,
            "fingerprint_before": fingerprint_before,
            "fingerprint_after": fingerprint_after,
            "changed": True,
            "backup": backup,
            "preserved_row_counts": counts_before,
        }
        _append_report(data_dir, record)
        return record


def ensure_database_schema_once(
    path: Path,
    family_name: str,
    data_dir: Path,
) -> dict[str, Any]:
    """Migrate once per process and physical SQLite file identity."""
    resolved = path.expanduser().resolve()
    with _READY_LOCK:
        if resolved.exists():
            stat = resolved.stat()
            key = (str(resolved), family_name, int(stat.st_dev), int(stat.st_ino))
            if key in _READY_DATABASES:
                return {
                    "family": family_name,
                    "database": _database_label(resolved, data_dir),
                    "changed": False,
                    "cached": True,
                }
        result = ensure_database_schema(resolved, family_name, data_dir)
        stat = resolved.stat()
        _READY_DATABASES.add(
            (str(resolved), family_name, int(stat.st_dev), int(stat.st_ino))
        )
        return result


def verify_database_schema(path: Path, family_name: str, data_dir: Path) -> dict[str, Any]:
    """Read-only verification of revision, fingerprint and SQLite integrity."""
    family = migration_family(family_name)
    resolved = path.expanduser().resolve()
    if not resolved.exists():
        raise SchemaMigrationError(f"Missing {family.name} database: {resolved.name}")
    revision = _current_revision(resolved)
    fingerprint = database_fingerprint(resolved)
    expected = _expected_fingerprints(family, family.head)
    if revision != family.head or fingerprint not in expected:
        raise SchemaMigrationError(
            f"{_database_label(resolved, data_dir)} is not at the reviewed "
            f"{family.name} head."
        )
    uri = f"{resolved.as_uri()}?mode=ro"
    with sqlite3.connect(uri, uri=True, timeout=30) as connection:
        integrity = str(connection.execute("PRAGMA integrity_check").fetchone()[0])
    if integrity != "ok":
        raise SchemaMigrationError(
            f"SQLite integrity_check failed for {_database_label(resolved, data_dir)}: "
            f"{integrity}"
        )
    return {
        "family": family.name,
        "database": _database_label(resolved, data_dir),
        "revision": revision,
        "fingerprint": fingerprint,
        "integrity_check": integrity,
    }
