"""Create the explicit personal-memory store."""

from alembic import op

revision = "personal_memory_0001"
down_revision = None
branch_labels = ("personal_memory",)
depends_on = None


def upgrade() -> None:
    op.execute(
        """CREATE TABLE personal_memories (
        memory_id TEXT PRIMARY KEY, scope_hash TEXT NOT NULL, text TEXT NOT NULL,
        category TEXT NOT NULL, provenance TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1, expires_at TEXT,
        revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL)"""
    )
    op.execute(
        """CREATE INDEX idx_personal_memories_scope
        ON personal_memories(scope_hash, updated_at DESC)"""
    )


def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
