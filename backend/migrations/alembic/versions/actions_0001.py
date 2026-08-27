"""Create the initial governed-action confirmation store.

Revision ID: actions_0001
Revises: None
"""

from __future__ import annotations

from alembic import op

revision = "actions_0001"
down_revision = None
branch_labels = ("action_confirmations",)
depends_on = None


def upgrade() -> None:
    op.execute(
        """CREATE TABLE pending_agent_actions (
            id TEXT PRIMARY KEY, action TEXT NOT NULL,
            arguments_json TEXT NOT NULL, preview_json TEXT NOT NULL,
            vault_scope TEXT NOT NULL, workspace_id TEXT NOT NULL,
            user_id TEXT NOT NULL, role TEXT NOT NULL, agent_id TEXT NOT NULL,
            session_id TEXT NOT NULL, created_at REAL NOT NULL,
            expires_at REAL NOT NULL, status TEXT NOT NULL, result_json TEXT,
            error TEXT, completed_at REAL
        )"""
    )
    op.execute(
        """CREATE INDEX idx_pending_agent_actions_expiry
        ON pending_agent_actions(status, expires_at)"""
    )
def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
