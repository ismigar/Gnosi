"""Create privacy-safe agent quality telemetry stores."""

from alembic import op

revision = "quality_0001"
down_revision = None
branch_labels = ("quality_telemetry",)
depends_on = None


def upgrade() -> None:
    op.execute(
        """CREATE TABLE agent_quality_events (
        id TEXT PRIMARY KEY, vault_scope TEXT NOT NULL,
        workspace_id TEXT NOT NULL, user_id TEXT NOT NULL,
        agent_hash TEXT NOT NULL, session_hash TEXT NOT NULL,
        turn_hash TEXT NOT NULL, signal TEXT NOT NULL, rating TEXT,
        error_code TEXT, language TEXT NOT NULL, mode TEXT NOT NULL,
        domains_json TEXT NOT NULL, route TEXT NOT NULL, execution TEXT NOT NULL,
        output_strategy TEXT NOT NULL, required_tool TEXT,
        verification_status TEXT, limitations_json TEXT NOT NULL,
        tool_names_json TEXT NOT NULL, duration_bucket TEXT NOT NULL,
        created_at REAL NOT NULL, updated_at REAL NOT NULL)"""
    )
    op.execute(
        """CREATE INDEX idx_agent_quality_scope_time ON agent_quality_events(
        vault_scope, workspace_id, user_id, updated_at DESC)"""
    )
    op.execute(
        """CREATE TABLE agent_eval_candidates (
        id TEXT PRIMARY KEY, vault_scope TEXT NOT NULL,
        workspace_id TEXT NOT NULL, user_id TEXT NOT NULL,
        signature TEXT NOT NULL, review_status TEXT NOT NULL,
        occurrence_count INTEGER NOT NULL, first_seen REAL NOT NULL,
        last_seen REAL NOT NULL, scenario_json TEXT NOT NULL,
        synthetic_case_json TEXT NOT NULL, created_at REAL NOT NULL,
        updated_at REAL NOT NULL,
        UNIQUE (vault_scope, workspace_id, user_id, signature))"""
    )


def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
