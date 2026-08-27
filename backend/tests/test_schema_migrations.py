from __future__ import annotations

import hashlib
import sqlite3
from pathlib import Path

import pytest

from backend.migrations.families import FAMILIES
from backend.migrations.runner import (
    UnknownSchemaError,
    _current_revision,
    _run_alembic,
    ensure_database_schema,
)
from backend.migrations.schema_audit import database_fingerprint


ALL_REVISIONS = [
    (family.name, revision)
    for family in FAMILIES.values()
    for revision in family.revisions
]


def _remove_version_table(path: Path) -> None:
    with sqlite3.connect(path) as connection:
        connection.execute("DROP TABLE alembic_version")


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.mark.parametrize(("family_name", "revision"), ALL_REVISIONS)
def test_every_known_revision_migrates_to_its_head(
    tmp_path: Path,
    family_name: str,
    revision: str,
) -> None:
    family = FAMILIES[family_name]
    database = tmp_path / "system" / f"{family_name}.sqlite"
    database.parent.mkdir(parents=True)
    _run_alembic(database, "upgrade", revision)
    _remove_version_table(database)

    first = ensure_database_schema(database, family_name, tmp_path)
    second = ensure_database_schema(database, family_name, tmp_path)

    assert first["changed"] is True
    assert first["revision_before"] == revision
    assert first["revision_after"] == family.head
    assert first["backup"]["sha256"]
    backup_path = tmp_path / first["backup"]["path"]
    with sqlite3.connect(backup_path) as backup_connection:
        assert backup_connection.execute("PRAGMA journal_mode").fetchone()[0] == "delete"
    assert _current_revision(database) == family.head
    assert second["changed"] is False
    report = tmp_path / "backups" / "schema-migrations" / "migration-report.jsonl"
    assert len(report.read_text(encoding="utf-8").splitlines()) == 1


def test_empty_database_is_created_at_management_head(tmp_path: Path) -> None:
    database = tmp_path / "system" / "management.sqlite"

    result = ensure_database_schema(database, "management", tmp_path)

    assert result["changed"] is True
    assert result["backup"] is None
    assert _current_revision(database) == FAMILIES["management"].head


def test_management_backfill_and_rows_are_preserved(tmp_path: Path) -> None:
    database = tmp_path / "system" / "management.sqlite"
    database.parent.mkdir(parents=True)
    _run_alembic(database, "upgrade", "mgmt_0002")
    with sqlite3.connect(database) as connection:
        connection.execute(
            "INSERT INTO users(id,email,name) VALUES ('user-1','legacy@example.com','Legacy')"
        )
        connection.execute(
            "INSERT INTO workspaces(id,name,slug) VALUES ('workspace-1','Legacy','legacy')"
        )
        connection.execute(
            """INSERT INTO memberships(user_id,workspace_id,role,permissions)
            VALUES ('user-1','workspace-1','owner','{"capabilities":["read"]}')"""
        )
    _remove_version_table(database)

    ensure_database_schema(database, "management", tmp_path)

    with sqlite3.connect(database) as connection:
        user = connection.execute(
            "SELECT email, auto_provisioned FROM users WHERE id='user-1'"
        ).fetchone()
        membership_count = connection.execute("SELECT COUNT(*) FROM memberships").fetchone()[0]
        indexes = {
            str(row[1]) for row in connection.execute("PRAGMA index_list(vaults)")
        }
    assert user == ("legacy@example.com", 1)
    assert membership_count == 1
    assert "ix_vaults_slug" in indexes


def test_unknown_schema_aborts_before_mutation(tmp_path: Path) -> None:
    database = tmp_path / "system" / "unknown.sqlite"
    database.parent.mkdir(parents=True)
    with sqlite3.connect(database) as connection:
        connection.execute("CREATE TABLE mystery (id INTEGER PRIMARY KEY, payload TEXT)")
    checksum_before = _sha256(database)
    fingerprint_before = database_fingerprint(database)

    with pytest.raises(UnknownSchemaError, match="database was not modified"):
        ensure_database_schema(database, "management", tmp_path)

    assert _sha256(database) == checksum_before
    assert database_fingerprint(database) == fingerprint_before
    with sqlite3.connect(database) as connection:
        version_table = connection.execute(
            "SELECT COUNT(*) FROM sqlite_schema WHERE name='alembic_version'"
        ).fetchone()[0]
    assert version_table == 0
    assert not (tmp_path / "backups").exists()


def test_schema_drift_at_a_known_revision_aborts(tmp_path: Path) -> None:
    database = tmp_path / "system" / "vault.sqlite"
    database.parent.mkdir(parents=True)
    _run_alembic(database, "upgrade", FAMILIES["vault"].head)
    with sqlite3.connect(database) as connection:
        connection.execute("DROP INDEX ix_pdf_annotations_managed_key")

    with pytest.raises(UnknownSchemaError, match="Schema drift"):
        ensure_database_schema(database, "vault", tmp_path)
