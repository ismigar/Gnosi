"""Track the execution lease claim time for governed actions.

Revision ID: actions_0002
Revises: actions_0001
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "actions_0002"
down_revision = "actions_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "pending_agent_actions",
        sa.Column("claimed_at", sa.REAL(), nullable=True),
    )
    op.create_index(
        "idx_pending_agent_actions_scope",
        "pending_agent_actions",
        [
            "vault_scope",
            "workspace_id",
            "user_id",
            "agent_id",
            "session_id",
            "status",
        ],
        unique=False,
    )


def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
