"""Create the initial model-evaluation metadata store.

Revision ID: evaluations_0001
Revises: None
"""

from __future__ import annotations

from alembic import op

revision = "evaluations_0001"
down_revision = None
branch_labels = ("model_evaluations",)
depends_on = None


def upgrade() -> None:
    op.execute(
        """CREATE TABLE model_evaluations (
            evaluation_id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider TEXT NOT NULL, model TEXT NOT NULL, agent_id TEXT NOT NULL,
            score REAL NOT NULL, passed INTEGER NOT NULL, total INTEGER NOT NULL,
            latency_ms INTEGER NOT NULL,
            input_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            estimated_cost_usd REAL NOT NULL DEFAULT 0,
            failure_codes TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
        )"""
    )
    op.execute(
        """CREATE INDEX idx_model_evaluations_route
        ON model_evaluations(provider, model, created_at DESC)"""
    )


def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
