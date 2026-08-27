"""Create governed capability automation definitions and run history."""

from alembic import op

revision = "automations_0001"
down_revision = None
branch_labels = ("capability_automations",)
depends_on = None


def upgrade() -> None:
    op.execute(
        """CREATE TABLE capability_automations (
        id TEXT PRIMARY KEY, vault_scope TEXT NOT NULL, vault_path TEXT NOT NULL,
        workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL,
        name TEXT NOT NULL, agent_id TEXT NOT NULL, skill_id TEXT NOT NULL,
        instruction TEXT NOT NULL, interval_minutes INTEGER NOT NULL,
        enabled INTEGER NOT NULL, max_runs_per_day INTEGER NOT NULL,
        max_ai_calls_per_run INTEGER NOT NULL, max_runtime_seconds INTEGER NOT NULL,
        next_run_at REAL, last_run_at REAL, last_status TEXT NOT NULL,
        created_at REAL NOT NULL, updated_at REAL NOT NULL, revision TEXT NOT NULL)"""
    )
    op.execute(
        """CREATE INDEX idx_capability_automations_due
        ON capability_automations(enabled, next_run_at)"""
    )
    op.execute(
        """CREATE TABLE capability_automation_runs (
        id TEXT PRIMARY KEY, automation_id TEXT NOT NULL, status TEXT NOT NULL,
        ai_calls INTEGER NOT NULL, confirmation_count INTEGER NOT NULL,
        error_code TEXT, started_at REAL NOT NULL, finished_at REAL,
        FOREIGN KEY (automation_id) REFERENCES capability_automations(id)
        ON DELETE CASCADE)"""
    )
    op.execute(
        """CREATE INDEX idx_capability_automation_runs
        ON capability_automation_runs(automation_id, started_at DESC)"""
    )


def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
