"""Add explicit account provenance.

Revision ID: mgmt_0003
Revises: mgmt_0002
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "mgmt_0003"
down_revision = "mgmt_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "auto_provisioned",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    op.execute(
        """UPDATE users SET auto_provisioned = 1
        WHERE lower(email) LIKE '%@example.com'
           OR lower(email) = 'ismael-legacy@gnosi.app'"""
    )
def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
