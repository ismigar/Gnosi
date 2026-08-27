"""Add notebook refresh progress, cancellation and retention state.

Revision ID: notebooks_0003
Revises: notebooks_0002
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "notebooks_0003"
down_revision = "notebooks_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "notebook_resources",
        sa.Column("last_checked_at", sa.Text(), nullable=True),
    )
    op.add_column(
        "notebook_revisions",
        sa.Column("current_resource_id", sa.Text(), nullable=True),
    )
    op.add_column(
        "notebook_revisions",
        sa.Column("current_resource_title", sa.Text(), nullable=True),
    )
    op.add_column(
        "notebook_revisions",
        sa.Column("cancel_requested_at", sa.Text(), nullable=True),
    )
    op.add_column(
        "notebook_revisions",
        sa.Column(
            "retention_eligible",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    op.create_table(
        "notebook_revision_pins",
        sa.Column("notebook_id", sa.Text(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("pin_type", sa.Text(), nullable=False),
        sa.Column("pin_id", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["notebook_id", "revision"],
            ["notebook_revisions.notebook_id", "notebook_revisions.revision"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("notebook_id", "revision", "pin_type", "pin_id"),
    )


def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
