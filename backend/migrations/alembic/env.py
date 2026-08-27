"""Shared online-only Alembic environment for independent schema branches."""

from __future__ import annotations

from alembic import context
from sqlalchemy.engine import Connection


def run_migrations_online() -> None:
    """Run against the connection supplied by the guarded migration runner."""
    connection = context.config.attributes.get("connection")
    if not isinstance(connection, Connection):
        raise RuntimeError("Gnosi migrations require an explicit SQLAlchemy connection.")
    context.configure(
        connection=connection,
        target_metadata=None,
        render_as_batch=True,
        transactional_ddl=True,
        version_table="alembic_version",
    )
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    raise RuntimeError("Offline Gnosi migrations are not supported.")
run_migrations_online()
