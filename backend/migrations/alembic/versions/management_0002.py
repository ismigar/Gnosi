"""Add the first generation of access and authentication columns.

Revision ID: mgmt_0002
Revises: mgmt_0001
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "mgmt_0002"
down_revision = "mgmt_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "memberships",
        sa.Column("permissions", sa.String(), nullable=True),
    )
    op.execute(
        """UPDATE memberships
        SET permissions = '{"capabilities": ["read"]}'
        WHERE permissions IS NULL"""
    )
    op.add_column("users", sa.Column("password_hash", sa.String(), nullable=True))
    op.add_column("share_links", sa.Column("vault_id", sa.String(), nullable=True))


def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
