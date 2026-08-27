"""Create the governed capability audit log."""

from alembic import op

revision = "capability_audit_0001"
down_revision = None
branch_labels = ("capability_audit",)
depends_on = None


def upgrade() -> None:
    op.execute(
        """CREATE TABLE capability_audit_events (
        id TEXT PRIMARY KEY, vault_scope TEXT NOT NULL,
        workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL,
        agent_id TEXT NOT NULL, session_id TEXT NOT NULL, tool_id TEXT NOT NULL,
        tool_name TEXT NOT NULL, effects_json TEXT NOT NULL, status TEXT NOT NULL,
        argument_keys_json TEXT NOT NULL, result_kind TEXT NOT NULL,
        error_code TEXT, duration_ms INTEGER NOT NULL, created_at REAL NOT NULL)"""
    )
    op.execute(
        """CREATE INDEX idx_capability_audit_scope_time
        ON capability_audit_events(
        vault_scope, workspace_id, user_id, agent_id, session_id, created_at DESC)"""
    )


def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
