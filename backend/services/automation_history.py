"""Scoped, paginated automation history for the activity centre."""
from typing import Any

from backend.services.capability_automations import _database_connection


def list_scoped_runs(scope: dict[str, str], *, limit: int, offset: int, automation_id: str | None = None) -> dict[str, Any]:
    where = "a.vault_scope=? AND a.workspace_id=? AND a.user_id=?"
    values: list[Any] = [scope["vault_scope"], scope["workspace_id"], scope["user_id"]]
    if automation_id:
        where += " AND a.id=?"
        values.append(automation_id)
    join = "capability_automation_runs r JOIN capability_automations a ON a.id=r.automation_id"
    with _database_connection() as connection:
        total = connection.execute(f"SELECT COUNT(*) FROM {join} WHERE {where}", values).fetchone()[0]
        rows = connection.execute(
            f"SELECT r.*, a.name AS automation_name, a.agent_id, a.skill_id FROM {join} "
            f"WHERE {where} ORDER BY r.started_at DESC, r.id DESC LIMIT ? OFFSET ?",
            [*values, limit, offset],
        ).fetchall()
    return {"runs": [dict(row) for row in rows], "total": total, "offset": offset}
