"""Create the legacy per-vault relational schema.

Revision ID: vault_0001
Revises: None
"""

from __future__ import annotations

from alembic import op

revision = "vault_0001"
down_revision = None
branch_labels = ("vault",)
depends_on = None

TABLES = (
    """CREATE TABLE feed_sources (
        id INTEGER NOT NULL, name VARCHAR, url VARCHAR, category VARCHAR,
        type VARCHAR, created_at DATETIME, PRIMARY KEY (id)
    )""",
    """CREATE TABLE articles (
        id INTEGER NOT NULL, source_id INTEGER, title VARCHAR, url VARCHAR,
        content TEXT, published_at DATETIME, is_read BOOLEAN,
        created_at DATETIME, PRIMARY KEY (id),
        FOREIGN KEY(source_id) REFERENCES feed_sources (id), UNIQUE (url)
    )""",
    """CREATE TABLE mail_tags (
        id VARCHAR NOT NULL, name VARCHAR NOT NULL, color VARCHAR,
        created_at DATETIME, PRIMARY KEY (id)
    )""",
    """CREATE TABLE mail_message_tags (
        message_id VARCHAR NOT NULL, tag_id VARCHAR NOT NULL,
        account_email VARCHAR, subject VARCHAR, sender VARCHAR, date_str VARCHAR,
        PRIMARY KEY (message_id, tag_id),
        FOREIGN KEY(tag_id) REFERENCES mail_tags (id) ON DELETE CASCADE
    )""",
    """CREATE TABLE mail_views (
        id VARCHAR NOT NULL, name VARCHAR NOT NULL, fields TEXT, filters TEXT,
        filter_logic VARCHAR, group_by VARCHAR, sort_by VARCHAR,
        sort_dir VARCHAR, actions TEXT, created_at DATETIME,
        updated_at DATETIME, PRIMARY KEY (id)
    )""",
    """CREATE TABLE messages (
        id VARCHAR NOT NULL, thread_id VARCHAR, account_email VARCHAR,
        subject VARCHAR, sender VARCHAR, recipient VARCHAR, cc VARCHAR,
        bcc VARCHAR, date VARCHAR, timestamp INTEGER, body_text TEXT,
        body_html TEXT, snippet VARCHAR, is_read BOOLEAN, is_starred BOOLEAN,
        category VARCHAR, labels VARCHAR, raw_json TEXT, PRIMARY KEY (id)
    )""",
    """CREATE TABLE newsletter_account (
        id INTEGER NOT NULL, mail_server VARCHAR, mail_port INTEGER,
        mail_ssl VARCHAR, email VARCHAR, password VARCHAR,
        delete_after_ingest BOOLEAN, updated_at DATETIME, PRIMARY KEY (id)
    )""",
    """CREATE TABLE pdf_annotations (
        id INTEGER NOT NULL, source_uri VARCHAR NOT NULL,
        page INTEGER NOT NULL, type VARCHAR NOT NULL, color VARCHAR,
        rects_json TEXT, text TEXT, comment TEXT, tags VARCHAR,
        created_at DATETIME, updated_at DATETIME, PRIMARY KEY (id)
    )""",
)

INDEXES = (
    "CREATE INDEX ix_feed_sources_id ON feed_sources (id)",
    "CREATE INDEX ix_feed_sources_name ON feed_sources (name)",
    "CREATE UNIQUE INDEX ix_feed_sources_url ON feed_sources (url)",
    "CREATE INDEX ix_feed_sources_category ON feed_sources (category)",
    "CREATE INDEX ix_articles_id ON articles (id)",
    "CREATE INDEX ix_messages_id ON messages (id)",
    "CREATE INDEX ix_messages_thread_id ON messages (thread_id)",
    "CREATE INDEX ix_messages_account_email ON messages (account_email)",
    "CREATE INDEX ix_newsletter_account_id ON newsletter_account (id)",
    "CREATE INDEX ix_pdf_annotations_id ON pdf_annotations (id)",
    "CREATE INDEX ix_pdf_annotations_source_uri ON pdf_annotations (source_uri)",
)


def upgrade() -> None:
    for statement in (*TABLES, *INDEXES):
        op.execute(statement)


def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
