"""Create the scoped semantic-association store."""

from alembic import op

revision = "semantic_memory_0001"
down_revision = None
branch_labels = ("semantic_memory",)
depends_on = None


def upgrade() -> None:
    op.execute(
        """CREATE TABLE semantic_associations (
        id TEXT PRIMARY KEY, vault_scope TEXT NOT NULL,
        trigger_term TEXT NOT NULL, related_term TEXT NOT NULL,
        created_by TEXT NOT NULL, created_at REAL NOT NULL,
        updated_at REAL NOT NULL,
        UNIQUE(vault_scope, trigger_term, related_term))"""
    )
    op.execute(
        """CREATE INDEX idx_semantic_associations_scope
        ON semantic_associations(vault_scope, trigger_term, updated_at DESC)"""
    )


def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
