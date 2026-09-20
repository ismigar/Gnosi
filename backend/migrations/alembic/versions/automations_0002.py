"""Preserve existing interval automations and add calendar schedules."""
from alembic import op

revision = "automations_0002"
down_revision = "automations_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE capability_automations ADD COLUMN schedule TEXT NOT NULL DEFAULT '{\"kind\":\"interval\"}'")

    op.execute("ALTER TABLE capability_automation_runs ADD COLUMN result_text TEXT NOT NULL DEFAULT ''")

def downgrade() -> None:
    raise RuntimeError("Restore the verified backup to roll back Gnosi data.")
