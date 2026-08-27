"""Create the legacy Gnosi management schema.

Revision ID: mgmt_0001
Revises: None
"""

from __future__ import annotations

from alembic import op

revision = "mgmt_0001"
down_revision = None
branch_labels = ("management",)
depends_on = None


TABLES = (
    """CREATE TABLE users (
        id VARCHAR NOT NULL, email VARCHAR NOT NULL, name VARCHAR,
        avatar_url VARCHAR, created_at DATETIME, PRIMARY KEY (id)
    )""",
    """CREATE TABLE workspaces (
        id VARCHAR NOT NULL, name VARCHAR NOT NULL, slug VARCHAR,
        created_at DATETIME, PRIMARY KEY (id)
    )""",
    """CREATE TABLE memberships (
        user_id VARCHAR NOT NULL, workspace_id VARCHAR NOT NULL, role VARCHAR,
        joined_at DATETIME, PRIMARY KEY (user_id, workspace_id),
        FOREIGN KEY(user_id) REFERENCES users (id),
        FOREIGN KEY(workspace_id) REFERENCES workspaces (id)
    )""",
    """CREATE TABLE vaults (
        id VARCHAR NOT NULL, workspace_id VARCHAR, name VARCHAR NOT NULL,
        path_override VARCHAR, created_at DATETIME, PRIMARY KEY (id),
        FOREIGN KEY(workspace_id) REFERENCES workspaces (id)
    )""",
    """CREATE TABLE vault_access (
        id VARCHAR NOT NULL, vault_id VARCHAR NOT NULL, user_id VARCHAR NOT NULL,
        workspace_id VARCHAR NOT NULL, permissions VARCHAR, granted_at DATETIME,
        PRIMARY KEY (id), FOREIGN KEY(vault_id) REFERENCES vaults (id),
        FOREIGN KEY(user_id) REFERENCES users (id),
        FOREIGN KEY(workspace_id) REFERENCES workspaces (id)
    )""",
    """CREATE TABLE api_tokens (
        id VARCHAR NOT NULL, user_id VARCHAR NOT NULL, workspace_id VARCHAR,
        name VARCHAR NOT NULL, token_hash VARCHAR NOT NULL,
        token_prefix VARCHAR NOT NULL, scopes VARCHAR, created_at DATETIME,
        last_used_at DATETIME, revoked INTEGER, PRIMARY KEY (id),
        FOREIGN KEY(user_id) REFERENCES users (id)
    )""",
    """CREATE TABLE share_links (
        id VARCHAR NOT NULL, page_id VARCHAR NOT NULL,
        workspace_id VARCHAR NOT NULL, created_by VARCHAR, permission VARCHAR,
        expires_at DATETIME, revoked INTEGER, created_at DATETIME,
        PRIMARY KEY (id)
    )""",
    """CREATE TABLE contacts (
        id VARCHAR NOT NULL, workspace_id VARCHAR NOT NULL, type VARCHAR NOT NULL,
        name VARCHAR NOT NULL, email VARCHAR NOT NULL, phone VARCHAR,
        company VARCHAR, job_title VARCHAR, address VARCHAR, notes TEXT,
        emails TEXT, phones TEXT, addresses TEXT, google_resource_name VARCHAR,
        apple_resource_id VARCHAR, last_synced_at DATETIME,
        source VARCHAR NOT NULL, photo_url VARCHAR, tags VARCHAR,
        created_at DATETIME, updated_at DATETIME, PRIMARY KEY (id),
        FOREIGN KEY(workspace_id) REFERENCES workspaces (id)
    )""",
    """CREATE TABLE hidden_events (
        event_id VARCHAR NOT NULL, user_id VARCHAR, hidden_at DATETIME,
        PRIMARY KEY (event_id)
    )""",
    """CREATE TABLE notifications (
        id VARCHAR NOT NULL, workspace_id VARCHAR NOT NULL,
        level VARCHAR NOT NULL, title VARCHAR NOT NULL, message TEXT NOT NULL,
        is_read BOOLEAN, created_at DATETIME, PRIMARY KEY (id),
        FOREIGN KEY(workspace_id) REFERENCES workspaces (id)
    )""",
    """CREATE TABLE task_execution_history (
        id VARCHAR NOT NULL, task_name VARCHAR NOT NULL, description VARCHAR,
        status VARCHAR NOT NULL, message TEXT, started_at DATETIME,
        finished_at DATETIME, duration_seconds FLOAT, PRIMARY KEY (id)
    )""",
)

INDEXES = (
    "CREATE UNIQUE INDEX ix_users_email ON users (email)",
    "CREATE UNIQUE INDEX ix_workspaces_slug ON workspaces (slug)",
    "CREATE INDEX ix_api_tokens_user_id ON api_tokens (user_id)",
    "CREATE UNIQUE INDEX ix_api_tokens_token_hash ON api_tokens (token_hash)",
    "CREATE INDEX ix_share_links_page_id ON share_links (page_id)",
    "CREATE INDEX ix_contacts_workspace_id ON contacts (workspace_id)",
    "CREATE INDEX ix_contacts_email ON contacts (email)",
    "CREATE INDEX ix_contacts_google_resource_name ON contacts (google_resource_name)",
    "CREATE INDEX ix_hidden_events_event_id ON hidden_events (event_id)",
    "CREATE INDEX ix_hidden_events_user_id ON hidden_events (user_id)",
    "CREATE INDEX ix_notifications_workspace_id ON notifications (workspace_id)",
    "CREATE INDEX ix_task_execution_history_task_name ON task_execution_history (task_name)",
)


def upgrade() -> None:
    for statement in (*TABLES, *INDEXES):
        op.execute(statement)


def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
