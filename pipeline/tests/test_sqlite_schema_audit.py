from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from backend.migrations.schema_audit import (
    audit,
    database_fingerprint,
    discover_databases,
)


def _create_database(path: Path) -> None:
    with sqlite3.connect(path) as connection:
        connection.executescript(
            """
            CREATE TABLE notes (
                id INTEGER PRIMARY KEY,
                title TEXT NOT NULL,
                body TEXT
            );
            CREATE INDEX idx_notes_title ON notes(title);
            """
        )


def test_audit_is_data_free_and_fingerprint_ignores_rows(tmp_path: Path) -> None:
    database = tmp_path / "example.sqlite"
    _create_database(database)

    before = audit(tmp_path)
    with sqlite3.connect(database) as connection:
        connection.execute(
            "INSERT INTO notes(title, body) VALUES (?, ?)",
            ("PRIVATE TITLE", "PRIVATE BODY"),
        )
    after = audit(tmp_path)

    before_database = before["databases"][0]
    after_database = after["databases"][0]
    assert before_database["fingerprint"] == after_database["fingerprint"]
    payload = json.dumps(after, sort_keys=True)
    assert "PRIVATE TITLE" not in payload
    assert "PRIVATE BODY" not in payload
    assert str(tmp_path) not in payload
    assert after_database["path"] == "example.sqlite"
    assert after_database["integrity_check"] == "ok"


def test_discovery_uses_header_and_skips_sidecars(tmp_path: Path) -> None:
    database = tmp_path / "database-without-extension"
    _create_database(database)
    (tmp_path / "not-a-database.sqlite").write_text("not sqlite", encoding="utf-8")
    (tmp_path / "database-without-extension-wal").write_bytes(b"not a database")

    assert discover_databases(tmp_path) == [database]


def test_fingerprint_normalizes_create_vs_add_column_order(tmp_path: Path) -> None:
    created = tmp_path / "created.sqlite"
    upgraded = tmp_path / "upgraded.sqlite"
    with sqlite3.connect(created) as connection:
        connection.execute(
            "CREATE TABLE sample (id INTEGER PRIMARY KEY, first TEXT, second TEXT)"
        )
        connection.execute("CREATE UNIQUE INDEX ix_sample_first ON sample(first)")
    with sqlite3.connect(upgraded) as connection:
        connection.execute("CREATE TABLE sample (id INTEGER PRIMARY KEY, second TEXT)")
        connection.execute("ALTER TABLE sample ADD COLUMN first TEXT")
        connection.execute("CREATE UNIQUE INDEX ix_sample_first ON sample(first)")

    assert database_fingerprint(created) == database_fingerprint(upgraded)


def test_fingerprint_detects_anonymous_unique_constraints(tmp_path: Path) -> None:
    unique = tmp_path / "unique.sqlite"
    plain = tmp_path / "plain.sqlite"
    with sqlite3.connect(unique) as connection:
        connection.execute("CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT UNIQUE)")
    with sqlite3.connect(plain) as connection:
        connection.execute("CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT)")

    assert database_fingerprint(unique) != database_fingerprint(plain)
