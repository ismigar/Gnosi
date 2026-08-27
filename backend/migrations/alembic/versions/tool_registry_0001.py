"""Create the generated-tool approval registry."""

from alembic import op

revision = "tool_registry_0001"
down_revision = None
branch_labels = ("tool_registry",)
depends_on = None


def upgrade() -> None:
    op.execute(
        """CREATE TABLE tools (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL,
        description TEXT NOT NULL, code TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', risk_level TEXT NOT NULL,
        created_at TEXT NOT NULL, approved_at TEXT, rejected_at TEXT,
        rejection_reason TEXT)"""
    )
    op.execute("CREATE INDEX idx_tools_name ON tools(name)")
    op.execute("CREATE INDEX idx_tools_status ON tools(status)")


def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
