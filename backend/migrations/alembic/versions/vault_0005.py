"""Index Reader lists by date, read state and source without changing articles.

Revision ID: vault_0005
Revises: vault_0004
"""

from __future__ import annotations

from alembic import op

revision = "vault_0005"
down_revision = "vault_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_articles_published_at", "articles", ["published_at"])
    op.create_index("ix_articles_unread_published_at", "articles", ["is_read", "published_at"])
    op.create_index("ix_articles_source_published_at", "articles", ["source_id", "published_at"])
    op.create_index(
        "ix_articles_source_unread_published_at", "articles",
        ["source_id", "is_read", "published_at"],
    )


def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
