"""Scope memories and persist private learning projects and session bindings."""

from alembic import op

revision = "personal_memory_0002"
down_revision = "personal_memory_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for name, default in (("scope_kind", "personal"), ("scope_id", ""),
                          ("source_session_id", ""), ("source_turn_id", "")):
        op.execute(f"ALTER TABLE personal_memories ADD COLUMN {name} TEXT NOT NULL DEFAULT '{default}'")
    op.execute("""CREATE TABLE learning_projects (
        id TEXT PRIMARY KEY, owner_hash TEXT NOT NULL, payload TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL)""")
    op.execute("CREATE INDEX idx_learning_project_owner ON learning_projects(owner_hash)")
    op.execute("""CREATE TABLE learning_sessions (
        owner_hash TEXT NOT NULL, session_id TEXT NOT NULL, project_id TEXT NOT NULL,
        PRIMARY KEY(owner_hash, session_id))""")
    op.execute("""CREATE UNIQUE INDEX idx_memory_capture ON personal_memories
        (scope_hash, source_session_id, source_turn_id)
        WHERE source_turn_id != ''""")


def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
