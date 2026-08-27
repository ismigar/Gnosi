"""Alembic must add and backfill explicit account provenance safely."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from backend.migrations.runner import _run_alembic, ensure_database_schema


def _pre_column_db(tmp_path: Path, rows: list[tuple[str, str]]) -> Path:
    database = tmp_path / "system" / "management.sqlite"
    database.parent.mkdir(parents=True)
    _run_alembic(database, "upgrade", "mgmt_0002")
    with sqlite3.connect(database) as connection:
        connection.executemany(
            "INSERT INTO users(id,email) VALUES (?, ?)",
            rows,
        )
        connection.execute("DROP TABLE alembic_version")
    return database


def _flags(database: Path) -> dict[str, int]:
    with sqlite3.connect(database) as connection:
        return {
            str(email): int(flag)
            for email, flag in connection.execute(
                "SELECT email, auto_provisioned FROM users"
            )
        }


def test_migration_adds_the_column_and_backfills_the_minted_accounts(
    tmp_path: Path,
) -> None:
    database = _pre_column_db(
        tmp_path,
        [
            ("u1", "user@example.com"),
            ("u2", "ghost@example.com"),
            ("u3", "ismael-legacy@gnosi.app"),
            ("u4", "ismael@correu-real.cat"),
            ("u5", "algu@gnosi.app"),
        ],
    )

    ensure_database_schema(database, "management", tmp_path)

    flags = _flags(database)
    assert flags["user@example.com"] == 1
    assert flags["ghost@example.com"] == 1
    assert flags["ismael-legacy@gnosi.app"] == 1
    assert flags["ismael@correu-real.cat"] == 0
    assert flags["algu@gnosi.app"] == 0


def test_backfill_matches_regardless_of_case(tmp_path: Path) -> None:
    database = _pre_column_db(tmp_path, [("u1", "USER@EXAMPLE.COM")])
    ensure_database_schema(database, "management", tmp_path)
    assert _flags(database)["USER@EXAMPLE.COM"] == 1


def test_migration_is_idempotent_and_does_not_re_backfill(tmp_path: Path) -> None:
    database = _pre_column_db(tmp_path, [("u1", "user@example.com")])
    ensure_database_schema(database, "management", tmp_path)
    with sqlite3.connect(database) as connection:
        connection.execute("UPDATE users SET auto_provisioned = 0 WHERE id = 'u1'")

    ensure_database_schema(database, "management", tmp_path)

    assert _flags(database)["user@example.com"] == 0
