"""Add immutable publication previews, sites and revisions.

Revision ID: mgmt_0006
Revises: mgmt_0005
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "mgmt_0006"
down_revision = "mgmt_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "publication_previews",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("owner_id", sa.String(), nullable=False),
        sa.Column("workspace_id", sa.String(), nullable=False),
        sa.Column("vault_key", sa.String(), nullable=False),
        sa.Column("expires_at", sa.Integer(), nullable=False),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column("source_ids", sa.Text(), nullable=False),
        sa.Column("site_id", sa.String(), nullable=True),
        sa.Column("expected_revision", sa.Integer(), nullable=True),
    )
    op.create_index("ix_publication_previews_owner_id", "publication_previews", ["owner_id"])
    op.create_index("ix_publication_previews_expires_at", "publication_previews", ["expires_at"])
    op.create_table(
        "publication_sites",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("token", sa.String(), nullable=False),
        sa.Column("owner_id", sa.String(), nullable=False),
        sa.Column("workspace_id", sa.String(), nullable=False),
        sa.Column("vault_key", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("source_ids", sa.Text(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("revoked", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.Integer(), nullable=True),
    )
    op.create_index("ix_publication_sites_token", "publication_sites", ["token"], unique=True)
    op.create_index("ix_publication_sites_owner_id", "publication_sites", ["owner_id"])
    op.create_table(
        "publication_revisions",
        sa.Column("site_id", sa.String(), primary_key=True),
        sa.Column("revision", sa.Integer(), primary_key=True),
        sa.Column("payload", sa.Text(), nullable=False),
    )


def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
