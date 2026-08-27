"""Add notebook group visibility state.

Revision ID: notebooks_0005
Revises: notebooks_0004
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "notebooks_0005"
down_revision = "notebooks_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "notebooks",
        sa.Column("groups_json", sa.Text(), nullable=False, server_default="[]"),
    )


def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
