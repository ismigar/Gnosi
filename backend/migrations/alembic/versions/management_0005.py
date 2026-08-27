"""Repair the missing vault-slug index on upgraded 2.0.6 databases.

Revision ID: mgmt_0005
Revises: mgmt_0004
"""

from __future__ import annotations

from alembic import op

revision = "mgmt_0005"
down_revision = "mgmt_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_vaults_slug", "vaults", ["slug"], unique=False)


def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
