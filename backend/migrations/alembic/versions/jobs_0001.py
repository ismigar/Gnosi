"""Create the durable agent-job queue."""

from alembic import op

revision = "jobs_0001"
down_revision = None
branch_labels = ("durable_jobs",)
depends_on = None


def upgrade() -> None:
    op.execute(
        """CREATE TABLE agent_jobs (
        job_id TEXT PRIMARY KEY, job_type TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE, payload TEXT NOT NULL,
        state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3, available_at TEXT NOT NULL,
        lease_until TEXT, worker_id TEXT, result TEXT, error TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"""
    )
    op.execute(
        "CREATE INDEX idx_agent_jobs_ready ON agent_jobs(state, available_at)"
    )


def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
