"""Teams execute through the canonical executor, never through provider clients."""
from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import uuid
from contextvars import ContextVar
from dataclasses import replace
from pathlib import Path
from typing import Any, cast

from langchain_core.messages import AIMessage, HumanMessage, messages_to_dict
from langgraph.graph import END, START, StateGraph

from backend.services.agent_behavior import revision
from backend.services.agent_execution_models import AgentExecutionSnapshot, AgentOperation, ExecutionScope
from backend.services.agent_team_models import TEAM_SKILL, AgentTeam, TeamPlan, TeamTask, TemporaryAgentSpec
from backend.services.agent_team_policy import chat_operation, select_executor, team_for
from backend.services import agent_team_store as artifacts

delegating: ContextVar[bool] = ContextVar("agent_team_delegating", default=False)
READ_EFFECTS = {"read", "external_read", "personal_data"}


def _config() -> dict[str, Any]:
    from backend.config.app_config import load_params
    return dict(load_params(strict_env=False).ai)


def _profile(identifier: str) -> dict[str, Any]:
    profile = next((p for p in _config().get("agents", []) if p.get("id") == identifier), None)
    if not profile or not profile.get("enabled", True) or profile.get("plugin_suspended"):
        raise PermissionError("agent_team_profile_unavailable")
    return copy.deepcopy(profile)


def _runtime(profile: dict[str, Any], scope: ExecutionScope, skill_ids: list[str] | None = None) -> Any:
    from backend.services.agent_skill_catalog import resolve_agent_runtime
    return resolve_agent_runtime(profile, vault_path=Path(scope.vault_path), active_skill_ids=skill_ids)


def _filter_runtime(runtime: Any, *, read_only: bool) -> Any:
    if not read_only:
        return runtime
    pairs = [(tool, descriptor) for tool, descriptor in zip(runtime.tools, runtime.tool_descriptors)
             if {str(getattr(e, "value", e)) for e in descriptor.effects}.issubset(READ_EFFECTS)]
    return replace(runtime, tools=tuple(p[0] for p in pairs), tool_descriptors=tuple(p[1] for p in pairs))


def validate_temporary(spec: TemporaryAgentSpec, owner: dict[str, Any], scope: ExecutionScope) -> None:
    from backend.agent.model_router import load_registry
    from backend.services.agent_model_strategy import is_local_provider
    from backend.services.agent_skill_catalog import get_skill_catalog
    policy = team_for(owner).temporary
    if not team_for(owner).enabled or not policy.enabled:
        raise PermissionError("agent_team_temporary_disabled")
    if (spec.provider, spec.model) not in {(m.provider, m.model) for m in policy.models}:
        raise PermissionError("agent_team_model_not_allowed")
    if not any(r.get("enabled") is True and r.get("provider") == spec.provider and r.get("model_id") == spec.model for r in load_registry()):
        raise PermissionError("agent_team_model_unavailable")
    if not set(spec.skill_ids).issubset(policy.skill_ids) or TEAM_SKILL in spec.skill_ids:
        raise PermissionError("agent_team_skill_not_allowed")
    entries = {e.descriptor.id: e for e in get_skill_catalog().list_entries(Path(scope.vault_path))}
    if any(s not in entries or not entries[s].available for s in spec.skill_ids):
        raise PermissionError("agent_team_skill_unavailable")
    if is_local_provider(owner.get("provider")) and not is_local_provider(spec.provider):
        raise PermissionError("agent_team_local_boundary")


def execution_profile(snapshot: AgentExecutionSnapshot) -> dict[str, Any]:
    """Revalidate the originating grant as well as the child, including revocation."""
    from backend.services import agent_execution_store as runs
    metadata = snapshot.profile.get("_team_execution")
    if not metadata:
        return _profile(snapshot.agent_id)
    root_id, owner_id = metadata["root_id"], metadata["owner_id"]
    root = runs.read(snapshot.scope, root_id)
    if runs.cancelled(snapshot.scope, root_id) or root.status in {"cancelled", "failed", "interrupted", "completed", "resumed"}:
        raise PermissionError("agent_team_parent_unavailable")
    owner = _profile(owner_id)
    team = team_for(owner)
    if not team.enabled:
        raise PermissionError("agent_team_revoked")
    if metadata.get("temporary"):
        data = artifacts.get(snapshot.scope, root_id, snapshot.agent_id)
        spec = TemporaryAgentSpec.model_validate(data["spec"])
        validate_temporary(spec, owner, snapshot.scope)
        return cast(dict[str, Any], data["profile"])
    allowed = {team.director_id, *(m.agent_id for m in team.members)}
    if snapshot.agent_id not in allowed:
        raise PermissionError("agent_team_member_revoked")
    current = _profile(snapshot.agent_id)
    if any(snapshot.profile.get(field) is not None and current.get(field) != snapshot.profile.get(field) for field in ("provider", "model")):
        raise PermissionError("agent_team_executor_changed")
    return current


def _candidate(owner: dict[str, Any], scope: ExecutionScope, ids: list[str], skills: list[str], text: str, *, preferred: str = "", tools: bool = False) -> tuple[dict[str, Any] | None, str, float | None]:
    from backend.agent.model_router import load_registry
    from backend.domains.agent.llm import _provider_is_available
    from backend.agent.model_router import UsageStore, budget_status
    status = budget_status()
    if status.get("over_cap"):
        return None, "budget_exceeded", None
    usage = UsageStore().usage_for(status["period"]) if status.get("period") else {}
    ai = _config()
    registry = load_registry()
    models = {(r.get("provider"), r.get("model_id")): r for r in registry}
    def ready(profile: dict[str, Any], requested: list[str]) -> bool:
        runtime = _runtime(profile, scope, requested)
        model = models.get((profile.get("provider"), profile.get("model")), {})
        if tools and runtime.tools and "tools" not in (model.get("tags") or []) and model.get("supports_tools") is not True:
            return False
        return set(requested).issubset(runtime.active_skill_ids) and not runtime.missing_skill_ids and not runtime.unavailable_tool_ids
    # UTF-8 byte count is a conservative upper bound, including profile instructions.
    overhead = max((len(str(p.get("persona", "")).encode()) + len(str(p.get("context", "")).encode()) for p in ai.get("agents", []) if p.get("id") in ids), default=0)
    return select_executor(ai.get("agents", []), registry, allowed_ids=ids,
        skill_ids=skills, input_tokens=len(text.encode()) + overhead, source_provider=str(owner.get("provider") or ""),
        runtime_check=ready, preferred_id=preferred, require_tools=False, usage=usage,
        is_available=lambda provider: _provider_is_available(provider, ai.get("providers", {}).get(provider, {})))


def _snapshot(profile: dict[str, Any], owner: dict[str, Any], root_id: str, scope: ExecutionScope, skills: list[str], refs: list[dict[str, Any]], *, read_only: bool = False, temporary: bool = False) -> tuple[AgentExecutionSnapshot, Any]:
    from backend.services.agent_execution import snapshot_from_runtime
    profile = copy.deepcopy(profile)
    profile["team"] = {"enabled": False}
    # A source selection belongs to the original task; a specialist cannot widen it.
    profile["context_refs"] = copy.deepcopy(refs)
    profile["_team_execution"] = {"root_id": root_id, "owner_id": owner["id"], "read_only": read_only, "temporary": temporary}
    runtime = _filter_runtime(_runtime(profile, scope, skills), read_only=read_only)
    if not set(skills).issubset(runtime.active_skill_ids):
        raise PermissionError("agent_team_skill_unavailable")
    snapshot = snapshot_from_runtime(scope, profile, runtime).model_copy(update={"parent_run_id": root_id})
    return snapshot, runtime


async def _phase(owner: dict[str, Any], root_id: str, scope: ExecutionScope, text: str, schema: dict[str, Any] | None, operation: str) -> str:
    from backend.services.agent_execution import execute_operation
    identifier = "phase:" + operation
    previous = next((p for p in artifacts.list_artifacts(scope, "phase", root_id) if p["id"] == identifier), None)
    if previous:
        if previous["status"] == "completed":
            return str(previous["result"])
        raise RuntimeError("agent_team_phase_requires_review")
    phase = {"id": identifier, "status": "running", "result": ""}
    artifacts.put(scope, root_id, identifier, "phase", phase, create_only=True)
    director = _profile(team_for(owner).director_id)
    snapshot, _ = _snapshot(director, owner, root_id, scope, [TEAM_SKILL], [])
    token = delegating.set(True)
    try:
        result = await execute_operation(AgentOperation(skill_id=TEAM_SKILL, operation=operation, input=text,
            output_schema=schema, max_model_calls=1, parent_run_id=root_id, origin=snapshot.origin,
            resume_requires_parent=True), snapshot=snapshot)
        phase.update(status="completed", result=result.result)
        return result.result
    except BaseException:
        phase["status"] = "failed"
        raise
    finally:
        artifacts.put(scope, root_id, identifier, "phase", phase)
        delegating.reset(token)


def _temporary(spec: TemporaryAgentSpec, owner: dict[str, Any], root_id: str, scope: ExecutionScope) -> dict[str, Any]:
    validate_temporary(spec, owner, scope)
    current = artifacts.list_artifacts(scope, "temporary", root_id)
    fingerprint = revision(spec.model_dump())
    existing = next((p for p in current if p["fingerprint"] == fingerprint), None)
    if existing:
        return cast(dict[str, Any], existing["profile"])
    if len(current) >= 2:
        raise RuntimeError("agent_team_temporary_limit")
    identifier = "temporary_" + uuid.uuid4().hex
    profile = {"id": identifier, "name": spec.name, "provider": spec.provider, "model": spec.model,
        "persona": spec.instructions, "skill_ids": spec.skill_ids, "enabled": True, "context": "", "context_refs": [],
        "team": {"enabled": False}}
    artifacts.put(scope, root_id, identifier, "temporary", {"profile": profile, "spec": spec.model_dump(), "fingerprint": fingerprint}, create_only=True)
    return profile


def _propose(scope: ExecutionScope, root_id: str, profile: dict[str, Any], child_run_id: str) -> None:
    data = artifacts.get(scope, root_id, profile["id"])
    identifier = data["fingerprint"][:32]
    if any(p["id"] == identifier for p in artifacts.list_artifacts(scope, "proposal")):
        return
    spec = data["spec"]
    from backend.services.agent_team_retention import retention_details
    from backend.services.agent_execution_store import read
    evidence = read(scope, child_run_id)
    if evidence.parent_run_id != root_id or evidence.agent_id != profile["id"] or evidence.status != "completed":
        return
    details = retention_details(spec, _config().get("agents", []), evidence)
    if details["equivalent_agent_ids"]:
        return
    artifacts.put(scope, root_id, identifier, "proposal", {
        "id": identifier, "run_id": root_id, "status": "pending", "name": spec["name"],
        "instructions": spec["instructions"], "provider": spec["provider"], "model": spec["model"],
        "skill_ids": spec["skill_ids"], "acceptance": spec["acceptance"],
        "rationale": "agent_team.proposal_rationale",
        "evidence_run_ids": [child_run_id], "limitations": ["agent_team.proposal_limitation"],
        "permanent_agent_id": "", **details,
    }, create_only=True)


def _resume_cached_task(cached: dict[str, Any], scope: ExecutionScope, root_id: str, key: str) -> dict[str, Any]:
    execution_profile(AgentExecutionSnapshot.model_validate(cached["snapshot"]))
    if cached["status"] == "awaiting_confirmation":
        from backend.agent.action_confirmations import get_confirmation_status
        approvals = [get_confirmation_status(m["confirmation_id"], cached["confirmation_scope"]) for m in cached["confirmations"]]
        if all(a["status"] == "completed" for a in approvals):
            cached.update(status="completed", confirmations=[], result=json.dumps({"completed_actions": approvals}, ensure_ascii=False))
            artifacts.put(scope, root_id, key, "task", cached)
        elif any(a["status"] not in {"pending", "executing", "completed"} for a in approvals):
            raise RuntimeError("agent_team_confirmation_requires_review")
    if cached["status"] in {"completed", "awaiting_confirmation"}:
        return cached
    raise RuntimeError("agent_team_task_requires_review_before_retry")


def _validate_temporary_runtime(selected: dict[str, Any], text: str, runtime: Any, operation_mode: bool) -> None:
    from backend.agent.model_router import load_registry
    from backend.domains.agent.llm import _provider_is_available
    model = next((m for m in load_registry() if m.get("provider") == selected["provider"] and m.get("model_id") == selected["model"] and m.get("enabled") is True), {})
    if not _provider_is_available(selected["provider"], _config().get("providers", {}).get(selected["provider"], {})):
        raise RuntimeError("agent_team_model_unavailable")
    if len(text.encode()) + len(str(selected.get("persona", "")).encode()) + 1024 > int(model.get("context_window") or 0):
        raise RuntimeError("agent_team_temporary_context_insufficient")
    if runtime.unavailable_tool_ids or (not operation_mode and runtime.tools and "tools" not in (model.get("tags") or [])):
        raise RuntimeError("agent_team_temporary_tools_unavailable")


def _collect_task_event(event: dict[str, Any], outcome: dict[str, Any]) -> None:
    from backend.agent.action_confirmations import confirmation_event
    for update in event.values():
        for message in update.get("messages", []):
            marker = confirmation_event(getattr(message, "content", None))
            if marker:
                outcome["confirmations"].append(marker)
            if getattr(message, "type", "") == "ai" and not getattr(message, "tool_calls", None):
                outcome["result"] = str(message.content)


async def _execute_task(task: TeamTask, owner: dict[str, Any], root_id: str, scope: ExecutionScope, state: dict[str, Any], original: str, results: dict[str, Any], *, operation_mode: bool, refs: list[dict[str, Any]], allowed_ids: list[str] | None = None) -> dict[str, Any]:
    from backend.agent.factory import create_agent_workflow
    from backend.agent.action_confirmations import confirmation_context, current_confirmation_scope
    from backend.services.agent_execution import stream_workflow
    from backend.services.agent_execution_trace import record
    team = team_for(owner)
    ids = allowed_ids if allowed_ids is not None else [m.agent_id for m in team.members if m.agent_id != team.director_id]
    text = json.dumps({"original_request": original, "assignment": task.objective,
        "expected_result": task.expected_result, "acceptance": task.acceptance,
        "conversation_evidence": [str(m.content) for m in state.get("messages", []) if getattr(m, "type", "") in {"human", "ai"}],
        "completed_evidence": state.get("team_completed_evidence", []),
        "previous_results": {k: results[k]["result"] for k in task.depends_on}}, ensure_ascii=False)
    selected, reason, cost = _candidate(owner, scope, ids, task.skill_ids, text, preferred=task.agent_id, tools=not operation_mode)
    temporary = False
    if selected is None and task.temporary is not None:
        selected = _temporary(task.temporary, owner, root_id, scope)
        temporary, reason = True, "missing_specialty_temporary"
    if selected is None:
        raise RuntimeError("agent_team_no_eligible_executor")
    key = revision({"task": task.model_dump(), "original": original})
    cached = next((r for r in artifacts.list_artifacts(scope, "task", root_id) if r["key"] == key), None)
    if cached:
        return _resume_cached_task(cached, scope, root_id, key)
    if len(artifacts.list_artifacts(scope, "task", root_id)) >= 4:
        raise RuntimeError("agent_team_task_limit")
    snapshot, runtime = _snapshot(selected, owner, root_id, scope, task.skill_ids, refs, read_only=task.read_only or operation_mode, temporary=temporary)
    if temporary:
        _validate_temporary_runtime(selected, text, runtime, operation_mode)
    child_id = uuid.uuid4().hex
    outcome = {"key": key, "task_id": task.id, "run_id": child_id, "agent_id": selected["id"], "status": "running", "result": "", "confirmations": [], "snapshot": snapshot.model_dump()}
    artifacts.put(scope, root_id, key, "task", outcome, create_only=True)
    record("team.delegation", {"task": task.id, "executor": selected["id"], "reason": reason, "estimated_cost_usd": cost, "run_id": child_id})
    token = delegating.set(True)
    try:
        workflow, selection = await create_agent_workflow([], None, agent_id=selected["id"],
            user_message=original, prepared_ai_cfg=_config(), prepared_agent_data=snapshot.profile,
            runtime_capabilities=runtime, active_skill_ids=task.skill_ids, vault_path=Path(scope.vault_path),
            memory_user_id=scope.user_id, operation_mode=operation_mode)
        if workflow is None:
            raise RuntimeError("agent_team_executor_model_unavailable")
        child_state = {**state, "messages": [HumanMessage(content=text)], "trace_id": child_id,
            "active_skill_ids": task.skill_ids, "current_user_role": scope.role,
            "turn_authorized_tool_names": [] if task.read_only or operation_mode else list(state.get("turn_authorized_tool_names") or [])}
        try:
            parent_confirmation_scope = current_confirmation_scope()
        except RuntimeError:
            parent_confirmation_scope = {"vault_scope": hashlib.sha256(str(Path(scope.vault_path).resolve()).encode()).hexdigest()[:20],
                "workspace_id": scope.workspace_id, "user_id": scope.user_id, "role": scope.role,
                "agent_id": owner["id"], "session_id": root_id}
        confirmation_scope = {**parent_confirmation_scope, "profile_id": selected["id"], "team_run_id": root_id, "team_owner_id": owner["id"], "team_task_key": key}
        outcome["confirmation_scope"] = confirmation_scope
        with confirmation_context(**confirmation_scope):
            async for event in stream_workflow(workflow.compile(), child_state, config={"recursion_limit": 12},
                    origin=snapshot.origin, selection=selection, snapshot=snapshot, max_calls=8):
                _collect_task_event(event, outcome)
        if not outcome["result"].strip() and not outcome["confirmations"]:
            raise RuntimeError("agent_team_empty_result")
        outcome["status"] = "awaiting_confirmation" if outcome["confirmations"] else "completed"
        if temporary and outcome["status"] == "completed":
            _propose(scope, root_id, selected, child_id)
        return outcome
    except BaseException:
        outcome["status"] = "failed"
        raise
    finally:
        artifacts.put(scope, root_id, key, "task", outcome)
        delegating.reset(token)


async def coordinate(owner: dict[str, Any], state: dict[str, Any], *, operation_mode: bool, original: str) -> dict[str, Any]:
    from backend.services.agent_execution import _run, _snapshot
    from backend.services.agent_execution_scope import current_scope
    from backend.services.agent_operation_catalog import skill_id
    from backend.services.agent_execution_trace import record
    scope, root_id = current_scope(), _run.get()
    if not root_id:
        raise RuntimeError("agent_team_execution_required")
    live = _profile(owner["id"])
    if team_for(live) != team_for(owner):
        raise PermissionError("agent_team_configuration_changed")
    team = team_for(owner)
    request_data: dict[str, Any] = {}
    if operation_mode:
        request_data = json.loads(original)
    operation = str(request_data.get("operation") or "").split(".")[0] if operation_mode else chat_operation(original)
    route = next((r for r in team.direct_routes if r.operation == operation), None)
    required = [skill_id(operation)] if route else []
    direct, reason, cost = _candidate(owner, scope, route.agent_ids, required, original, tools=not operation_mode) if route else (None, "director_required", None)
    root_snapshot = _snapshot.get()
    refs = root_snapshot.profile.get("context_refs", []) if root_snapshot else []
    saved = artifacts.list_artifacts(scope, "plan", root_id)
    if saved:
        plan = TeamPlan.model_validate(saved[0]["plan"])
        state = {**state, "team_completed_evidence": saved[0].get("evidence", [])}
    elif direct:
        record("team.route", {"mode": "direct", "operation": operation, "executor": direct["id"], "reason": reason, "estimated_cost_usd": cost})
        plan = TeamPlan(tasks=[TeamTask(id="direct", agent_id=direct["id"], objective=original,
            skill_ids=required, read_only=operation_mode or bool(chat_operation(original)))], result_task="direct")
    else:
        record("team.route", {"mode": "director", "reason": reason})
        member_ids = {m.agent_id for m in team.members}
        members = [p for p in _config().get("agents", []) if p.get("id") in member_ids and p.get("enabled", True) and not p.get("plugin_suspended")]
        catalog = [{"id": p["id"], "name": p.get("name"), "skills": p.get("skill_ids", []), "provider": p.get("provider"), "model": p.get("model")} for p in members]
        plan_data = {"request": original, "members": catalog, "temporary_policy": team.temporary.model_dump(),
            "conversation_evidence": [str(m.content) for m in state.get("messages", []) if getattr(m, "type", "") in {"human", "ai"}]}
        raw = await _phase(owner, root_id, scope, json.dumps(plan_data, ensure_ascii=False), TeamPlan.model_json_schema(), "team.plan")
        plan = TeamPlan.model_validate_json(raw)
    if not saved:
        artifacts.put(scope, root_id, "plan", "plan", {"plan": plan.model_dump(), "original": original,
            "operation_mode": operation_mode, "state": {"turn_authorized_tool_names": state.get("turn_authorized_tool_names", []),
                "current_user_role": scope.role}, "messages": messages_to_dict(state.get("messages", []))}, create_only=True)
    results: dict[str, Any] = {}
    pending = list(plan.tasks)
    while pending:
        ready = [t for t in pending if set(t.depends_on).issubset(results)]
        task = ready[0]
        batch = [t for t in ready if t.read_only][:2] if task.read_only else [task]
        outcomes = await asyncio.gather(*[_execute_task(t, owner, root_id, scope, state, original, results, operation_mode=operation_mode, refs=refs, allowed_ids=route.agent_ids if direct and route else None) for t in batch], return_exceptions=True)
        failure = next((outcome for outcome in outcomes if isinstance(outcome, BaseException)), None)
        if failure is not None:
            # Never replan across a write or an uncertain action outcome.
            if not direct and all(t.read_only for t in plan.tasks) and not artifacts.list_artifacts(scope, "replan", root_id):
                remaining = 4 - len(artifacts.list_artifacts(scope, "task", root_id))
                if remaining > 0 and isinstance(failure, (RuntimeError, ValueError)):
                    artifacts.put(scope, root_id, "replan", "replan", {"used": True}, create_only=True)
                    evidence = [{"agent_id": item["agent_id"], "run_id": item["run_id"], "result": item["result"]} for item in artifacts.list_artifacts(scope, "task", root_id) if item["status"] == "completed"]
                    raw = await _phase(owner, root_id, scope, json.dumps({"request": original,
                        "previous_plan": plan.model_dump(), "completed_evidence": evidence,
                        "failure": str(failure), "remaining_assignments": remaining,
                        "instruction": "Return only new read-only assignments using fresh task IDs. Do not repeat completed evidence."}, ensure_ascii=False), TeamPlan.model_json_schema(), "team.replan")
                    revised = TeamPlan.model_validate_json(raw)
                    previous_ids = {t.id for t in plan.tasks}
                    if len(revised.tasks) > remaining or any(not t.read_only or t.id in previous_ids for t in revised.tasks):
                        raise RuntimeError("agent_team_invalid_replan")
                    saved_plan = artifacts.get(scope, root_id, "plan")
                    saved_plan["plan"] = revised.model_dump()
                    saved_plan["evidence"] = evidence
                    artifacts.put(scope, root_id, "plan", "plan", saved_plan)
                    return await coordinate(owner, state, operation_mode=operation_mode, original=original)
            raise failure
        completed = [outcome for outcome in outcomes if isinstance(outcome, dict)]
        for task, outcome in zip(batch, completed):
            results[task.id] = outcome
            pending.remove(task)
        confirmations = [marker for outcome in completed for marker in outcome["confirmations"]]
        if confirmations:
            from backend.services import agent_execution_store as runs
            runs.update(scope, root_id, status="awaiting_confirmation")
            return {"messages": [AIMessage(content=json.dumps(marker, ensure_ascii=False)) for marker in confirmations]}
    result = results[plan.result_task]["result"]
    if plan.synthesize:
        synthesis_evidence = {identifier: {key: value.get(key) for key in ("agent_id", "run_id", "status", "result")} for identifier, value in results.items()}
        result = await _phase(owner, root_id, scope, json.dumps({"request": original, "results": synthesis_evidence,
            "phase": "synthesize the completed evidence; do not plan or execute actions"}, ensure_ascii=False),
            request_data.get("output_schema"), "team.synthesis")
    return {"messages": [AIMessage(content=result)]}


async def repair_output(root_id: str, scope: ExecutionScope, text: str, error: str, request: AgentOperation) -> str:
    """Repair a deliverable with its executor, without repeating any graph actions."""
    from backend.services.agent_execution import execute_operation
    completed = [item for item in artifacts.list_artifacts(scope, "task", root_id) if item["status"] == "completed"]
    if not completed:
        raise RuntimeError("agent_team_no_result_to_repair")
    plan = artifacts.get(scope, root_id, "plan")["plan"]
    selected = next((item for item in completed if item.get("task_id") == plan["result_task"]), completed[-1])
    snapshot = AgentExecutionSnapshot.model_validate(selected["snapshot"])
    execution_profile(snapshot)
    token = delegating.set(True)
    try:
        result = await execute_operation(AgentOperation(skill_id=snapshot.skill_ids[0], operation="team.repair",
            input=text, data={"validation_error": error, "instruction": "Repair output format only; preserve the facts."},
            output_schema=request.output_schema, max_model_calls=1, origin=request.origin,
            parent_run_id=root_id, resume_requires_parent=True), snapshot=snapshot)
        return result.result
    finally:
        delegating.reset(token)


def build_team_workflow(profile: Any, *, operation_mode: bool, original: str) -> tuple[Any, dict[str, Any]] | None:
    if delegating.get() or not team_for(profile.agent_data).enabled:
        return None
    from backend.domains.agent.policy import AgentState
    from backend.services.agent_execution import snapshot_from_runtime
    from backend.services.agent_execution_scope import current_scope
    owner = copy.deepcopy(profile.agent_data)
    async def execute(state: AgentState) -> dict[str, Any]:
        return await coordinate(owner, dict(state), operation_mode=operation_mode, original=original)
    graph: StateGraph[Any, None, Any, Any] = StateGraph(AgentState)
    graph.add_node("team", execute)
    graph.add_edge(START, "team")
    graph.add_edge("team", END)
    setattr(graph, "_execution_snapshot", snapshot_from_runtime(current_scope(), owner, profile.resolved_runtime))
    from backend.domains.agent.runtime_tools import _runtime_tool_metadata
    metadata = {}
    for member in team_for(owner).members:
        try:
            member_profile = _profile(member.agent_id)
        except PermissionError:
            continue
        runtime = _runtime(member_profile, current_scope())
        entries, _ = _runtime_tool_metadata(runtime)
        for item in entries:
            metadata[item["name"]] = {k: v for k, v in item.items() if not k.startswith("_")}
    return graph, {"provider": "", "model": "", "mode": "team", "supports_tools": True,
        "active_skill_ids": list(profile.resolved_runtime.active_skill_ids), "tools": list(metadata.values()),
        "context_refs": owner.get("context_refs", []), "team_owner_id": owner["id"]}
