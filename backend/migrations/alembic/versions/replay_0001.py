"""Create the deterministic agent replay event store."""

from alembic import op

revision = "replay_0001"
down_revision = None
branch_labels = ("agent_replay",)
depends_on = None


def upgrade() -> None:
    op.execute(
        """CREATE TABLE replay_events (
        event_id TEXT PRIMARY KEY, trace_id TEXT NOT NULL,
        event_type TEXT NOT NULL, attributes TEXT NOT NULL,
        created_at TEXT NOT NULL)"""
    )
    op.execute("CREATE INDEX idx_replay_trace ON replay_events(trace_id, created_at)")


def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
