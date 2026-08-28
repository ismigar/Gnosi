import asyncio
import json
import re
import time
from contextlib import suppress
from pathlib import Path
from typing import Any, Dict, NoReturn, Optional

from fastapi import BackgroundTasks, Depends, HTTPException, Query

from backend.agent.action_confirmations import (
    _descriptor_digest,
    cancel_confirmation,
    claim_confirmation,
    confirmation_context,
    finish_confirmation,
    get_confirmation_status,
    heartbeat_confirmation,
    list_confirmations,
)
from backend.agent.factory import prepare_agent_runtime
from backend.agent.gnosi_tools import ActionConflictError, execute_confirmed_action
from backend.domains.agent.routes.contracts import (
    ACTION_ID_RE,
    CONFIRMATION_HEARTBEAT_SECONDS,
    CONFIRMED_ACTION_TIMEOUT_SECONDS,
    ActionConfirmationRequest,
)
from backend.domains.agent.routes.router import router
from backend.domains.agent.routes.shared import _validated_identifier, _vault_scope
from backend.services.agent_replay import read_replay
from backend.services.capability_audit import (
    list_capability_events,
    record_capability_event,
)
from backend.services.workspace_service import WorkspaceContext, require_role


def _action_scope(
    payload: ActionConfirmationRequest,
    workspace_context: WorkspaceContext,
) -> Dict[str, str]:
    """Builds the exact authenticated scope used by pending actions."""
    _vault, vault_scope = _vault_scope()
    return {
        "vault_scope": vault_scope,
        "workspace_id": workspace_context.workspace_id,
        "user_id": workspace_context.user_id,
        "role": workspace_context.role,
        "agent_id": _validated_identifier(payload.agent_id, "agent_id"),
        "session_id": _validated_identifier(payload.session_id, "session_id"),
    }


def _validated_action_id(action_id: str) -> str:
    candidate = str(action_id or "").strip()
    if not ACTION_ID_RE.fullmatch(candidate):
        raise HTTPException(status_code=422, detail="Invalid confirmation ID")
    return candidate


def _raise_confirmation_error(error: Exception) -> NoReturn:
    if isinstance(error, LookupError):
        raise HTTPException(
            status_code=404,
            detail={"code": "confirmation_not_found"},
        )
    if isinstance(error, PermissionError):
        raise HTTPException(
            status_code=403,
            detail={"code": "confirmation_scope_mismatch"},
        )
    if isinstance(error, TimeoutError):
        raise HTTPException(
            status_code=410,
            detail={"code": "confirmation_expired"},
        )
    if isinstance(error, RuntimeError):
        raise HTTPException(
            status_code=409,
            detail={"code": "confirmation_unavailable"},
        )
    raise error


def _minimum_role_allows(current_role: str, required_role: str) -> bool:
    weights = {"viewer": 0, "editor": 1, "admin": 2, "owner": 3}
    return weights.get(current_role, -1) >= weights.get(required_role, 0)


async def _invoke_governed_handler(handler: Any, arguments: Dict[str, Any]) -> Any:
    if callable(getattr(handler, "ainvoke", None)):
        return await handler.ainvoke(arguments)
    if callable(getattr(handler, "invoke", None)):
        return await asyncio.to_thread(handler.invoke, arguments)
    if asyncio.iscoroutinefunction(handler):
        return await handler(**arguments)
    return await asyncio.to_thread(handler, **arguments)


def _normalized_governed_result(result: Any) -> Dict[str, Any]:
    if isinstance(result, dict):
        return result
    if isinstance(result, str):
        try:
            parsed = json.loads(result)
        except (TypeError, ValueError):
            return {"status": "completed", "result": result[:2_000]}
        return parsed if isinstance(parsed, dict) else {"status": "completed", "result": parsed}
    return {"status": "completed"}


async def _execute_governed_tool(
    arguments: Dict[str, Any],
    *,
    scope: Dict[str, str],
    vault: Path,
) -> Dict[str, Any]:
    """Re-resolve and execute one exact assigned `confirmation=always` tool."""
    active_skill_ids = list(arguments.get("active_skill_ids") or [])
    _ai_cfg, agent_data, runtime = prepare_agent_runtime(
        scope["agent_id"],
        vault_path=vault,
        active_skill_ids=active_skill_ids,
    )
    if not agent_data or runtime is None:
        raise PermissionError("The agent runtime is unavailable.")

    tool_id = str(arguments.get("tool_id") or "")
    tool_name = str(arguments.get("tool_name") or "")
    descriptor = None
    handler = None
    for current_descriptor, current_handler in zip(
        getattr(runtime, "tool_descriptors", ()) or (),
        getattr(runtime, "tools", ()) or (),
    ):
        if str(getattr(current_descriptor, "id", "") or "") == tool_id:
            descriptor = current_descriptor
            handler = current_handler
            break
    if descriptor is None or handler is None:
        raise PermissionError("The governed tool is no longer assigned.")
    visible_name = str(getattr(handler, "name", "") or getattr(handler, "__name__", "") or "")
    if visible_name != tool_name:
        raise PermissionError("The governed tool identity changed.")
    confirmation = str(
        getattr(getattr(descriptor, "confirmation", ""), "value", "")
        or getattr(descriptor, "confirmation", "")
    )
    if confirmation != "always":
        raise PermissionError("The governed tool no longer requires this approval.")
    if _descriptor_digest(descriptor) != str(arguments.get("descriptor_digest") or ""):
        raise ActionConflictError("The governed tool changed after the preview.")
    if not _minimum_role_allows(
        scope["role"],
        str(getattr(descriptor, "minimum_role", "viewer") or "viewer"),
    ):
        raise PermissionError("The current role cannot execute this tool.")

    call_arguments = dict(arguments.get("tool_arguments") or {})
    started = time.monotonic()
    effects = [
        str(getattr(effect, "value", effect))
        for effect in (getattr(descriptor, "effects", None) or [])
    ]
    try:
        result = await _invoke_governed_handler(handler, call_arguments)
    except Exception as error:
        await asyncio.to_thread(
            record_capability_event,
            scope,
            tool_id=tool_id,
            tool_name=tool_name,
            effects=effects,
            status="failed",
            argument_keys=list(call_arguments),
            error_code=type(error).__name__,
            duration_ms=int((time.monotonic() - started) * 1000),
        )
        raise
    await asyncio.to_thread(
        record_capability_event,
        scope,
        tool_id=tool_id,
        tool_name=tool_name,
        effects=effects,
        status="completed",
        argument_keys=list(call_arguments),
        result_kind=type(result).__name__,
        duration_ms=int((time.monotonic() - started) * 1000),
    )
    return _normalized_governed_result(result)


def _action_has_uncertain_effect(action: str, arguments: Dict[str, Any]) -> bool:
    if action in {
        "archive_mail",
        "change_schema",
        "create_calendar_event",
        "delete_contact",
        "delete_page",
        "delete_table",
        "empty_trash",
        "invite_attendees",
        "move_mail",
        "restore_page_version",
        "save_mail_draft",
        "send_mail",
    }:
        return True
    if action == "governed_tool":
        return bool(
            {
                "code_execution",
                "destructive",
                "external_write",
            }.intersection(arguments.get("effects") or [])
        )
    return False


async def _heartbeat_claimed_confirmation(action_id: str) -> None:
    """Keep a live execution lease from being mistaken for an abandoned call."""
    while True:
        await asyncio.sleep(CONFIRMATION_HEARTBEAT_SECONDS)
        alive = await asyncio.to_thread(heartbeat_confirmation, action_id)
        if not alive:
            return


def _execute_first_party_confirmation_in_worker(
    action: str,
    arguments: Dict[str, Any],
    *,
    workspace_id: str,
    background_tasks: BackgroundTasks,
) -> Dict[str, Any]:
    """Run blocking provider/filesystem handlers outside the server event loop."""
    return asyncio.run(
        execute_confirmed_action(
            action,
            arguments,
            workspace_id=workspace_id,
            background_tasks=background_tasks,
        )
    )


@router.get("/chat/confirmations", response_model=None)
async def list_agent_confirmations(
    agent_id: str = Query(..., max_length=128),
    session_id: str = Query(..., max_length=128),
    workspace_context: WorkspaceContext = Depends(require_role("editor")),
) -> Any:
    """Return resumable public confirmation cards for one exact chat scope."""
    scope = _action_scope(
        ActionConfirmationRequest(agent_id=agent_id, session_id=session_id),
        workspace_context,
    )
    records = await asyncio.to_thread(list_confirmations, scope)
    return {"confirmations": records}


@router.get("/chat/capability-audit", response_model=None)
async def list_agent_capability_audit(
    agent_id: str = Query(..., max_length=128),
    session_id: str = Query(..., max_length=128),
    limit: int = Query(100, ge=1, le=500),
    tool_id: Optional[str] = Query(default=None, max_length=256),
    status: Optional[str] = Query(default=None, max_length=64),
    workspace_context: WorkspaceContext = Depends(require_role("editor")),
) -> Any:
    """Return metadata-only governed tool events for one exact chat scope."""
    scope = _action_scope(
        ActionConfirmationRequest(agent_id=agent_id, session_id=session_id),
        workspace_context,
    )
    records = await asyncio.to_thread(
        list_capability_events,
        scope,
        limit=limit,
        tool_id=tool_id,
        status=status,
    )
    return {"events": records}


@router.get("/chat/replays/{trace_id}", response_model=None)
async def get_agent_replay(
    trace_id: str,
    limit: int = Query(100, ge=1, le=200),
    workspace_context: WorkspaceContext = Depends(require_role("editor")),
) -> Any:
    """Return metadata-only replay events for one trace id."""
    safe_trace_id = str(trace_id or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", safe_trace_id):
        raise HTTPException(status_code=422, detail="Invalid trace id.")
    return {
        "trace_id": safe_trace_id,
        "events": await asyncio.to_thread(read_replay, safe_trace_id, limit),
    }


@router.get("/chat/confirmations/{action_id}", response_model=None)
async def get_agent_confirmation(
    action_id: str,
    agent_id: str = Query(..., max_length=128),
    session_id: str = Query(..., max_length=128),
    workspace_context: WorkspaceContext = Depends(require_role("editor")),
) -> Any:
    """Return one public confirmation status for transport reconciliation."""
    safe_action_id = _validated_action_id(action_id)
    scope = _action_scope(
        ActionConfirmationRequest(agent_id=agent_id, session_id=session_id),
        workspace_context,
    )
    try:
        return await asyncio.to_thread(
            get_confirmation_status,
            safe_action_id,
            scope,
        )
    except Exception as error:
        _raise_confirmation_error(error)


@router.post("/chat/confirmations/{action_id}/confirm", response_model=None)
async def confirm_agent_action(  # noqa: C901 - explicit confirmation outcomes
    action_id: str,
    payload: ActionConfirmationRequest,
    background_tasks: BackgroundTasks,
    workspace_context: WorkspaceContext = Depends(require_role("editor")),
) -> Any:
    """Claims and executes one scope-bound pending agent action exactly once."""
    safe_action_id = _validated_action_id(action_id)
    scope = _action_scope(payload, workspace_context)
    try:
        pending = await asyncio.to_thread(
            claim_confirmation,
            safe_action_id,
            scope,
        )
    except Exception as error:
        _raise_confirmation_error(error)

    admin_actions = {"delete_table", "empty_trash"}
    if pending["action"] in admin_actions and workspace_context.role not in {
        "owner",
        "admin",
    }:
        await asyncio.to_thread(
            finish_confirmation,
            safe_action_id,
            error="Administrator permission is required.",
        )
        raise HTTPException(
            status_code=403,
            detail={"code": "confirmation_admin_required"},
        )

    heartbeat_task = asyncio.create_task(_heartbeat_claimed_confirmation(safe_action_id))
    try:
        try:
            vault, _vault_scope_id = _vault_scope()
            async with asyncio.timeout(CONFIRMED_ACTION_TIMEOUT_SECONDS):
                with confirmation_context(**scope):
                    if pending["action"] == "governed_tool":
                        result = await _execute_governed_tool(
                            pending["arguments"],
                            scope=scope,
                            vault=vault,
                        )
                    else:
                        result = await asyncio.to_thread(
                            _execute_first_party_confirmation_in_worker,
                            pending["action"],
                            pending["arguments"],
                            workspace_id=workspace_context.workspace_id,
                            background_tasks=background_tasks,
                        )
        except HTTPException as error:
            outcome_unknown = error.status_code >= 500 and _action_has_uncertain_effect(
                pending["action"],
                pending["arguments"],
            )
            await asyncio.to_thread(
                finish_confirmation,
                safe_action_id,
                error=(
                    "execution_outcome_unknown"
                    if outcome_unknown
                    else "confirmation_action_rejected"
                ),
                status="outcome_unknown" if outcome_unknown else "failed",
            )
            if outcome_unknown:
                raise HTTPException(
                    status_code=409,
                    detail={"code": "confirmation_outcome_unknown"},
                ) from error
            raise error
        except Exception as error:
            timed_out = isinstance(error, TimeoutError)
            known_precondition_failure = isinstance(
                error,
                (ActionConflictError, LookupError, PermissionError, ValueError),
            )
            outcome_unknown = timed_out or (
                not known_precondition_failure
                and _action_has_uncertain_effect(
                    pending["action"],
                    pending["arguments"],
                )
            )
            await asyncio.to_thread(
                finish_confirmation,
                safe_action_id,
                error=(
                    "execution_outcome_unknown" if outcome_unknown else "confirmation_action_failed"
                ),
                status="outcome_unknown" if outcome_unknown else "failed",
            )
            if outcome_unknown:
                raise HTTPException(
                    status_code=409,
                    detail={"code": "confirmation_outcome_unknown"},
                )
            status_code = 409 if isinstance(error, (LookupError, RuntimeError)) else 500
            raise HTTPException(
                status_code=status_code,
                detail={"code": "confirmation_action_failed"},
            )
    finally:
        heartbeat_task.cancel()
        with suppress(asyncio.CancelledError):
            await heartbeat_task

    result_status = str(result.get("status") or "") if isinstance(result, dict) else ""
    normalized_result_status = result_status.strip().lower()
    if normalized_result_status in {"failed", "error", "failure"}:
        terminal_status = "failed"
    elif normalized_result_status in {"cancelled", "canceled"}:
        terminal_status = "cancelled"
    elif normalized_result_status == "partial":
        terminal_status = "partial"
    elif normalized_result_status in {
        "",
        "completed",
        "complete",
        "success",
        "succeeded",
        "created",
        "updated",
        "deleted",
        "sent",
        "restored",
    } and not (isinstance(result, dict) and result.get("error")):
        terminal_status = "completed"
    else:
        terminal_status = "failed"
    await asyncio.to_thread(
        finish_confirmation,
        safe_action_id,
        result=result,
        status=terminal_status,
    )
    return {
        "status": terminal_status,
        "confirmation_id": safe_action_id,
        "action": pending["action"],
        "result_status": result_status,
        "result": (
            {
                key: result.get(key)
                for key in (
                    "cleanup_status",
                    "failed_count",
                    "freed_bytes",
                    "purged_count",
                    "rollback_failed_ids",
                    "updated_count",
                )
                if key in result
            }
            if isinstance(result, dict)
            else {}
        ),
    }


@router.post("/chat/confirmations/{action_id}/cancel", response_model=None)
async def cancel_agent_action(
    action_id: str,
    payload: ActionConfirmationRequest,
    workspace_context: WorkspaceContext = Depends(require_role("editor")),
) -> Any:
    """Cancels one still-pending action in the exact same chat scope."""
    safe_action_id = _validated_action_id(action_id)
    scope = _action_scope(payload, workspace_context)
    try:
        cancelled = await asyncio.to_thread(
            cancel_confirmation,
            safe_action_id,
            scope,
        )
    except Exception as error:
        _raise_confirmation_error(error)
    if not cancelled:
        raise HTTPException(
            status_code=409,
            detail={"code": "confirmation_unavailable"},
        )
    return {"status": "cancelled", "confirmation_id": safe_action_id}
