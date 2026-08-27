"""Create the initial grounded-notebooks repository.

Revision ID: notebooks_0001
Revises: None
"""

from __future__ import annotations

from alembic import op

revision = "notebooks_0001"
down_revision = None
branch_labels = ("notebooks",)
depends_on = None

STATEMENTS = (
    """CREATE TABLE notebooks (
        id TEXT PRIMARY KEY, vault_scope TEXT NOT NULL,
        workspace_id TEXT NOT NULL, owner_user_id TEXT NOT NULL,
        source_table_id TEXT NOT NULL, title TEXT NOT NULL,
        visibility TEXT NOT NULL, conversation_mode TEXT NOT NULL,
        active_revision INTEGER, status TEXT NOT NULL DEFAULT 'pending',
        last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(vault_scope, workspace_id, id)
    )""",
    """CREATE INDEX idx_notebooks_scope
        ON notebooks(vault_scope, workspace_id, updated_at DESC)""",
    """CREATE TABLE notebook_acl (
        notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
        principal_type TEXT NOT NULL, principal_id TEXT NOT NULL,
        access_role TEXT NOT NULL,
        PRIMARY KEY(notebook_id, principal_type, principal_id)
    )""",
    """CREATE TABLE notebook_resources (
        notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
        resource_id TEXT NOT NULL, ordinal INTEGER NOT NULL, fingerprint TEXT,
        state TEXT NOT NULL DEFAULT 'pending', error TEXT,
        updated_at TEXT NOT NULL, PRIMARY KEY(notebook_id, resource_id)
    )""",
    """CREATE INDEX idx_notebook_resources_order
        ON notebook_resources(notebook_id, ordinal, resource_id)""",
    """CREATE TABLE notebook_revisions (
        notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL, job_id TEXT, state TEXT NOT NULL,
        total_resources INTEGER NOT NULL DEFAULT 0,
        processed_resources INTEGER NOT NULL DEFAULT 0,
        available_sources INTEGER NOT NULL DEFAULT 0,
        error_sources INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, completed_at TEXT, error TEXT,
        PRIMARY KEY(notebook_id, revision)
    )""",
    """CREATE TABLE notebook_sources (
        notebook_id TEXT NOT NULL, revision INTEGER NOT NULL,
        source_id TEXT NOT NULL, resource_id TEXT NOT NULL, kind TEXT NOT NULL,
        label TEXT NOT NULL, source_url TEXT, fingerprint TEXT NOT NULL,
        snapshot_id TEXT, status TEXT NOT NULL, error TEXT,
        origin_json TEXT NOT NULL, PRIMARY KEY(notebook_id, revision, source_id),
        FOREIGN KEY(notebook_id, revision)
            REFERENCES notebook_revisions(notebook_id, revision) ON DELETE CASCADE
    )""",
    """CREATE INDEX idx_notebook_sources_resource
        ON notebook_sources(notebook_id, revision, resource_id)""",
    """CREATE TABLE notebook_chunks (
        notebook_id TEXT NOT NULL, revision INTEGER NOT NULL,
        chunk_id TEXT NOT NULL, source_id TEXT NOT NULL,
        resource_id TEXT NOT NULL, ordinal INTEGER NOT NULL, text TEXT NOT NULL,
        locator_json TEXT NOT NULL, citation_href TEXT NOT NULL,
        vector_json TEXT NOT NULL, PRIMARY KEY(notebook_id, revision, chunk_id),
        FOREIGN KEY(notebook_id, revision, source_id)
            REFERENCES notebook_sources(notebook_id, revision, source_id)
            ON DELETE CASCADE
    )""",
    """CREATE INDEX idx_notebook_chunks_source
        ON notebook_chunks(notebook_id, revision, source_id, ordinal)""",
    """CREATE VIRTUAL TABLE notebook_chunks_fts USING fts5(
        notebook_id UNINDEXED, revision UNINDEXED, chunk_id UNINDEXED, text,
        tokenize='unicode61 remove_diacritics 2'
    )""",
    """CREATE TABLE notebook_analyses (
        notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
        analysis_id TEXT NOT NULL, revision INTEGER NOT NULL,
        owner_user_id TEXT NOT NULL, request TEXT NOT NULL, state TEXT NOT NULL,
        result TEXT, error TEXT, job_id TEXT, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, PRIMARY KEY(notebook_id, analysis_id)
    )""",
    """CREATE TABLE notebook_conversation_principals (
        notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
        principal_id TEXT NOT NULL, session_id TEXT NOT NULL,
        user_id TEXT NOT NULL, conversation_mode TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(notebook_id, principal_id, session_id)
    )""",
)


def upgrade() -> None:
    for statement in STATEMENTS:
        op.execute(statement)


def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
