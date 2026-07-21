"""The `auto_provisioned` column must arrive on existing databases WITH its backfill.

Adding the column alone would REMOVE a protection: rows created before it exists
default to 0 ("invited"), so the claim guard would stop refusing the placeholder
accounts an older install already has. The lightweight migration therefore
backfills from the address at the moment it adds the column.

These tests build a real pre-column SQLite `users` table and run the migration
against it, rather than trusting that the SQL is right by reading it.
"""
from __future__ import annotations

import sqlalchemy
from sqlalchemy import text

from backend.data.management_db import _apply_lightweight_migrations


def _pre_column_db(tmp_path, rows):
    """A `users` table shaped like an install that predates auto_provisioned."""
    engine = sqlalchemy.create_engine(f"sqlite:///{tmp_path}/mgmt.sqlite")
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE users ("
            " id VARCHAR PRIMARY KEY, email VARCHAR NOT NULL UNIQUE,"
            " name VARCHAR, avatar_url VARCHAR, password_hash VARCHAR,"
            " created_at DATETIME)"
        ))
        for uid, email in rows:
            conn.execute(
                text("INSERT INTO users (id, email) VALUES (:i, :e)"),
                {"i": uid, "e": email},
            )
    return engine


def _flags(engine):
    with engine.begin() as conn:
        return dict(conn.execute(text("SELECT email, auto_provisioned FROM users")).all())


def test_migration_adds_the_column_and_backfills_the_minted_accounts(tmp_path):
    engine = _pre_column_db(tmp_path, [
        ("u1", "user@example.com"),            # _ensure_personal_exists
        ("u2", "ghost@example.com"),           # POST /api/workspaces
        ("u3", "ismael-legacy@gnosi.app"),     # init_management.py
        ("u4", "ismael@correu-real.cat"),      # a real, invited person
        ("u5", "algu@gnosi.app"),              # invited, on a domain we host
    ])

    _apply_lightweight_migrations(engine)

    flags = _flags(engine)
    assert flags["user@example.com"] == 1
    assert flags["ghost@example.com"] == 1
    assert flags["ismael-legacy@gnosi.app"] == 1
    # The ones a human invited must stay claimable.
    assert flags["ismael@correu-real.cat"] == 0
    assert flags["algu@gnosi.app"] == 0


def test_backfill_matches_regardless_of_case(tmp_path):
    engine = _pre_column_db(tmp_path, [("u1", "USER@EXAMPLE.COM")])
    _apply_lightweight_migrations(engine)
    assert _flags(engine)["USER@EXAMPLE.COM"] == 1


def test_migration_is_idempotent_and_does_not_re_backfill(tmp_path):
    """A second run must not undo a flag an operator deliberately cleared."""
    engine = _pre_column_db(tmp_path, [("u1", "user@example.com")])
    _apply_lightweight_migrations(engine)

    with engine.begin() as conn:
        conn.execute(text("UPDATE users SET auto_provisioned = 0 WHERE id = 'u1'"))

    _apply_lightweight_migrations(engine)  # column already there: no backfill
    assert _flags(engine)["user@example.com"] == 0
