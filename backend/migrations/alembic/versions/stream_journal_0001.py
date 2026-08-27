"""Create the resumable agent-stream journal."""

from alembic import op

revision = "stream_journal_0001"
down_revision = None
branch_labels = ("stream_journal",)
depends_on = None


def upgrade() -> None:
    op.execute(
        """CREATE TABLE stream_events (
        stream_id TEXT NOT NULL, scope_hash TEXT NOT NULL,
        sequence INTEGER NOT NULL, payload BLOB NOT NULL,
        created_at REAL NOT NULL, PRIMARY KEY(stream_id, sequence))"""
    )
    op.execute("CREATE INDEX idx_stream_events_expiry ON stream_events(created_at)")


def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
