"""Reuse validated, immutable reading phases within their authenticated scope."""
from __future__ import annotations

import hashlib
import json
from collections.abc import Callable

import jsonschema

from backend.services.agent_execution_models import AgentExecutionSnapshot, AgentOperation, AgentRun, ExecutionScope

CACHE_VERSION = 1


def result_key(request: AgentOperation, snapshot: AgentExecutionSnapshot) -> str:
    if request.operation != "knowledge.process-source.phase" or request.tool_mode != "none":
        return ""
    material = request.model_dump(exclude={"parent_run_id", "origin", "timeout_seconds", "resume_requires_parent"})
    material["options"].pop("reading_result_cache", None)
    frozen = snapshot.model_dump(exclude={"scope", "parent_run_id", "origin"})
    identity = [CACHE_VERSION, snapshot.scope.model_dump(), frozen, material]
    return hashlib.sha256(json.dumps(identity, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def lookup(request: AgentOperation, snapshot: AgentExecutionSnapshot, key: str,
           provider: str, model: str) -> AgentRun | None:
    """Read only completed phases; callers revalidate permissions and the output."""
    if not key or request.options.get("reading_result_cache", True) is not True:
        return None
    from backend.services import agent_execution_store as store
    scope = snapshot.scope
    with store.connect() as db:
        row = db.execute("""SELECT payload FROM agent_runs
            WHERE user_id=? AND workspace_id=? AND vault_path=? AND cancelled=0
            AND CASE WHEN json_valid(request) THEN json_extract(request,'$.reading_result_cache_key') END=?
            AND json_extract(CASE WHEN json_valid(payload) THEN payload ELSE '{}' END,'$.status')='completed'
            AND json_extract(CASE WHEN json_valid(payload) THEN payload ELSE '{}' END,'$.provider')=?
            AND json_extract(CASE WHEN json_valid(payload) THEN payload ELSE '{}' END,'$.model')=?
            ORDER BY rowid DESC LIMIT 1""", (scope.user_id, scope.workspace_id, scope.vault_path,
                                          key, provider, model)).fetchone()
    try:
        return AgentRun.model_validate_json(row[0]) if row else None
    except ValueError:
        return None


def reuse(request: AgentOperation, snapshot: AgentExecutionSnapshot, key: str, provider: str, model: str,
          row: AgentRun, validate: Callable[[str], str], revalidate: Callable[[ExecutionScope], None]) -> AgentRun | None:
    cached = lookup(request, snapshot, key, provider, model)
    if cached is None:
        return None
    try:
        restored = validate(cached.result)
    except (ValueError, jsonschema.ValidationError):
        return None
    revalidate(snapshot.scope)
    from backend.services import agent_execution_store as store
    from backend.services.agent_cancellation import AgentTurnCancelled
    if store.cancelled(snapshot.scope, row.run_id) or (row.parent_run_id and store.cancelled(snapshot.scope, row.parent_run_id)):
        raise AgentTurnCancelled("agent_run_cancelled")
    from backend.services.agent_execution_trace import record
    record("reading.result_cache.reused", {"source_run_id": cached.run_id})
    return store.update(snapshot.scope, row.run_id, status="completed", result=restored)
