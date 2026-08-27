"""Create the capability-health history store."""

from alembic import op

revision = "health_0001"
down_revision = None
branch_labels = ("capability_health",)
depends_on = None


def upgrade() -> None:
    op.execute(
        """CREATE TABLE capability_health (
        capability_key TEXT PRIMARY KEY, successes INTEGER NOT NULL DEFAULT 0,
        failures INTEGER NOT NULL DEFAULT 0,
        consecutive_failures INTEGER NOT NULL DEFAULT 0, last_error_code TEXT,
        last_failure_at REAL, last_success_at REAL, quarantined_until REAL,
        latency_total_ms INTEGER NOT NULL DEFAULT 0,
        latency_samples INTEGER NOT NULL DEFAULT 0, updated_at REAL NOT NULL)"""
    )
    op.execute(
        "CREATE INDEX idx_capability_health_updated ON capability_health(updated_at DESC)"
    )


def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
