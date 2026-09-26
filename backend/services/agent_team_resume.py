"""Resume a frozen team plan without regenerating or replaying completed work."""
from __future__ import annotations

import asyncio
from typing import Any
from langchain_core.messages import messages_from_dict

from backend.services import agent_execution as execution, agent_execution_store as runs
from backend.services import agent_team_store as artifacts
from backend.services.agent_execution_models import AgentExecutionSnapshot, AgentRun
from backend.services.agent_team_runtime import coordinate


async def resume_team(run_id: str, request: dict[str, Any], snapshot: AgentExecutionSnapshot) -> AgentRun:
    scope = snapshot.scope
    from backend.services.agent_cancellation import create_cancel_token, release
    cancel_token = create_cancel_token()
    execution._tokens[run_id] = cancel_token
    token = execution._run.set(run_id)
    limit = execution._call_limit.set(int(request.get("max_calls") or 8))
    snap = execution._snapshot.set(snapshot)
    try:
        saved = artifacts.get(scope, run_id, "plan")
        saved["state"]["messages"] = messages_from_dict(saved.get("messages", []))
        saved["state"]["cancel_token"] = cancel_token
        runs.update(scope, run_id, status="running", error="")
        async with asyncio.timeout(120):
            result = await coordinate(snapshot.profile, saved["state"], operation_mode=saved["operation_mode"], original=saved["original"])
        text = str(result["messages"][-1].content)
        pending = runs.read(scope, run_id).status == "awaiting_confirmation"
        if not pending:
            text = execution._validate_output(text, request.get("output_schema"))
        return runs.update(scope, run_id, status="awaiting_confirmation" if pending else "completed", result=text)
    except BaseException as error:
        runs.update(scope, run_id, status="failed", error=str(error)[:512])
        raise
    finally:
        execution._tokens.pop(run_id, None)
        release(cancel_token)
        execution._snapshot.reset(snap)
        execution._call_limit.reset(limit)
        execution._run.reset(token)
