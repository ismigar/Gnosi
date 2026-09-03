"""Scope persisted mail-tag associations by provider message identity.

Revision ID: vault_0004
Revises: vault_0003
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa

revision = "vault_0004"
down_revision = "vault_0003"
branch_labels = None
depends_on = None

_OLD_TABLE = "mail_message_tags_vault_0003"


def _legacy_key(message_id: str, account_email: str | None) -> str:
    return json.dumps(
        ["legacy-tag", (account_email or "").strip().lower(), message_id],
        ensure_ascii=True,
        separators=(",", ":"),
    )


def _create_scoped_table() -> sa.Table:
    return op.create_table(
        "mail_message_tags",
        sa.Column("message_identity", sa.String(), nullable=False),
        sa.Column("tag_id", sa.String(), nullable=False),
        sa.Column("message_id", sa.String(), nullable=False),
        sa.Column("identity_kind", sa.String(), nullable=False),
        sa.Column("account_email", sa.String(), nullable=True),
        sa.Column("provider", sa.String(), nullable=True),
        sa.Column("folder", sa.String(), nullable=True),
        sa.Column("provider_uid", sa.String(), nullable=True),
        sa.Column("subject", sa.String(), nullable=True),
        sa.Column("sender", sa.String(), nullable=True),
        sa.Column("date_str", sa.String(), nullable=True),
        sa.CheckConstraint(
            "identity_kind IN ('legacy', 'scoped')",
            name="ck_mail_message_tags_identity_kind",
        ),
        sa.ForeignKeyConstraint(["tag_id"], ["mail_tags.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("message_identity", "tag_id"),
    )


def upgrade() -> None:
    connection = op.get_bind()
    before = int(
        connection.execute(sa.text("SELECT COUNT(*) FROM mail_message_tags")).scalar_one()
    )
    op.rename_table("mail_message_tags", _OLD_TABLE)
    scoped_table = _create_scoped_table()

    rows = connection.execute(
        sa.text(
            f"""SELECT message_id, tag_id, account_email, subject, sender, date_str
            FROM {_OLD_TABLE}
            ORDER BY message_id, tag_id"""
        )
    ).mappings()
    batch: list[dict[str, object]] = []
    for row in rows:
        message_id = str(row["message_id"])
        account_email = None if row["account_email"] is None else str(row["account_email"])
        batch.append(
            {
                "message_identity": _legacy_key(message_id, account_email),
                "tag_id": str(row["tag_id"]),
                "message_id": message_id,
                "identity_kind": "legacy",
                "account_email": account_email,
                "provider": None,
                "folder": None,
                "provider_uid": None,
                "subject": row["subject"],
                "sender": row["sender"],
                "date_str": row["date_str"],
            }
        )
        if len(batch) == 500:
            op.bulk_insert(scoped_table, batch)
            batch.clear()
    if batch:
        op.bulk_insert(scoped_table, batch)

    after = int(
        connection.execute(sa.text("SELECT COUNT(*) FROM mail_message_tags")).scalar_one()
    )
    if after != before:
        raise RuntimeError("mail_message_tags row-count verification failed")
    foreign_key_errors = connection.execute(
        sa.text("PRAGMA foreign_key_check(mail_message_tags)")
    ).fetchall()
    if foreign_key_errors:
        raise RuntimeError("mail_message_tags foreign-key verification failed")

    op.drop_table(_OLD_TABLE)
    op.create_index(
        "ix_mail_message_tags_message_id",
        "mail_message_tags",
        ["message_id"],
    )
    op.create_index(
        "ix_mail_message_tags_account_email",
        "mail_message_tags",
        ["account_email"],
    )


def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
