"""Calendar and publication migrations share one immutable management lineage."""

from __future__ import annotations

import hashlib
import sqlite3
from pathlib import Path

import pytest
from sqlalchemy import create_engine

from backend.data.management_db import Base
from backend.domains.vault.publishing import models as publication_models  # noqa: F401
from backend.models import booking, forms, management  # noqa: F401
from backend.migrations.families import FAMILIES
from backend.migrations.runner import (
    UnknownSchemaError,
    _current_revision,
    _expected_fingerprints,
    _run_alembic,
    ensure_database_schema,
    verify_database_schema,
)
from backend.migrations.schema_audit import database_fingerprint, schema_fingerprint


CALENDAR_TABLES = (
    "public_forms", "public_form_submissions", "booking_links", "booking_reservations",
)
PUBLICATION_TABLES = (
    "publication_previews", "publication_sites", "publication_revisions",
)


def _table_names(database: Path) -> frozenset[str]:
    with sqlite3.connect(database) as connection:
        return frozenset(
            row[0] for row in connection.execute(
                "SELECT name FROM sqlite_schema WHERE type='table' AND name != 'alembic_version'"
            )
        )


def _fingerprint_excluding(database: Path, tables: frozenset[str]) -> str:
    with sqlite3.connect(database) as connection:
        connection.row_factory = sqlite3.Row
        return schema_fingerprint(connection, excluded_tables=tables | {"alembic_version"})


def _insert_sentinel(connection: sqlite3.Connection, table: str) -> list[tuple[object, ...]]:
    """Fill every column so upgrade preservation includes actual stored values."""
    columns = connection.execute(f'PRAGMA table_info("{table}")').fetchall()
    names = ", ".join(f'"{column[1]}"' for column in columns)
    values = [
        1 if column[2] in {"BOOLEAN", "INTEGER"} else
        "2026-10-14 12:00:00" if column[2] == "DATETIME" else
        f"sentinel-{table}-{column[1]}"
        for column in columns
    ]
    placeholders = ", ".join("?" for _ in columns)
    connection.execute(f'INSERT INTO "{table}" ({names}) VALUES ({placeholders})', values)
    return connection.execute(f'SELECT * FROM "{table}"').fetchall()


@pytest.mark.parametrize("predecessor", (None, "mgmt_0005", "mgmt_0006"))
def test_management_upgrade_matches_models_and_preserves_predecessor_rows(
    tmp_path: Path, predecessor: str | None,
) -> None:
    database = tmp_path / "management.sqlite"
    sentinels = {}
    if predecessor:
        _run_alembic(database, "upgrade", predecessor)
        with sqlite3.connect(database) as connection:
            sentinels["share_links"] = _insert_sentinel(connection, "share_links")
            if predecessor == "mgmt_0006":
                for table in CALENDAR_TABLES:
                    sentinels[table] = _insert_sentinel(connection, table)

    result = ensure_database_schema(database, "management", tmp_path)

    assert result["revision_before"] == predecessor
    assert result["revision_after"] == "mgmt_0007"
    assert _current_revision(database) == "mgmt_0007"
    assert bool(result["backup"]) is bool(predecessor)
    if predecessor:
        backup = tmp_path / result["backup"]["path"]
        assert hashlib.sha256(backup.read_bytes()).hexdigest() == result["backup"]["sha256"]
        assert _current_revision(backup) == predecessor
        with sqlite3.connect(backup) as connection:
            for table, rows in sentinels.items():
                assert connection.execute(f'SELECT * FROM "{table}"').fetchall() == rows
    with sqlite3.connect(database) as connection:
        for table, rows in sentinels.items():
            assert connection.execute(f'SELECT * FROM "{table}"').fetchall() == rows
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_schema WHERE type='table'")}
        assert set(CALENDAR_TABLES + PUBLICATION_TABLES) <= tables
    assert database_fingerprint(database) in _expected_fingerprints(FAMILIES["management"], "mgmt_0007")
    assert verify_database_schema(database, "management", tmp_path)["revision"] == "mgmt_0007"

    orm_database = tmp_path / "orm.sqlite"
    engine = create_engine(f"sqlite:///{orm_database}")
    try:
        Base.metadata.create_all(engine)
    finally:
        engine.dispose()
    frozen_predecessor = tmp_path / "frozen-management-five.sqlite"
    _run_alembic(frozen_predecessor, "upgrade", "mgmt_0005")
    added_tables = frozenset(CALENDAR_TABLES + PUBLICATION_TABLES)
    baseline_tables = _table_names(frozen_predecessor)
    assert _table_names(database) == baseline_tables | added_tables
    assert _table_names(orm_database) == baseline_tables | added_tables
    # Legacy management DDL already differs from current ORM metadata in
    # nullable flags/defaults. Preserve that reviewed baseline exactly; only
    # the seven added tables must match the current ORM schema exactly.
    assert _fingerprint_excluding(database, added_tables) == database_fingerprint(frozen_predecessor)
    assert _fingerprint_excluding(database, baseline_tables) == _fingerprint_excluding(
        orm_database, baseline_tables,
    )
    assert ensure_database_schema(database, "management", tmp_path)["changed"] is False


def test_unpublished_publication_only_revision_six_is_rejected_without_mutation(tmp_path: Path) -> None:
    database = tmp_path / "management.sqlite"
    _run_alembic(database, "upgrade", "mgmt_0007")
    # Reconstruct the colliding, unpublished branch exactly: predecessor5 plus
    # publication DDL, stamped6, with no calendar/form tables. This is not the
    # reviewed calendar revision6 and must never pass its schema guard.
    with sqlite3.connect(database) as connection:
        for table in reversed(CALENDAR_TABLES):
            connection.execute(f'DROP TABLE "{table}"')
        connection.execute("UPDATE alembic_version SET version_num='mgmt_0006'")
        rows = _insert_sentinel(connection, "publication_sites")
    assert database_fingerprint(database) == "3e9718bfa01f7a7a6e17be04c043bfdb73670163337a12ead13ee31b613ebb10"
    before = hashlib.sha256(database.read_bytes()).hexdigest()

    with pytest.raises(UnknownSchemaError, match="Schema drift for management at mgmt_0006"):
        ensure_database_schema(database, "management", tmp_path)

    assert hashlib.sha256(database.read_bytes()).hexdigest() == before
    assert _current_revision(database) == "mgmt_0006"
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT * FROM publication_sites").fetchall() == rows
    assert not (tmp_path / "backups").exists()
