"""Explicit model diagnostics using the common transport and usage ledger."""
from __future__ import annotations
import time
import uuid
from typing import Any

from backend.services.agent_execution_models import AgentRun


def invoke_diagnostic(model_client: Any, messages: Any, *, provider: str, model: str, parent_run_id: str = "", agent_id: str = "diagnostic", metadata_only: bool = False) -> Any:
    from backend.domains.agent.policy import _invoke_agent_model
    from backend.services import agent_execution_store as store
    from backend.services.agent_execution import _run, _call_limit, _tokens
    from backend.services.agent_execution_scope import current_scope, revalidate_scope
    from backend.services.agent_cancellation import create_cancel_token, release
    from backend.services.agent_run_middleware import report_run

    scope = current_scope()
    revalidate_scope(scope)
    if scope.role not in {"owner", "admin"}:
        raise PermissionError("agent_diagnostic_requires_admin")
    run_id = uuid.uuid4().hex
    row = AgentRun(run_id=run_id, parent_run_id=parent_run_id, agent_id=agent_id, skill_id="", operation="diagnostic",
        origin="diagnostic", status="running", created_at=time.time(), updated_at=time.time(),
        provider=provider, model=model)
    store.create(row, scope, {"mode":"diagnostic"}, {"scope":scope.model_dump()})
    report_run(run_id)
    from backend.services.agent_execution_trace import metadata_only_trace
    trace_token = metadata_only_trace.set(metadata_only)
    token = _run.set(run_id)
    limit = _call_limit.set(1)
    cancel = create_cancel_token()
    _tokens[run_id] = cancel
    try:
        response = _invoke_agent_model(model_client, messages, {"cancel_token":cancel,"trace_id":run_id})
        store.update(scope, run_id, status="completed")
        return response
    except BaseException as error:
        store.update(scope, run_id, status="failed", error=type(error).__name__)
        raise
    finally:
        _tokens.pop(run_id, None)
        release(cancel)
        _call_limit.reset(limit)
        _run.reset(token)
        metadata_only_trace.reset(trace_token)
