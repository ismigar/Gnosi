"""Cover Reader inventory aggregation without opening article bodies.

Revision ID: vault_0006
Revises: vault_0005
"""

from __future__ import annotations

from alembic import op

revision = "vault_0006"
down_revision = "vault_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_articles_inventory", "articles", ["is_read", "source_id", "published_at"])
    op.drop_index("ix_articles_source_unread_published_at", table_name="articles")


def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
