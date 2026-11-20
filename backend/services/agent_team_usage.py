"""Report coordinated usage once, without counting job rollups a second time."""
from __future__ import annotations

import asyncio
import json
import logging
import time
import sqlite3
from decimal import Decimal
from typing import Any

from backend.config.data_dir import resolve_data_dir
from backend.services import agent_execution_store as store
from backend.services.agent_execution_models import AgentRun, ExecutionScope


# Leave time for a follow-up request to acquire the five-second session lock.
CHAT_USAGE_TIMEOUT_SECONDS = 3


async def attach_team_usage(pending: Any, scope: ExecutionScope, run_id: str, started: float | None) -> list[Any]:
    messages = [message.model_copy(deep=True) for message in pending]
    try:
        accounting = asyncio.to_thread(record_team_usage, scope, run_id)
        timeout = CHAT_USAGE_TIMEOUT_SECONDS if started else None
        usage = await asyncio.wait_for(accounting, timeout=timeout)
    except PermissionError:
        raise
    except Exception:  # Optional accounting cannot invalidate an approved answer.
        logging.getLogger(__name__).exception("Could not record usage for the completed team reply")
        usage = {"usage_complete": False, "cost_source": "unknown", "estimated_cost_usd": None}
    for message in messages:
        message.additional_kwargs["gnosi_team_usage"] = usage
        if started:
            timings = message.additional_kwargs["gnosi_timings"]
            timings.update(total_ms=max(0, int((time.monotonic() - started) * 1000)), team_usage=usage)
            for key in ("model_calls", "tool_calls", "input_tokens", "output_tokens", "estimated_cost_usd"):
                if key in usage:
                    timings[key] = usage[key]
    return messages


def record_team_usage(scope: ExecutionScope, run_id: str) -> dict[str, Any]:
    from backend.services import agent_team_store
    from backend.services.agent_execution_trace import record
    usage = team_usage(scope, run_id)
    agent_team_store.put(scope, run_id, "usage", "usage", usage)
    record("team.usage", usage)
    return usage


def _calls(scope: ExecutionScope, identifiers: set[str]) -> dict[str, list[dict[str, Any]]]:
    """Read the existing provider ledger, including retries and reported billing."""
    if not identifiers:
        return {}
    path = resolve_data_dir(create=False) / "llm_usage.sqlite"
    if not path.exists():
        return {}
    with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        placeholders = ",".join("?" for _ in identifiers)
        rows = db.execute(f"""SELECT run_id,input_tokens,output_tokens,cost_usd,cost_source
            FROM usage_calls WHERE workspace_id=? AND user_id=? AND run_id IN ({placeholders})""",
            (scope.workspace_id, scope.user_id, *identifiers)).fetchall()
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        grouped.setdefault(row["run_id"], []).append(dict(row))
    return grouped


def _totals(runs: list[AgentRun], calls: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    selected = [run for run in runs if run.model_calls]
    entries = [entry for run in selected for entry in calls.get(run.run_id, [])]
    covered = all(len(calls.get(run.run_id, [])) >= run.model_calls for run in selected)
    tokens_complete = covered and all(row["input_tokens"] is not None and row["output_tokens"] is not None for row in entries)
    cost_complete = covered and all(row["cost_usd"] is not None and row["cost_source"] != "unknown" for row in entries)
    known_cost = sum((Decimal(row["cost_usd"]) for row in entries if row["cost_usd"] is not None), Decimal(0))
    sources = {row["cost_source"] for row in entries}
    source = "unknown" if not cost_complete else ("reported" if sources.issubset({"reported", "local"}) else "estimated")
    # Counters remain useful when a provider omits usage, but are labelled partial.
    return {"model_calls": sum(run.model_calls for run in selected), "provider_calls": len(entries),
            "input_tokens": sum(row["input_tokens"] for row in entries) if tokens_complete else sum(run.input_tokens for run in selected),
            "output_tokens": sum(row["output_tokens"] for row in entries) if tokens_complete else sum(run.output_tokens for run in selected),
            "usage_complete": tokens_complete, "cost_source": source,
            "estimated_cost_usd": float(known_cost) if cost_complete else None,
            "reported_cost_usd": float(known_cost) if cost_complete and source == "reported" else None,
            "known_cost_usd": float(known_cost)}


def team_usage(scope: ExecutionScope, run_id: str) -> dict[str, Any]:
    store.read(scope, run_id)  # Validate the root before inspecting its descendants.
    tree = """WITH RECURSIVE descendants(id) AS (
        SELECT run_id FROM agent_runs WHERE run_id=?
        UNION SELECT r.run_id FROM agent_runs r JOIN descendants d
        ON json_valid(r.payload) AND CAST(json_extract(r.payload,'$.parent_run_id') AS TEXT)=d.id)
    """
    with store.connect() as db:
        rows = db.execute(tree + """SELECT r.payload FROM descendants d CROSS JOIN agent_runs r ON r.run_id=d.id
            WHERE r.user_id=? AND r.workspace_id=? AND r.vault_path=?
            AND COALESCE(json_extract(r.request,'$.mode'),'')!='job'""",
            (run_id, scope.user_id, scope.workspace_id, scope.vault_path)).fetchall()
        tool_calls = db.execute(tree + """SELECT COUNT(*) FROM descendants d
            CROSS JOIN agent_runs r ON r.run_id=d.id CROSS JOIN agent_trace_events e ON e.run_id=d.id
            WHERE e.kind='tool.request' AND r.user_id=? AND r.workspace_id=? AND r.vault_path=?""",
            (run_id, scope.user_id, scope.workspace_id, scope.vault_path)).fetchone()[0]
    runs = [AgentRun.model_validate_json(row[0]) for row in rows]
    calls = _calls(scope, {run.run_id for run in runs if run.model_calls})
    phases: dict[str, list[AgentRun]] = {key: [] for key in ("planning", "execution", "synthesis", "repair")}
    for run in runs:
        phase = {"team.plan": "planning", "team.replan": "planning", "team.view_edit": "planning", "team.synthesis": "synthesis", "team.repair": "repair"}.get(run.operation, "execution")
        phases[phase].append(run)
    with store.connect() as db:
        row = db.execute("SELECT payload FROM agent_team_artifacts WHERE run_id=? AND id='routing'", (run_id,)).fetchone()
    return {**_totals(runs, calls), "tool_calls": tool_calls,
            "phases": {key: _totals(value, calls) for key, value in phases.items()},
            "routing": json.loads(row[0]) if row else {},
            "agent_ids": sorted({run.agent_id for run in runs if run.model_calls})}
