"""Persist the selected source set for notebook analyses.

Revision ID: notebooks_0004
Revises: notebooks_0003
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "notebooks_0004"
down_revision = "notebooks_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "notebook_analyses",
        sa.Column(
            "source_ids_json",
            sa.Text(),
            nullable=False,
            server_default="null",
        ),
    )


def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
