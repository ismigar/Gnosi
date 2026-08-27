"""Persist URL validators and the last URL validation time.

Revision ID: notebooks_0002
Revises: notebooks_0001
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "notebooks_0002"
down_revision = "notebooks_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "notebook_resources",
        sa.Column(
            "url_validators_json",
            sa.Text(),
            nullable=False,
            server_default="{}",
        ),
    )
    op.add_column(
        "notebook_resources",
        sa.Column("url_checked_at", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
