"""Add stable vault slugs for Gnosi 2.0.6.

Revision ID: mgmt_0004
Revises: mgmt_0003
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "mgmt_0004"
down_revision = "mgmt_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("vaults", sa.Column("slug", sa.String(), nullable=True))


def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
