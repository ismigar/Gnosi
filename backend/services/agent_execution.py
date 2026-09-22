"""One principal-agent executor for application operations and graph streams."""
from __future__ import annotations

import asyncio
import hashlib
import json
import time
import uuid

import jsonschema  # type: ignore[import-untyped]
from collections.abc import AsyncIterator, Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import replace
from pathlib import Path
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage

from backend.services import agent_execution_store as store
from backend.services.agent_run_middleware import report_run
from backend.services.agent_execution_models import AgentExecutionSnapshot, AgentOperation, AgentRun
from backend.services.agent_execution_scope import current_scope, execution_scope, revalidate_scope
from backend.services.agent_operation_catalog import skill_id

_snapshot: ContextVar[AgentExecutionSnapshot | None] = ContextVar("agent_execution_snapshot", default=None)
_tokens: dict[str, str] = {}
_call_limit: ContextVar[int] = ContextVar("agent_execution_call_limit", default=2)
_run: ContextVar[str] = ContextVar("agent_execution_run", default="")


def prepare_snapshot(selected_skill: str, *, active_skill_ids: list[str] | None = None) -> AgentExecutionSnapshot:
    from backend.services.agent_skill_catalog import resolve_agent_runtime
    from backend.services.principal_agent_migration import ensure_migrated, principal_profile

    inherited = _snapshot.get()
    if inherited is not None and selected_skill:
        return select_snapshot_skill(inherited, selected_skill)
    scope = current_scope()
    ai = ensure_migrated()
    profile = principal_profile(ai)
    runtime = resolve_agent_runtime(profile, vault_path=Path(scope.vault_path), active_skill_ids=active_skill_ids if active_skill_ids is not None else ([selected_skill] if selected_skill else None))
    if selected_skill and selected_skill not in runtime.active_skill_ids:
        raise RuntimeError(f"agent_skill_unavailable:{selected_skill}")
    return snapshot_from_runtime(scope, profile, runtime)


def snapshot_from_runtime(scope: Any, profile: dict[str, Any], runtime: Any) -> AgentExecutionSnapshot:
    """Freeze the actual graph inputs rather than re-reading settings at stream time."""
    import copy
    profile = copy.deepcopy(profile)
    if "_execution_detailed_persona" not in profile:
        from backend.domains.agent.workflow import INSTRUCTIONS_DIR
        from backend.domains.agent.workflow_setup import _detailed_persona
        profile["_execution_detailed_persona"] = _detailed_persona(INSTRUCTIONS_DIR, str(profile["id"]))
    instructions = list(getattr(runtime, "instructions", ()))
    skills = list(getattr(runtime, "active_skill_ids", ()))
    entries = [entry for entry in getattr(runtime, "skills", []) if entry.available]
    skill_instructions = {entry.descriptor.id: entry.descriptor.instructions for entry in entries}
    companions = {entry.descriptor.id: entry.descriptor.metadata.get("companion_for", []) for entry in entries}
    payload = {"profile": profile, "instructions": instructions, "skills": skills, "assigned_instructions": skill_instructions}
    revision = hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()
    return AgentExecutionSnapshot(scope=scope, agent_id=str(profile["id"]), profile=profile,
        skill_ids=skills, instructions=instructions, catalog_revision=str(getattr(runtime, "catalog_revision", "")), revision=revision,
        skill_versions={entry.descriptor.id: entry.descriptor.version for entry in entries},
        skill_instructions=skill_instructions, skill_companions=companions)


def select_snapshot_skill(snapshot: AgentExecutionSnapshot, selected: str) -> AgentExecutionSnapshot:
    """Nested actions may use assigned skills, frozen when the parent started."""
    if selected in snapshot.skill_ids:
        return snapshot
    if selected not in snapshot.skill_instructions:
        raise PermissionError("agent_execution_scope_or_skill_mismatch")
    skills = [selected, *(identifier for identifier, targets in snapshot.skill_companions.items() if selected in targets)]
    return snapshot.model_copy(update={
        "skill_ids": skills,
        "instructions": [snapshot.skill_instructions[identifier] for identifier in skills],
        "revision": hashlib.sha256((snapshot.revision + json.dumps(skills)).encode()).hexdigest(),
        "parent_run_id": _run.get() or snapshot.parent_run_id,
    })


@contextmanager
def operation_session(snapshot: AgentExecutionSnapshot) -> Iterator[None]:
    token = _snapshot.set(snapshot)
    parent_token = _run.set(snapshot.parent_run_id) if snapshot.parent_run_id else None
    with execution_scope(snapshot.scope):
        try:
            yield
        finally:
            _snapshot.reset(token)
            if parent_token is not None:
                _run.reset(parent_token)


def before_model_call() -> None:
    run_id = _run.get()
    if not run_id:
        return
    scope = current_scope()
    revalidate_scope(scope)
    if store.cancelled(scope, run_id):
        from backend.services.agent_cancellation import AgentTurnCancelled
        raise AgentTurnCancelled("agent_run_cancelled")
    from backend.agent.model_router import budget_status
    if budget_status().get("over_cap"):
        raise RuntimeError("agent_budget_exceeded")
    row = store.read(scope, run_id)
    if row.parent_run_id and store.cancelled(scope, row.parent_run_id):
        from backend.services.agent_cancellation import AgentTurnCancelled
        raise AgentTurnCancelled("agent_run_cancelled")
    store.reserve_model_call(scope, run_id, _call_limit.get())


def before_tool_call(tool_name: str, *, dynamic_context: bool = False) -> None:
    """Recheck live permission and assignments before every governed action."""
    if not _run.get():
        return
    scope = current_scope()
    revalidate_scope(scope)
    if store.cancelled(scope, _run.get()):
        from backend.services.agent_cancellation import AgentTurnCancelled
        raise AgentTurnCancelled("agent_run_cancelled")
    snapshot = _snapshot.get()
    if snapshot is not None:
        from backend.config.app_config import load_params
        from backend.services.agent_skill_catalog import resolve_agent_runtime
        profiles = load_params(strict_env=False).ai.get("agents", [])
        current = next((item for item in profiles if item.get("id") == snapshot.agent_id), None)
        if not current or not current.get("enabled", True):
            raise PermissionError("agent_execution_profile_revoked")
        runtime = resolve_agent_runtime(current, vault_path=Path(scope.vault_path), active_skill_ids=snapshot.skill_ids)
        if not dynamic_context and tool_name not in {descriptor.name for descriptor in runtime.tool_descriptors}:
            raise PermissionError("agent_execution_tool_revoked")


def after_model_call(message: Any) -> None:
    run_id = _run.get()
    if not run_id:
        return
    from backend.agent.model_router import record_llm_usage, usage_from_message
    row = store.read(current_scope(), run_id)
    usage = usage_from_message(message)
    fallback = getattr(message, "additional_kwargs", {}).get("gnosi_provider_fallback", {})
    if fallback:
        row = store.update(current_scope(), run_id, provider=str(fallback.get("to") or row.provider), model=str(fallback.get("model") or row.model))
    if usage:
        record_llm_usage(row.provider, row.model, usage[0], usage[1])
        store.update(current_scope(), run_id,
                     input_tokens=row.input_tokens + usage[0], output_tokens=row.output_tokens + usage[1], usage_available=True)


async def stream_workflow(application: Any, inputs: Any, *, config: Any, stream_mode: str = "updates", origin: str = "", selection: dict[str, Any] | None = None, max_calls: int = 32, snapshot: AgentExecutionSnapshot | None = None) -> AsyncIterator[Any]:
    """Common execution boundary for conversations, automations and text phases."""
    if not origin:
        async for event in application.astream(inputs, config=config, stream_mode=stream_mode):
            yield event
        return
    scope = current_scope()
    revalidate_scope(scope)
    snapshot = snapshot or prepare_snapshot("", active_skill_ids=inputs.get("active_skill_ids"))
    if snapshot.scope != scope:
        raise PermissionError("agent_execution_scope_changed")
    run_id = str(inputs.get("trace_id") or uuid.uuid4().hex)
    selection = selection or {}
    row = AgentRun(run_id=run_id, agent_id=snapshot.agent_id,
        skill_id=",".join(snapshot.skill_ids), operation="conversation", origin=origin,
        status="running", created_at=time.time(), updated_at=time.time(),
        provider=str(selection.get("provider") or ""), model=str(selection.get("model") or ""),
        execution_revision=snapshot.revision)
    store.create(row, scope, {"mode": "conversation", "max_calls": max_calls}, snapshot.model_dump())
    report_run(run_id)
    token = _run.set(run_id)
    snapshot_token = _snapshot.set(snapshot)
    limit = _call_limit.set(max_calls)
    if inputs.get("cancel_token"):
        _tokens[run_id] = inputs["cancel_token"]
    result = ""
    try:
        async for event in application.astream(inputs, config=config, stream_mode=stream_mode):
            for update in event.values():
                for message in update.get("messages", []):
                    if getattr(message, "type", "") == "ai" and not getattr(message, "tool_calls", None):
                        result = str(message.content)
            yield event
        store.update(scope, run_id, status="completed", result=result)
    except BaseException as error:
        from backend.services.agent_cancellation import AgentTurnCancelled
        status = "cancelled" if isinstance(error, (AgentTurnCancelled, asyncio.CancelledError)) else "failed"
        store.update(scope, run_id, status=status, error=type(error).__name__ + ": " + str(error)[:512])
        raise
    finally:
        _tokens.pop(run_id, None)
        _call_limit.reset(limit)
        _snapshot.reset(snapshot_token)
        _run.reset(token)


def _validate_output(text: str, schema: dict[str, Any] | None) -> str:
    if not text.strip():
        raise ValueError("agent_empty_result")
    if schema is None:
        return text
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.partition("\n")[2].rsplit("```", 1)[0].strip()
    value = json.loads(cleaned)
    jsonschema.validate(value, schema)
    return json.dumps(value, ensure_ascii=False)


def _operation_context(request: AgentOperation, snapshot: AgentExecutionSnapshot | None) -> tuple[AgentExecutionSnapshot, dict[str, Any], Any]:
    from backend.config.app_config import load_params
    from backend.services.agent_skill_catalog import resolve_agent_runtime
    revalidate_scope(current_scope())
    snapshot = snapshot or _snapshot.get() or prepare_snapshot(request.skill_id)
    snapshot = select_snapshot_skill(snapshot, request.skill_id)
    if snapshot.scope != current_scope() or request.skill_id not in snapshot.skill_ids:
        raise PermissionError("agent_execution_scope_or_skill_mismatch")
    ai = dict(load_params(strict_env=False).ai)
    current = next((p for p in ai.get("agents", []) if p.get("id") == snapshot.agent_id), None)
    if not current or not current.get("enabled", True):
        raise RuntimeError("agent_execution_profile_unavailable")
    allowed = resolve_agent_runtime(current, vault_path=Path(snapshot.scope.vault_path), active_skill_ids=snapshot.skill_ids)
    if set(snapshot.skill_ids) != set(allowed.active_skill_ids):
        raise PermissionError("agent_execution_skill_revoked")
    runtime = replace(allowed, instructions=tuple(snapshot.instructions), catalog_revision=snapshot.catalog_revision)
    return snapshot, ai, runtime


def _checked_checkpoint(request: AgentOperation, snapshot: AgentExecutionSnapshot, parent_id: str, key: str, validator: Callable[[str], str] | None) -> AgentRun | None:
    cached = store.phase_checkpoint(snapshot.scope, parent_id, key)
    if cached is not None:
        _validate_output(cached.result, request.output_schema)
        if validator is not None:
            validator(cached.result)
        report_run(cached.run_id)
    return cached


async def execute_operation(request: AgentOperation, *, snapshot: AgentExecutionSnapshot | None = None, output_validator: Callable[[str], str] | None = None) -> AgentRun:
    from backend.agent.factory import create_agent_workflow
    from backend.services.agent_cancellation import AgentTurnCancelled, create_cancel_token, release, cancel

    snapshot, ai, runtime = _operation_context(request, snapshot)
    parent_id = request.parent_run_id or snapshot.parent_run_id or _run.get()
    checkpoint_key = hashlib.sha256((snapshot.revision + request.model_dump_json()).encode()).hexdigest()
    cached = _checked_checkpoint(request, snapshot, parent_id, checkpoint_key, output_validator)
    if cached is not None:
        return cached
    run_id = uuid.uuid4().hex
    row = AgentRun(run_id=run_id, parent_run_id=parent_id,
                   agent_id=snapshot.agent_id, skill_id=request.skill_id, operation=request.operation,
                   origin=request.origin, status="running", created_at=time.time(), updated_at=time.time(),
                   execution_revision=snapshot.revision)
    store.create(row, snapshot.scope, {**request.model_dump(), "checkpoint_key": checkpoint_key}, snapshot.model_dump())
    report_run(run_id)
    run_token = _run.set(run_id)
    snapshot_token = _snapshot.set(snapshot)
    call_limit_token = _call_limit.set(request.max_model_calls)
    cancel_token = create_cancel_token()
    _tokens[run_id] = cancel_token
    try:
        workflow, selection = await create_agent_workflow(
            [], None, agent_id=snapshot.agent_id, user_message=request.input[:2000],
            timeout=request.timeout_seconds, active_skill_ids=snapshot.skill_ids,
            vault_path=Path(snapshot.scope.vault_path), prepared_ai_cfg=ai,
            prepared_agent_data=snapshot.profile, runtime_capabilities=runtime,
            memory_user_id=snapshot.scope.user_id, operation_mode=True,
        )
        if workflow is None:
            raise RuntimeError("principal_agent_model_unavailable")
        store.update(snapshot.scope, run_id, provider=str(selection.get("provider") or ""), model=str(selection.get("model") or ""))
        framing = f"Operation: {request.operation}\nLanguage: {request.language or 'preserve input language'}\n"
        framing += "Evidence references (provenance; only supplied content is evidence): " + json.dumps(request.context_refs, ensure_ascii=False) + "\n"
        if request.output_schema is not None:
            framing += "Return JSON matching: " + json.dumps(request.output_schema) + "\n"
        messages: list[BaseMessage] = [HumanMessage(content=framing + request.input)]
        application = workflow.compile()
        deadline = time.monotonic() + request.timeout_seconds
        for attempt in range(request.max_model_calls):
            text = ""
            inputs = {"messages": messages, "cancel_token": cancel_token, "trace_id": run_id,
                      "active_skill_ids": snapshot.skill_ids, "current_user_role": snapshot.scope.role,
                      "turn_authorized_tool_names": []}
            async with asyncio.timeout(max(0.0, deadline - time.monotonic())):
                async for event in stream_workflow(application, inputs, config={"recursion_limit": 4}):
                    for update in event.values():
                        for message in update.get("messages", []):
                            if getattr(message, "type", "") == "ai":
                                text = str(message.content)
            try:
                text = _validate_output(text, request.output_schema)
                if output_validator is not None:
                    text = output_validator(text)
                revalidate_scope(snapshot.scope)
                if store.cancelled(snapshot.scope, run_id) or (row.parent_run_id and store.cancelled(snapshot.scope, row.parent_run_id)):
                    raise AgentTurnCancelled("agent_run_cancelled")
                return store.update(snapshot.scope, run_id, status="completed", result=text)
            except (ValueError, jsonschema.ValidationError) as validation_error:
                if attempt + 1 >= request.max_model_calls:
                    raise
                messages = [*messages, AIMessage(content=text), HumanMessage(content="The previous answer did not satisfy the output contract: " + str(validation_error)[:400] + ". Produce a valid complete answer. Do not execute any actions.")]
        raise RuntimeError("agent_invalid_result")
    except BaseException as error:
        cancel(cancel_token)
        status = "cancelled" if isinstance(error, (AgentTurnCancelled, asyncio.CancelledError)) else "failed"
        store.update(snapshot.scope, run_id, status=status, error=type(error).__name__ + ": " + str(error)[:512])
        raise
    finally:
        if row.parent_run_id:
            store.aggregate(snapshot.scope, row.parent_run_id)
        _tokens.pop(run_id, None)
        release(cancel_token)
        _call_limit.reset(call_limit_token)
        _snapshot.reset(snapshot_token)
        _run.reset(run_token)


def run_sync(request: AgentOperation, *, snapshot: AgentExecutionSnapshot | None = None, output_validator: Callable[[str], str] | None = None) -> AgentRun:
    # Sync services run in worker threads. Reject accidental event-loop blocking.
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(execute_operation(request, snapshot=snapshot, output_validator=output_validator))
    raise RuntimeError("Use execute_operation from asynchronous handlers")


def generate_result_for(operation: str, prompt: str, user_message: str = "", *, timeout: int = 120, agent_id: str = "", output_schema: dict[str, Any] | None = None) -> AgentRun:
    if agent_id and prepare_snapshot(skill_id(operation)).agent_id != agent_id:
        raise ValueError("Models are managed by the principal agent")
    result = run_sync(AgentOperation(skill_id=skill_id(operation), operation=operation,
                                   input=prompt + ("\n\nRequest context:\n" + user_message if user_message and user_message not in prompt else ""), timeout_seconds=timeout, output_schema=output_schema))
    return result


def generate_for(operation: str, prompt: str, user_message: str = "", *, timeout: int = 120, agent_id: str = "", output_schema: dict[str, Any] | None = None) -> tuple[str, str]:
    result = generate_result_for(operation, prompt, user_message, timeout=timeout, agent_id=agent_id, output_schema=output_schema)
    return result.result, result.model


def cancel_run(run_id: str) -> AgentRun:
    """Authorize against the durable owner before signaling the live model."""
    row = store.cancel(current_scope(), run_id)
    if row.operation == "reader.analysis":
        from backend.domains.reader.service import cancel_analysis
        cancel_analysis(Path(current_scope().vault_path), run_id)
    from backend.services.agent_cancellation import cancel
    for active_id, token in list(_tokens.items()):
        try:
            active = store.read(current_scope(), active_id)
        except LookupError:
            continue
        ancestor = active.parent_run_id
        seen: set[str] = set()
        while ancestor and ancestor != run_id and ancestor not in seen:
            seen.add(ancestor)
            ancestor = store.read(current_scope(), ancestor).parent_run_id
        if active_id == run_id or ancestor == run_id:
            store.cancel(current_scope(), active_id)
            cancel(token)
    return row


async def resume_run(run_id: str) -> AgentRun:
    """Retry only a tool-free operation; retain the frozen procedure and lineage."""
    scope = current_scope()
    revalidate_scope(scope)
    request_data, snapshot_data = store.resume_data(scope, run_id)
    if request_data.get("mode") == "job":
        try:
            operation = request_data.get("operation")
            if operation == "reader.analysis":
                from backend.domains.reader.service import resume_analysis
                await asyncio.to_thread(resume_analysis, Path(scope.vault_path), run_id)
            elif operation == "notebook.analysis":
                from backend.services import durable_job_queue
                from backend.domains.notebooks.analysis import launch_analysis
                durable_job_queue.requeue(run_id)
                launch_analysis(Path(scope.vault_path), run_id)
            else:
                raise ValueError("use_job_resume")
        except BaseException as error:
            store.update(scope, run_id, status="failed", error=str(error))
            raise
        return store.read(scope, run_id)
    request = AgentOperation.model_validate(request_data)
    snapshot = AgentExecutionSnapshot.model_validate(snapshot_data)
    if snapshot.scope != scope:
        raise PermissionError("agent_execution_scope_changed")
    if request.resume_requires_parent:
        store.update(scope, run_id, status="failed", error="resume_parent_job")
        raise ValueError("resume_parent_job")
    request.parent_run_id = run_id
    try:
        result = await execute_operation(request, snapshot=snapshot)
    except BaseException:
        store.update(scope, run_id, status="failed", error="agent_resume_failed")
        raise
    store.update(scope, run_id, status="resumed")
    return result


def create_job_run(snapshot: AgentExecutionSnapshot, job_id: str, operation: str, *, max_calls: int | None = None) -> AgentExecutionSnapshot:
    """Create the parent activity for a durable, deterministic feature job."""
    store.create(AgentRun(run_id=job_id, agent_id=snapshot.agent_id,
        skill_id=",".join(snapshot.skill_ids), operation=operation, origin="worker",
        status="queued", created_at=time.time(), updated_at=time.time(),
        execution_revision=snapshot.revision), snapshot.scope,
        {"mode": "job", "operation": operation, "job_id": job_id, "max_calls": max_calls}, snapshot.model_dump())
    report_run(job_id)
    return snapshot.model_copy(update={"parent_run_id": job_id})
