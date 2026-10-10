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

from backend.services.agent_behavior import resource, revision
from backend.services.agent_behavior_bindings import canonical_id, runtime_skill_ids
from backend.services.agent_execution_models import AgentExecutionSnapshot, AgentOperation, ExecutionScope
from backend.services.agent_team_models import TEAM_SKILL, AgentTeam, TeamPlan, TeamTask, TemporaryAgentSpec
from backend.services.agent_team_policy import select_executor, team_for
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
    if any(canonical_id(identifier, entries) == TEAM_SKILL for identifier in spec.skill_ids):
        raise PermissionError("agent_team_skill_not_allowed")
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
    allowed = {owner["id"], team.director_id, *(m.agent_id for m in team.members)}
    if snapshot.agent_id not in allowed:
        raise PermissionError("agent_team_member_revoked")
    current = _profile(snapshot.agent_id)
    if any(snapshot.profile.get(field) is not None and current.get(field) != snapshot.profile.get(field) for field in ("provider", "model")):
        raise PermissionError("agent_team_executor_changed")
    return current


def _candidate(owner: dict[str, Any], scope: ExecutionScope, ids: list[str], skills: list[str], text: str, *, preferred: str = "", tools: bool = False, allow_owner: bool = False) -> tuple[dict[str, Any] | None, str, float | None]:
    ids = [identifier for identifier in ids if allow_owner or identifier != owner["id"]]
    from backend.agent.model_router import load_registry
    from backend.domains.agent.llm import _provider_is_available
    from backend.agent.model_router import UsageStore, budget_status
    status = budget_status()
    if status.get("over_cap") and (status.get("budget") or {}).get("enforce_block"):
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
        return runtime_skill_ids(runtime, requested).issubset(runtime.active_skill_ids) and not runtime.missing_skill_ids and not runtime.unavailable_tool_ids
    # UTF-8 byte count is a conservative upper bound, including profile instructions.
    overhead = max((len(str(p.get("persona", "")).encode()) + len(str(p.get("context", "")).encode()) for p in ai.get("agents", []) if p.get("id") in ids), default=0)
    return select_executor(ai.get("agents", []), registry, allowed_ids=ids,
        skill_ids=skills, input_tokens=len(text.encode()) + overhead, source_provider=str(owner.get("provider") or ""),
        runtime_check=ready, preferred_id=preferred, require_tools=False, usage=usage,
        is_available=lambda provider: _provider_is_available(provider, ai.get("providers", {}).get(provider, {})))


def _snapshot(profile: dict[str, Any], owner: dict[str, Any], root_id: str, scope: ExecutionScope, skills: list[str], refs: list[dict[str, Any]], *, read_only: bool = False, temporary: bool = False, extra_instructions: tuple[str, ...] = ()) -> tuple[AgentExecutionSnapshot, Any]:
    from backend.services.agent_execution import snapshot_from_runtime
    profile = copy.deepcopy(profile)
    profile["team"] = {"enabled": False}
    # A source selection belongs to the original task; a specialist cannot widen it.
    profile["context_refs"] = copy.deepcopy(refs)
    profile["_team_execution"] = {"root_id": root_id, "owner_id": owner["id"], "read_only": read_only, "temporary": temporary}
    runtime = _filter_runtime(_runtime(profile, scope, skills), read_only=read_only)
    if not runtime_skill_ids(runtime, skills).issubset(runtime.active_skill_ids):
        raise PermissionError("agent_team_skill_unavailable")
    runtime = replace(runtime, instructions=(*runtime.instructions, *extra_instructions))
    snapshot = snapshot_from_runtime(scope, profile, runtime).model_copy(update={"parent_run_id": root_id})
    return snapshot, runtime


def _validate_plan_result(text: str, *, allow_response: bool = False, members: list[dict[str, Any]] | None = None, owner_id: str = "", required_operation: str = "", output_keys: set[str] | None = None) -> str:
    from backend.services.agent_team_contracts import standalone_clarification
    raw = json.loads(text)
    normalized = standalone_clarification(raw) if allow_response and isinstance(raw, dict) else raw
    if normalized != raw:
        text = json.dumps(normalized, ensure_ascii=False)
    plan = TeamPlan.model_validate_json(text)
    if plan.response and not allow_response:
        raise ValueError("agent_team_operation_requires_tasks")
    if members is not None:
        from backend.services.agent_team_routing import validate_assignments
        from backend.services.agent_team_contracts import validate_plan_contract
        validate_assignments(plan, members, owner_id)
        validate_plan_contract(plan, members, owner_id, legacy_response="response_kind" not in json.loads(text), required_operation=required_operation, output_keys=output_keys)
    return text


async def _phase(owner: dict[str, Any], root_id: str, scope: ExecutionScope, text: str, schema: dict[str, Any] | None, operation: str, *, allow_response: bool = False, members: list[dict[str, Any]] | None = None) -> str:
    from backend.services.agent_execution import execute_operation, _operation_timeout
    if members is None and operation in {"team.plan", "team.replan"}:
        members = json.loads(text or "{}").get("members")
    required_operation = str(json.loads(text or "{}").get("required_operation") or "") if operation in {"team.plan", "team.replan"} else ""
    from backend.services.agent_team_contracts import explicit_output_keys
    output_keys = explicit_output_keys(str(json.loads(text or "{}").get("request") or "")) if allow_response and required_operation not in {"writing", "translation"} else set()
    def validate(text: str) -> str:
        return _validate_plan_result(text, allow_response=allow_response, members=members, owner_id=owner["id"], required_operation=required_operation, output_keys=output_keys)
    plan_validator = validate if operation in {"team.plan", "team.replan"} else None
    if plan_validator and schema is not None and members is not None:
        schema = copy.deepcopy(schema)
        if output_keys:
            contract = schema["$defs"]["TeamOutputContract"]
            contract["required"] = ["type", "fields", "allow_extra_keys"]
            contract["properties"]["type"] = {"const": "object"}
            contract["properties"]["fields"]["minItems"] = len(output_keys)
        if allow_response:
            from backend.services.agent_team_contracts import operation_skills, initial_greeting
            schema["required"] = list(schema["properties"])
            schema["properties"]["operation"]["enum"] = ["", *sorted(set(operation_skills(members).values()))]
            if initial_greeting(json.loads(text or "{}")):
                dialogue_fields: dict[str, Any] = {"operation":"", "response_kind":"greeting", "output_contract":None,
                                                   "tasks":[], "result_task":"", "synthesize":False}
                for key, value in dialogue_fields.items():
                    schema["properties"][key] = {"const": value}
                schema["properties"]["response"]["minLength"] = 1
        identifiers = [member["id"] for member in members if member["available"]]
        if team_for(owner).temporary.enabled:
            identifiers.append("")
        schema["$defs"]["TeamTask"]["properties"]["agent_id"]["enum"] = identifiers or [""]
    identifier = "phase:" + operation
    previous = next((p for p in artifacts.list_artifacts(scope, "phase", root_id) if p["id"] == identifier), None)
    if previous:
        if previous["status"] == "completed":
            cached = str(previous["result"])
            return plan_validator(cached) if plan_validator else cached
        raise RuntimeError("agent_team_phase_requires_review")
    phase = {"id": identifier, "status": "running", "result": ""}
    artifacts.put(scope, root_id, identifier, "phase", phase, create_only=True)
    director = _profile(team_for(owner).director_id)
    routing = (resource("system/team-routing.md"),) if allow_response else ()
    snapshot, _ = _snapshot(director, owner, root_id, scope, [TEAM_SKILL], [], extra_instructions=routing)
    token = delegating.set(True)
    try:
        result = await execute_operation(AgentOperation(skill_id=TEAM_SKILL, operation=operation, input=text,
            output_schema=schema, max_model_calls=2 if plan_validator or (operation == "team.synthesis" and schema is not None) else 1, parent_run_id=root_id, origin=snapshot.origin,
            timeout_seconds=_operation_timeout.get(), resume_requires_parent=True), snapshot=snapshot, output_validator=plan_validator)
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
                outcome["result"] = str(message.text)
                outcome["metadata"] = dict(getattr(message, "additional_kwargs", {}) or {})


async def _execute_task(task: TeamTask, owner: dict[str, Any], root_id: str, scope: ExecutionScope, state: dict[str, Any], original: str, results: dict[str, Any], *, operation_mode: bool, refs: list[dict[str, Any]], allowed_ids: list[str] | None = None, output_schema: dict[str, Any] | None = None) -> dict[str, Any]:
    from backend.agent.factory import create_agent_workflow
    from backend.agent.action_confirmations import confirmation_context, current_confirmation_scope
    from backend.services.agent_execution import stream_workflow
    from backend.services.agent_execution_trace import record
    team = team_for(owner)
    ids = allowed_ids if allowed_ids is not None else [m.agent_id for m in team.members if m.agent_id != team.director_id]
    own_task = (not operation_mode and allowed_ids is None and task.agent_id == owner["id"]
                and owner["id"] == _config().get("active_agent_id"))
    if own_task:
        ids = [*ids, owner["id"]]
    original_data = json.loads(original) if operation_mode else {"input": original}
    text = json.dumps({"original_request": original, "assignment": task.objective,
        **({"original_input": original_data.get("input", original), "original_data": original_data.get("data", {})} if operation_mode else {}),
        "expected_result": task.expected_result, "acceptance": task.acceptance,
        **({"output_schema": output_schema} if output_schema is not None else {}),
        "conversation_evidence": [str(m.content) for m in state.get("messages", []) if getattr(m, "type", "") in {"human", "ai"}],
        "completed_evidence": state.get("team_completed_evidence", []),
        "previous_results": {k: results[k]["result"] for k in task.depends_on}}, ensure_ascii=False)
    selected, reason, cost = _candidate(owner, scope, ids, task.skill_ids, text, preferred=task.agent_id,
                                      tools=not operation_mode, allow_owner=own_task)
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
            runtime_capabilities=runtime, active_skill_ids=list(runtime.active_skill_ids), vault_path=Path(scope.vault_path),
            memory_user_id=scope.user_id, operation_mode=operation_mode)
        if workflow is None:
            raise RuntimeError("agent_team_executor_model_unavailable")
        from backend.services.agent_team_routing import assignment_messages
        child_messages = [HumanMessage(content=text)] if operation_mode else assignment_messages({**state, "team_task_output_schema": output_schema}, task, original, results)
        child_state = {**state, "messages": child_messages, "trace_id": child_id,
            "active_skill_ids": list(runtime.active_skill_ids), "current_user_role": scope.role,
            "turn_authorized_tool_names": [] if task.read_only or operation_mode else list(state.get("turn_authorized_tool_names") or [])}
        try:
            parent_confirmation_scope = current_confirmation_scope()
        except RuntimeError:
            parent_confirmation_scope = {"vault_scope": hashlib.sha256(str(Path(scope.vault_path).resolve()).encode()).hexdigest()[:20],
                "workspace_id": scope.workspace_id, "user_id": scope.user_id, "role": scope.role,
                "agent_id": owner["id"], "session_id": root_id}
        confirmation_scope = {**parent_confirmation_scope, "profile_id": selected["id"], "team_run_id": root_id, "team_owner_id": owner["id"], "team_task_key": key}
        outcome["confirmation_scope"] = confirmation_scope
        application: Any = workflow.compile()
        if output_schema is not None:
            from backend.services.agent_team_output import CheckedTeamOutput
            application = CheckedTeamOutput(application, output_schema, snapshot, root_id, text)
        with confirmation_context(**confirmation_scope):
            async for event in stream_workflow(application, child_state, config={"recursion_limit": 12},
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
    from backend.services.agent_team_planning import prepare_plan
    from backend.services.agent_execution_trace import record
    scope, root_id = current_scope(), _run.get()
    if not root_id:
        raise RuntimeError("agent_team_execution_required")
    live = _profile(owner["id"])
    if team_for(live) != team_for(owner):
        raise PermissionError("agent_team_configuration_changed")
    team = team_for(owner)
    request_data: dict[str, Any] = json.loads(original) if operation_mode else {}
    from backend.services.agent_team_contracts import output_schema as plan_output_schema, required_operation
    from backend.services.agent_team_output import TeamOutputContractError
    root_snapshot = _snapshot.get()
    refs = root_snapshot.profile.get("context_refs", []) if root_snapshot else []
    saved = artifacts.list_artifacts(scope, "plan", root_id)
    plan, state, catalog, route, direct = await prepare_plan(owner, scope, root_id, state, original, refs, operation_mode=operation_mode)
    required = required_operation(str(request_data.get("operation") or ""), root_snapshot.skill_ids if root_snapshot else []) if operation_mode else ""
    _validate_plan_result(plan.model_dump_json(), allow_response=not operation_mode, members=catalog, owner_id=owner["id"], required_operation=required)
    result_schema = request_data.get("output_schema") if operation_mode else plan_output_schema(plan)
    if not saved:
        artifacts.put(scope, root_id, "plan", "plan", {"plan": plan.model_dump(), "original": original,
            "operation_mode": operation_mode, "state": {"turn_authorized_tool_names": state.get("turn_authorized_tool_names", []),
                "current_user_role": scope.role}, "messages": messages_to_dict(state.get("messages", []))}, create_only=True)
    if plan.response:
        record("team.response", {"executor": team.director_id, "mode": "direct_response"})
        return {"messages": [AIMessage(content=plan.response)]}
    results: dict[str, Any] = {}
    pending = list(plan.tasks)
    while pending:
        ready = [t for t in pending if set(t.depends_on).issubset(results)]
        task = ready[0]
        batch = [t for t in ready if t.read_only][:2] if task.read_only else [task]
        outcomes = await asyncio.gather(*[_execute_task(t, owner, root_id, scope, state, original, results, operation_mode=operation_mode, refs=refs, allowed_ids=route.agent_ids if direct and route else None,
            output_schema=result_schema if t.id == plan.result_task and not plan.synthesize else None) for t in batch], return_exceptions=True)
        failure = next((outcome for outcome in outcomes if isinstance(outcome, BaseException)), None)
        if failure is not None:
            # Never replan across a write or an uncertain action outcome.
            if not direct and not isinstance(failure, TeamOutputContractError) and all(t.read_only for t in plan.tasks) and not artifacts.list_artifacts(scope, "replan", root_id):
                remaining = 4 - len(artifacts.list_artifacts(scope, "task", root_id))
                if remaining > 0 and isinstance(failure, (RuntimeError, ValueError)):
                    artifacts.put(scope, root_id, "replan", "replan", {"used": True}, create_only=True)
                    evidence = [{"agent_id": item["agent_id"], "run_id": item["run_id"], "result": item["result"]} for item in artifacts.list_artifacts(scope, "task", root_id) if item["status"] == "completed"]
                    from backend.services.agent_team_context import planning_input, excerpt
                    replan_input, _ = planning_input(owner, state, original, catalog, refs, operation_mode=operation_mode)
                    raw = await _phase(owner, root_id, scope, json.dumps({**replan_input,
                        "previous_plan": plan.model_dump(),
                        "completed_evidence": [{**item, "result": excerpt(item["result"], 1200)} for item in evidence],
                        "failure": excerpt(str(failure), 800), "remaining_assignments": remaining,
                        "instruction": "Return only new read-only assignments using fresh task IDs. Do not repeat completed evidence."}, ensure_ascii=False, separators=(",", ":")), TeamPlan.model_json_schema(), "team.replan", members=catalog)
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
            result_schema, "team.synthesis")
    metadata = {} if plan.synthesize else dict(results[plan.result_task].get("metadata", {}))
    metadata.pop("gnosi_team_route", None)
    if not operation_mode:
        from backend.services.agent_team_continuation import remember_specialist
        marker = remember_specialist(owner, scope, root_id, state, plan, catalog, refs, result)
        if marker:
            metadata["gnosi_team_route"] = marker
    return {"messages": [AIMessage(content=result, additional_kwargs=metadata)]}


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
            input=text, data={"original_input": request.input, "original_data": request.data,
                "validation_error": error, "instruction": "Repair the output contract using the original evidence; preserve supported facts."},
            output_schema=request.output_schema, max_model_calls=1, origin=request.origin,
            timeout_seconds=request.timeout_seconds, parent_run_id=root_id, resume_requires_parent=True), snapshot=snapshot)
        return result.result
    finally:
        delegating.reset(token)


def build_team_workflow(profile: Any, *, operation_mode: bool, original: str) -> tuple[Any, dict[str, Any]] | None:
    if delegating.get() or profile.agent_data.get("_team_execution") or not team_for(profile.agent_data).enabled:
        return None
    from backend.domains.agent.policy import AgentState
    from backend.services.agent_execution import snapshot_from_runtime
    from backend.services.agent_execution_scope import current_scope
    owner = copy.deepcopy(profile.agent_data)
    async def execute(state: AgentState) -> dict[str, Any]:
        current = state.get("user_request") or next((str(m.content) for m in reversed(state["messages"]) if m.type == "human"), original)
        result = await coordinate(owner, dict(state), operation_mode=operation_mode, original=current)
        from backend.services.agent_execution import _run
        from backend.services.agent_team_usage import team_usage
        from backend.services.agent_execution_trace import record
        usage = team_usage(current_scope(), _run.get())
        artifacts.put(current_scope(), _run.get(), "usage", "usage", usage)
        record("team.usage", usage)
        for message in result["messages"]:
            message.additional_kwargs["gnosi_team_usage"] = usage
        return result
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
    return graph, {"provider": owner.get("provider", ""), "model": owner.get("model", ""), "mode": "team", "supports_tools": True,
        "tool_count": len(metadata),
        "active_skill_ids": list(profile.resolved_runtime.active_skill_ids), "tools": list(metadata.values()),
        "context_refs": owner.get("context_refs", []), "team_owner_id": owner["id"]}
