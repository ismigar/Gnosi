"""Create the durable academic literature and OAI index.

Revision ID: literature_0001
Revises: None
"""

from __future__ import annotations

from alembic import op

revision = "literature_0001"
down_revision = None
branch_labels = ("literature_index",)
depends_on = None

STATEMENTS = (
    """CREATE TABLE oai_records (
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
    )""",
    "CREATE INDEX idx_oai_records_key ON oai_records(duplicate_key)",
    """CREATE VIRTUAL TABLE oai_records_fts USING fts5(
        source_id UNINDEXED,
        provider_id UNINDEXED,
        title,
        abstract,
        authors,
        tokenize='unicode61 remove_diacritics 2'
    )""",
    """CREATE TABLE oai_sync_state (
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
    )""",
)


def upgrade() -> None:
    for statement in STATEMENTS:
        op.execute(statement)


def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
