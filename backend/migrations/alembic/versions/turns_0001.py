"""Create the idempotent agent-turn claim store."""

from alembic import op

revision = "turns_0001"
down_revision = None
branch_labels = ("turn_claims",)
depends_on = None


def upgrade() -> None:
    op.execute(
        """CREATE TABLE turn_claims (
        claim_key TEXT PRIMARY KEY, state TEXT NOT NULL, trace_id TEXT,
        result TEXT, updated_at TEXT NOT NULL)"""
    )


def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
