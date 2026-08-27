"""Add stable managed keys for PDF annotations.

Revision ID: vault_0003
Revises: vault_0002
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "vault_0003"
down_revision = "vault_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("pdf_annotations", sa.Column("managed_key", sa.String(), nullable=True))
    op.create_index(
        "ix_pdf_annotations_managed_key",
        "pdf_annotations",
        ["managed_key"],
        unique=True,
    )


def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
