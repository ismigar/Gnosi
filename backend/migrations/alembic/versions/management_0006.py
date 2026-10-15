"""Add scoped public forms, booking links and durable request receipts.

Revision ID: mgmt_0006
Revises: mgmt_0005
"""

from alembic import op

revision = "mgmt_0006"
down_revision = "mgmt_0005"
branch_labels = None
depends_on = None

# Frozen DDL: migration behavior must not change with future ORM edits.
TABLES = (
    """CREATE TABLE public_forms (
    id VARCHAR NOT NULL,
    token VARCHAR NOT NULL,
    workspace_id VARCHAR NOT NULL,
    vault_id VARCHAR NOT NULL,
    owner_id VARCHAR NOT NULL,
    table_id VARCHAR NOT NULL,
    title VARCHAR NOT NULL,
    description TEXT NOT NULL,
    fields_json TEXT NOT NULL,
    expires_at DATETIME,
    revoked BOOLEAN NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY(vault_id) REFERENCES vaults (id),
    FOREIGN KEY(owner_id) REFERENCES users (id)
)""",
    """CREATE TABLE public_form_submissions (
    id VARCHAR NOT NULL,
    form_id VARCHAR NOT NULL,
    request_id VARCHAR NOT NULL,
    fingerprint VARCHAR NOT NULL,
    payload_json TEXT NOT NULL,
    completed BOOLEAN NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_form_submission_request UNIQUE (form_id, request_id),
    FOREIGN KEY(form_id) REFERENCES public_forms (id)
)""",
    """CREATE TABLE booking_links (
    id VARCHAR NOT NULL,
    token VARCHAR NOT NULL,
    workspace_id VARCHAR NOT NULL,
    vault_id VARCHAR NOT NULL,
    owner_id VARCHAR NOT NULL,
    title VARCHAR NOT NULL,
    config_json TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    revoked BOOLEAN NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (token),
    FOREIGN KEY(workspace_id) REFERENCES workspaces (id),
    FOREIGN KEY(vault_id) REFERENCES vaults (id),
    FOREIGN KEY(owner_id) REFERENCES users (id)
)""",
    """CREATE TABLE booking_reservations (
    id VARCHAR NOT NULL,
    link_id VARCHAR NOT NULL,
    workspace_id VARCHAR NOT NULL,
    owner_id VARCHAR NOT NULL,
    idempotency_key VARCHAR NOT NULL,
    request_hash VARCHAR NOT NULL,
    start_at DATETIME NOT NULL,
    end_at DATETIME NOT NULL,
    blocked_start DATETIME NOT NULL,
    blocked_end DATETIME NOT NULL,
    name VARCHAR NOT NULL,
    email VARCHAR NOT NULL,
    status VARCHAR NOT NULL,
    event_id VARCHAR,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_booking_reservation_request UNIQUE (link_id, idempotency_key),
    FOREIGN KEY(link_id) REFERENCES booking_links (id),
    FOREIGN KEY(workspace_id) REFERENCES workspaces (id),
    FOREIGN KEY(owner_id) REFERENCES users (id)
)""",
)

INDEXES = (
    'CREATE UNIQUE INDEX ix_public_forms_token ON public_forms (token)',
    'CREATE INDEX ix_public_forms_workspace_id ON public_forms (workspace_id)',
    'CREATE INDEX ix_public_form_submissions_form_id ON public_form_submissions (form_id)',
    'CREATE INDEX ix_booking_links_owner_id ON booking_links (owner_id)',
    'CREATE INDEX ix_booking_links_vault_id ON booking_links (vault_id)',
    'CREATE INDEX ix_booking_links_workspace_id ON booking_links (workspace_id)',
    'CREATE INDEX ix_booking_owner_interval ON booking_reservations (workspace_id, owner_id, blocked_start, blocked_end)',
    'CREATE INDEX ix_booking_reservations_link_id ON booking_reservations (link_id)',
)


def upgrade() -> None:
    for statement in (*TABLES, *INDEXES):
        op.execute(statement)


def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
