"""Startup must let SQLite recover interrupted transactions before schema reads."""
from __future__ import annotations

import hashlib
import sqlite3
import subprocess
import sys
from contextlib import closing
from pathlib import Path

import pytest
from sqlalchemy.exc import OperationalError

from backend.migrations.families import FAMILIES
from backend.migrations.runner import _run_alembic, ensure_database_schema, verify_database_schema
from backend.migrations.schema_audit import database_fingerprint


CRASH_WRITER = """
import os, sqlite3, sys
connection = sqlite3.connect(sys.argv[1])
connection.execute('PRAGMA journal_mode=DELETE')
connection.execute('PRAGMA cache_size=1')
connection.execute('BEGIN IMMEDIATE')
connection.execute("UPDATE pending_agent_actions SET arguments_json='uncommitted'")
connection.execute('CREATE TABLE interrupted_schema_change (value BLOB)')
connection.execute('INSERT INTO interrupted_schema_change VALUES (zeroblob(262144))')
os._exit(23)
"""


def _interrupted_store(database: Path, revision: str) -> None:
    _run_alembic(database, "upgrade", revision)
    with closing(sqlite3.connect(database)) as connection, connection:
        connection.execute(
            """INSERT INTO pending_agent_actions
            (id, action, arguments_json, preview_json, vault_scope, workspace_id,
             user_id, role, agent_id, session_id, created_at, expires_at, status)
            VALUES ('saved', 'test', 'committed', '{}', 'vault', 'workspace',
                    'user', 'owner', 'agent', 'session', 1, 2, 'pending')"""
        )
    result = subprocess.run(
        [sys.executable, "-c", CRASH_WRITER, str(database)],
        check=False,
        timeout=30,
        capture_output=True,
    )
    assert result.returncode == 23, result.stderr.decode()
    journal = Path(str(database) + "-journal")
    assert journal.read_bytes()[:8] == bytes.fromhex("d9d505f920a163d7")


@pytest.mark.parametrize("revision", ["actions_0001", "actions_0002"])
def test_startup_recovers_hot_journal_and_preserves_committed_data(
    tmp_path: Path, revision: str,
) -> None:
    database = tmp_path / "agent_action_confirmations.sqlite"
    _interrupted_store(database, revision)
    journal = Path(str(database) + "-journal")
    original = (database.read_bytes(), journal.read_bytes())
    with pytest.raises(sqlite3.OperationalError) as error:
        database_fingerprint(database)
    assert error.value.sqlite_errorcode == sqlite3.SQLITE_READONLY_ROLLBACK
    assert (database.read_bytes(), journal.read_bytes()) == original
    with pytest.raises(OperationalError) as audit_error:
        verify_database_schema(database, "action_confirmations", tmp_path)
    assert isinstance(audit_error.value.orig, sqlite3.OperationalError)
    assert audit_error.value.orig.sqlite_errorcode == sqlite3.SQLITE_READONLY_ROLLBACK
    assert (database.read_bytes(), journal.read_bytes()) == original

    result = ensure_database_schema(database, "action_confirmations", tmp_path)
    assert result["revision_after"] == FAMILIES["action_confirmations"].head
    with closing(sqlite3.connect(database)) as connection:
        assert connection.execute(
            "SELECT arguments_json FROM pending_agent_actions WHERE id='saved'"
        ).fetchone() == ("committed",)
        assert connection.execute(
            "SELECT name FROM sqlite_schema WHERE name='interrupted_schema_change'"
        ).fetchall() == []
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    before_second_start = hashlib.sha256(database.read_bytes()).hexdigest()
    assert ensure_database_schema(database, "action_confirmations", tmp_path)["changed"] is False
    assert hashlib.sha256(database.read_bytes()).hexdigest() == before_second_start


def test_recovery_does_not_authorize_an_unknown_committed_schema(tmp_path: Path) -> None:
    from backend.migrations.runner import UnknownSchemaError

    database = tmp_path / "unknown.sqlite"
    _run_alembic(database, "upgrade", "actions_0002")
    with closing(sqlite3.connect(database)) as connection, connection:
        connection.execute("CREATE TABLE foreign_data (payload TEXT)")
        connection.execute("INSERT INTO foreign_data VALUES ('preserve')")
    result = subprocess.run(
        [sys.executable, "-c", CRASH_WRITER, str(database)],
        check=False, timeout=30, capture_output=True,
    )
    assert result.returncode == 23, result.stderr.decode()
    with pytest.raises(UnknownSchemaError, match="No schema migration was applied"):
        ensure_database_schema(database, "action_confirmations", tmp_path)
    with closing(sqlite3.connect(database)) as connection:
        assert connection.execute("SELECT payload FROM foreign_data").fetchall() == [("preserve",)]
        assert connection.execute(
            "SELECT name FROM sqlite_schema WHERE name='interrupted_schema_change'"
        ).fetchall() == []
    assert not (tmp_path / "backups").exists()
