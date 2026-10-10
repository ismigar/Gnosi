"""Report coordinated usage once, without counting job rollups a second time."""
from __future__ import annotations

from typing import Any

from backend.agent import model_router
from backend.services import agent_execution_store as store
from backend.services.agent_execution_models import AgentRun, ExecutionScope


def team_usage(scope: ExecutionScope, run_id: str) -> dict[str, Any]:
    store.read(scope, run_id)  # Validate the root before inspecting its descendants.
    tree = """WITH RECURSIVE descendants(id) AS (
        SELECT run_id FROM agent_runs WHERE run_id=?
        UNION SELECT r.run_id FROM agent_runs r JOIN descendants d
        ON json_extract(r.payload,'$.parent_run_id')=d.id)
    """
    with store.connect() as db:
        rows = db.execute(tree + """SELECT r.payload FROM agent_runs r JOIN descendants d ON r.run_id=d.id
            WHERE r.user_id=? AND r.workspace_id=? AND r.vault_path=?
            AND COALESCE(json_extract(r.request,'$.mode'),'')!='job'""",
            (run_id, scope.user_id, scope.workspace_id, scope.vault_path)).fetchall()
        tool_calls = db.execute(tree + """SELECT COUNT(*) FROM agent_trace_events e
            JOIN descendants d ON e.run_id=d.id JOIN agent_runs r ON e.run_id=r.run_id
            WHERE e.kind='tool.request' AND r.user_id=? AND r.workspace_id=? AND r.vault_path=?""",
            (run_id, scope.user_id, scope.workspace_id, scope.vault_path)).fetchone()[0]
    runs = [AgentRun.model_validate_json(row[0]) for row in rows]
    cost = 0.0
    registry = model_router.load_registry()
    for run in runs:
        input_rate, output_rate = model_router.model_cost_rates(run.provider, run.model, registry=registry)
        cost += (run.input_tokens * input_rate + run.output_tokens * output_rate) / 1_000_000
    return {"model_calls": sum(run.model_calls for run in runs), "tool_calls": tool_calls,
            "input_tokens": sum(run.input_tokens for run in runs),
            "output_tokens": sum(run.output_tokens for run in runs),
            "estimated_cost_usd": round(cost, 6),
            "agent_ids": sorted({run.agent_id for run in runs if run.model_calls})}
