"""Persist full Reader article content.

Revision ID: vault_0002
Revises: vault_0001
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "vault_0002"
down_revision = "vault_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("articles", sa.Column("full_content", sa.Text(), nullable=True))


def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
