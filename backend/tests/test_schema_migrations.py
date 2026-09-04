from __future__ import annotations

import hashlib
import sqlite3
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.migrations import runner as migration_runner
from backend.migrations.coordinator import existing_owned_databases
from backend.migrations.families import FAMILIES
from backend.migrations.runner import (
    SchemaMigrationError,
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

LEGACY_LITERATURE_SCHEMA = """
CREATE TABLE oai_records (
    source_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    duplicate_key TEXT,
    title TEXT NOT NULL,
    normalized_title TEXT NOT NULL,
    year INTEGER,
    work_json TEXT NOT NULL,
    datestamp TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(source_id, provider_id)
);
CREATE INDEX idx_oai_records_key ON oai_records(duplicate_key);
CREATE VIRTUAL TABLE oai_records_fts USING fts5(
    source_id UNINDEXED,
    provider_id UNINDEXED,
    title,
    abstract,
    authors,
    tokenize='unicode61 remove_diacritics 2'
);
CREATE TABLE oai_sync_state (
    source_id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    job_id TEXT,
    resumption_token TEXT,
    last_successful_datestamp TEXT,
    received_count INTEGER NOT NULL DEFAULT 0,
    indexed_count INTEGER NOT NULL DEFAULT 0,
    deleted_count INTEGER NOT NULL DEFAULT 0,
    complete_list_size INTEGER,
    cursor_value INTEGER,
    cancel_requested INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    started_at TEXT,
    updated_at TEXT NOT NULL,
    completed_at TEXT
);
"""


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


def test_empty_literature_index_creates_oai_state_and_search(tmp_path: Path) -> None:
    database = tmp_path / "literature" / "vault-scope" / "academic_index.sqlite3"

    result = ensure_database_schema(database, "literature_index", tmp_path)

    assert result["changed"] is True
    assert result["backup"] is None
    assert _current_revision(database) == FAMILIES["literature_index"].head
    with sqlite3.connect(database) as connection:
        connection.execute(
            """INSERT INTO oai_records(
                source_id,provider_id,duplicate_key,title,normalized_title,
                year,work_json,datestamp,updated_at
            ) VALUES(?,?,?,?,?,?,?,?,?)""",
            (
                "source",
                "record-1",
                "doi:example",
                "Open Science",
                "open science",
                2026,
                '{"title":"Open Science"}',
                "2026-09-01",
                "2026-09-03T00:00:00+00:00",
            ),
        )
        rowid = int(connection.execute("SELECT rowid FROM oai_records").fetchone()[0])
        connection.execute(
            """INSERT INTO oai_records_fts(
                rowid,source_id,provider_id,title,abstract,authors
            ) VALUES(?,?,?,?,?,?)""",
            (rowid, "source", "record-1", "Open Science", "Evidence", "Ada Riu"),
        )
        connection.execute(
            """INSERT INTO oai_sync_state(
                source_id,state,received_count,indexed_count,deleted_count,
                cancel_requested,updated_at
            ) VALUES(?,?,?,?,?,?,?)""",
            ("source", "completed", 1, 1, 0, 0, "2026-09-03T00:00:00+00:00"),
        )
        assert connection.execute(
            "SELECT provider_id FROM oai_records_fts WHERE oai_records_fts MATCH 'open'"
        ).fetchone() == ("record-1",)
        assert connection.execute(
            "SELECT state,indexed_count FROM oai_sync_state WHERE source_id='source'"
        ).fetchone() == ("completed", 1)


def test_literature_2x_schema_preserves_records_sync_state_and_fts(tmp_path: Path) -> None:
    database = tmp_path / "literature" / "legacy-scope" / "academic_index.sqlite3"
    database.parent.mkdir(parents=True)
    with sqlite3.connect(database) as connection:
        connection.executescript(LEGACY_LITERATURE_SCHEMA)
        connection.execute(
            """INSERT INTO oai_records(
                source_id,provider_id,duplicate_key,title,normalized_title,
                year,work_json,datestamp,updated_at
            ) VALUES(?,?,?,?,?,?,?,?,?)""",
            (
                "legacy-source",
                "legacy-record",
                "doi:legacy",
                "Legacy Evidence",
                "legacy evidence",
                2024,
                '{"title":"Legacy Evidence"}',
                "2024-01-01",
                "2026-09-03T00:00:00+00:00",
            ),
        )
        rowid = int(connection.execute("SELECT rowid FROM oai_records").fetchone()[0])
        connection.execute(
            """INSERT INTO oai_records_fts(
                rowid,source_id,provider_id,title,abstract,authors
            ) VALUES(?,?,?,?,?,?)""",
            (
                rowid,
                "legacy-source",
                "legacy-record",
                "Legacy Evidence",
                "Preserved abstract",
                "Ada Riu",
            ),
        )
        connection.execute(
            """INSERT INTO oai_sync_state(
                source_id,state,job_id,resumption_token,
                last_successful_datestamp,received_count,indexed_count,
                deleted_count,complete_list_size,cursor_value,cancel_requested,
                error,started_at,updated_at,completed_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                "legacy-source",
                "running",
                "job-1",
                "next-token",
                "2024-01-01",
                9,
                7,
                2,
                12,
                9,
                0,
                None,
                "2026-09-03T00:00:00+00:00",
                "2026-09-03T00:01:00+00:00",
                None,
            ),
        )

    result = ensure_database_schema(database, "literature_index", tmp_path)

    assert result["revision_before"] == "literature_0001"
    assert result["revision_after"] == "literature_0001"
    assert result["backup"]["sha256"]
    assert _current_revision(database) == "literature_0001"
    backup = tmp_path / result["backup"]["path"]
    with sqlite3.connect(backup) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM sqlite_schema WHERE name='alembic_version'"
        ).fetchone() == (0,)
        assert connection.execute("SELECT COUNT(*) FROM oai_records").fetchone() == (1,)
        assert connection.execute(
            "SELECT resumption_token FROM oai_sync_state WHERE source_id='legacy-source'"
        ).fetchone() == ("next-token",)
        assert connection.execute(
            "SELECT provider_id FROM oai_records_fts WHERE oai_records_fts MATCH 'preserved'"
        ).fetchone() == ("legacy-record",)
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT title,work_json FROM oai_records WHERE provider_id='legacy-record'"
        ).fetchone() == ("Legacy Evidence", '{"title":"Legacy Evidence"}')
        assert connection.execute(
            """SELECT state,job_id,resumption_token,received_count,indexed_count,
                deleted_count,complete_list_size,cursor_value
            FROM oai_sync_state WHERE source_id='legacy-source'"""
        ).fetchone() == ("running", "job-1", "next-token", 9, 7, 2, 12, 9)
        assert connection.execute(
            "SELECT provider_id FROM oai_records_fts WHERE oai_records_fts MATCH 'preserved'"
        ).fetchone() == ("legacy-record",)


def test_coordinator_discovers_dynamic_literature_indexes(tmp_path: Path) -> None:
    database = tmp_path / "literature" / "scope-a" / "academic_index.sqlite3"
    ensure_database_schema(database, "literature_index", tmp_path)

    discovered = existing_owned_databases(tmp_path)

    assert (database, "literature_index") in discovered


def test_unknown_literature_schema_aborts_without_backup_or_stamp(tmp_path: Path) -> None:
    database = tmp_path / "literature" / "drifted" / "academic_index.sqlite3"
    database.parent.mkdir(parents=True)
    with sqlite3.connect(database) as connection:
        connection.execute(
            "CREATE TABLE oai_records(source_id TEXT PRIMARY KEY, payload TEXT)"
        )
    checksum_before = _sha256(database)
    fingerprint_before = database_fingerprint(database)

    with pytest.raises(UnknownSchemaError, match="database was not modified"):
        ensure_database_schema(database, "literature_index", tmp_path)

    assert _sha256(database) == checksum_before
    assert database_fingerprint(database) == fingerprint_before
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM sqlite_schema WHERE name='alembic_version'"
        ).fetchone() == (0,)
    assert not (tmp_path / "backups").exists()


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


def test_large_backup_aborts_before_mutation_when_clone_and_space_are_unavailable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    database = tmp_path / "literature" / "scope" / "academic_index.sqlite3"
    database.parent.mkdir(parents=True)
    with sqlite3.connect(database) as connection:
        connection.executescript(LEGACY_LITERATURE_SCHEMA)
    checksum_before = _sha256(database)
    monkeypatch.setattr(
        migration_runner, "_try_copy_on_write_clone", lambda _source, _backup: False
    )
    monkeypatch.setattr(
        migration_runner.shutil,
        "disk_usage",
        lambda _path: SimpleNamespace(free=0),
    )

    with pytest.raises(SchemaMigrationError, match="Not enough free space"):
        ensure_database_schema(database, "literature_index", tmp_path)

    assert _sha256(database) == checksum_before
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM sqlite_schema WHERE name='alembic_version'"
        ).fetchone() == (0,)


def test_verified_backup_prefers_copy_on_write_without_full_copy_capacity(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    database = tmp_path / "literature" / "scope" / "academic_index.sqlite3"
    database.parent.mkdir(parents=True)
    with sqlite3.connect(database) as connection:
        connection.executescript(LEGACY_LITERATURE_SCHEMA)

    def clone(source: Path, destination: Path) -> bool:
        destination.write_bytes(source.read_bytes())
        return True

    def capacity_forbidden(_source: Path, _directory: Path) -> None:
        raise AssertionError("capacity fallback must not run after a successful clone")

    monkeypatch.setattr(migration_runner, "_try_copy_on_write_clone", clone)
    monkeypatch.setattr(
        migration_runner,
        "_require_full_backup_capacity",
        capacity_forbidden,
    )

    result = ensure_database_schema(database, "literature_index", tmp_path)

    assert result["changed"] is True
    assert result["backup"]["sha256"]
    assert _current_revision(database) == "literature_0001"
