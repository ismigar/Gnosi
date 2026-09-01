import asyncio
import json
import logging
import os
import time
import uuid
from pathlib import Path
from typing import Any, AsyncIterator, Dict, Optional, cast

from fastapi import Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage

from backend.agent.context_safety import sanitize_untrusted_context
from backend.agent.factory import (
    _explicit_brain_write_tool_names,
    build_agent_turn_plan,
)
from backend.domains.agent.routes.attachments import (
    _attachment_scope_key,
    _consume_attachment_context,
)
from backend.domains.agent.routes.chat_stream import stream_agent_events
from backend.domains.agent.routes.checkpoints import (
    _chat_thread_id,
    _checkpoint_key,
    _thread_lock,
)
from backend.domains.agent.routes.contracts import (
    TURN_TIMEOUT_SECONDS,
    ChatRequest,
)
from backend.domains.agent.routes.router import router
from backend.domains.agent.routes.shared import (
    _validated_identifier,
    _validated_skill_ids,
    _vault_scope,
)
from backend.domains.agent.routes.state import cfg
from backend.domains.agent.routes.workflow import get_agent_workflow
from backend.services.agent_cancellation import (
    bind_stream as bind_agent_stream,
)
from backend.services.agent_cancellation import (
    create_cancel_token,
)
from backend.services.agent_cancellation import (
    release as release_agent_turn,
)
from backend.services.agent_replay import record_event as record_replay_event
from backend.services.agent_stream_protocol import protocolize_stream
from backend.services.turn_idempotency import claim as claim_turn
from backend.services.turn_idempotency import finish as finish_turn
from backend.services.workspace_service import WorkspaceContext, require_role
from backend.utils.errors import safe_error_detail

log = logging.getLogger(__name__)


async def _resolve_notebook_turn(
    chat_req: ChatRequest,
    workspace_context: WorkspaceContext,
    session_id: str,
) -> tuple[Optional[Dict[str, Any]], str, str]:
    notebook_refs = [item for item in chat_req.context_refs if item.type == "notebook"]
    if not notebook_refs:
        return None, workspace_context.user_id, session_id
    if len(notebook_refs) != len(chat_req.context_refs):
        raise HTTPException(
            status_code=400,
            detail="A notebook conversation cannot mix other context sources.",
        )
    if chat_req.attachments or chat_req.mentions or chat_req.active_skill_ids:
        raise HTTPException(
            status_code=400,
            detail="Notebook conversations accept notebook evidence only.",
        )
    from backend.services import notebook_service

    primary_notebook_id = str(chat_req.notebook_id or notebook_refs[0].ref).strip()
    notebook_turn = await asyncio.to_thread(
        notebook_service.resolve_chat_contexts,
        primary_notebook_id,
        [item.model_dump(mode="python") for item in notebook_refs],
        workspace_context,
    )
    return (
        notebook_turn,
        str(notebook_turn["principal"]),
        _validated_identifier(str(notebook_turn["session_id"]), "session_id"),
    )


def _chat_user_content(
    chat_req: ChatRequest,
    *,
    vault: Path,
    vault_scope: str,
    workspace_context: WorkspaceContext,
    agent_id: str,
    session_id: str,
) -> tuple[str, list[str]]:
    user_content = chat_req.message
    untrusted_context_flags: list[str] = []
    if chat_req.attachments:
        attachment_scope = _attachment_scope_key(
            vault_scope,
            workspace_context.workspace_id,
            workspace_context.user_id,
            agent_id,
            session_id,
        )
        attachment_text = _consume_attachment_context(
            vault,
            chat_req.attachments,
            attachment_scope,
        )
        if attachment_text:
            safe_attachment, flags = sanitize_untrusted_context(
                attachment_text,
                max_chars=24_000,
            )
            untrusted_context_flags.extend(flags[:8])
            user_content += "\n\nVerified attachment context:\n" + safe_attachment

    mention_lines = []
    for mention in chat_req.mentions:
        mention_type = (mention.type or "").strip().lower()
        mention_id = (mention.id or "").strip()
        if mention_type and mention_id:
            mention_label = (mention.label or "").strip() or mention_id
            mention_lines.append(f"- {mention_type}: {mention_label} (id: {mention_id})")
    if mention_lines:
        user_content += "\n\nSelected mentions context:\n" + "\n".join(mention_lines)
    return user_content, untrusted_context_flags


def _chat_inputs(
    *,
    chat_req: ChatRequest,
    workspace_context: WorkspaceContext,
    notebook_turn: Optional[Dict[str, Any]],
    user_content: str,
    authorized_tool_names: set[str],
    llm_selection: Dict[str, Any],
    turn_plan: Dict[str, Any],
    cancel_token: str,
    trace_id: str,
) -> Dict[str, Any]:
    additional_kwargs: Dict[str, Any] = {"gnosi_visible_content": chat_req.message}
    if notebook_turn:
        additional_kwargs["gnosi_author_user_id"] = workspace_context.user_id
        if notebook_turn.get("revision") is not None:
            additional_kwargs["gnosi_notebook_revision"] = notebook_turn["revision"]
    if chat_req.turn_id:
        additional_kwargs["gnosi_turn_id"] = chat_req.turn_id
    return {
        "messages": [HumanMessage(content=user_content, additional_kwargs=additional_kwargs)],
        "turn_authorized_tool_names": sorted(authorized_tool_names),
        "active_skill_ids": list((llm_selection or {}).get("active_skill_ids") or []),
        "current_user_role": workspace_context.role,
        "turn_plan": turn_plan,
        "cancel_token": cancel_token,
        "trace_id": trace_id,
        "turn_started_at": time.monotonic(),
    }


async def _finish_failed_turn(
    *,
    cancel_token: str,
    turn_claimed: bool,
    chat_req: ChatRequest,
    vault_scope: str,
    workspace_context: WorkspaceContext,
    chat_principal: str,
    agent_id: str,
    session_id: str,
) -> None:
    if cancel_token:
        release_agent_turn(cancel_token)
    if turn_claimed and chat_req.turn_id:
        await asyncio.to_thread(
            finish_turn,
            vault_scope=vault_scope,
            workspace_id=workspace_context.workspace_id,
            user_id=chat_principal,
            agent_id=agent_id,
            session_id=session_id,
            turn_id=chat_req.turn_id,
            state="failed",
        )


def _unavailable_response(
    *,
    error_code: str,
    trace_id: str,
    chat_req: ChatRequest,
    workspace_context: WorkspaceContext,
    agent_id: str,
    session_id: str,
) -> StreamingResponse:
    async def unavailable_generator() -> AsyncIterator[str]:
        yield json.dumps({"type": "error", "code": error_code, "content": error_code}) + "\n"
        yield json.dumps({"type": "done", "has_response": True, "message_count": 1}) + "\n"

    return StreamingResponse(
        protocolize_stream(
            unavailable_generator(),
            stream_id=trace_id,
            trace_id=trace_id,
            turn_id=chat_req.turn_id or "",
            journal_scope={
                "workspace_id": workspace_context.workspace_id,
                "user_id": workspace_context.user_id,
                "agent_id": agent_id,
                "session_id": session_id,
            },
        ),
        media_type="application/x-ndjson",
        status_code=200,
    )


@router.post("/chat", response_model=None)
async def chat_endpoint(
    request: Request,
    chat_req: ChatRequest,
    workspace_context: WorkspaceContext = Depends(require_role("editor")),
) -> StreamingResponse:
    """
    Main endpoint for chatting with a specific agent.
    """
    request_started_at = time.monotonic()
    cancel_token = ""
    trace_id = uuid.uuid4().hex
    turn_claimed = False
    agent_id = ""
    session_id = ""
    vault_scope = ""
    chat_principal = workspace_context.user_id
    notebook_turn: Optional[Dict[str, Any]] = None
    try:
        agent_id = _validated_identifier(chat_req.agent_id, "agent_id")
        session_id = _validated_identifier(chat_req.session_id, "session_id")
        requested_skill_ids = _validated_skill_ids(chat_req.active_skill_ids)
        vault, vault_scope = _vault_scope()
        notebook_turn, chat_principal, session_id = await _resolve_notebook_turn(
            chat_req,
            workspace_context,
            session_id,
        )
        if chat_req.turn_id:
            turn_claimed = claim_turn(
                vault_scope=vault_scope,
                workspace_id=workspace_context.workspace_id,
                user_id=chat_principal,
                agent_id=agent_id,
                session_id=session_id,
                turn_id=chat_req.turn_id,
                trace_id=trace_id,
            )
            if not turn_claimed:
                raise HTTPException(
                    status_code=409,
                    detail="This turn has already been accepted or is still running.",
                )

        # 1. Build bounded attachment context and delete the temporary files
        # before provider selection. This cleanup therefore also covers model
        # configuration and workflow-construction failures.
        user_content, untrusted_context_flags = _chat_user_content(
            chat_req,
            vault=vault,
            vault_scope=vault_scope,
            workspace_context=workspace_context,
            agent_id=agent_id,
            session_id=session_id,
        )

        # 2. Get the workflow only after request-owned uploads are cleaned up.
        turn_context_refs = [item.model_dump(mode="python") for item in chat_req.context_refs]
        if notebook_turn:
            turn_context_refs = notebook_turn["contexts"]
        workflow, llm_selection = await get_agent_workflow(
            request,
            agent_id,
            llm_mode=chat_req.llm_mode,
            llm_provider=chat_req.llm_provider,
            llm_model=chat_req.llm_model,
            user_message=chat_req.message,
            vault_scope=vault_scope,
            vault_path=vault,
            active_skill_ids=requested_skill_ids,
            turn_context_refs=turn_context_refs,
            memory_user_id=workspace_context.user_id,
        )
        workflow_ready_at = time.monotonic()
        cancel_token = create_cancel_token()
        bind_agent_stream(
            cancel_token,
            trace_id,
            {
                "workspace_id": workspace_context.workspace_id,
                "user_id": workspace_context.user_id,
                "agent_id": agent_id,
                "session_id": session_id,
            },
        )

        authorized_tool_names = _explicit_brain_write_tool_names(
            chat_req.message,
            chat_req.mentions,
        )
        authorized_tool_names.update(
            (llm_selection or {}).get("turn_grant_tool_names") or [],
        )
        turn_plan = build_agent_turn_plan(
            chat_req.message,
            context_refs=(llm_selection or {}).get("context_refs") or [],
            tool_metadata=(llm_selection or {}).get("tools") or [],
            authorized_tool_names=authorized_tool_names,
            provider=str((llm_selection or {}).get("provider") or ""),
        )
        interpretation = turn_plan.get("interpretation") or {}
        await asyncio.to_thread(
            record_replay_event,
            trace_id,
            "plan",
            {
                "mode": turn_plan.get("mode"),
                "route": turn_plan.get("route"),
                "execution": turn_plan.get("execution"),
                "operation": interpretation.get("operation"),
                "confidence": interpretation.get("confidence"),
                "abstain": interpretation.get("abstain"),
                "privacy_classification": (turn_plan.get("privacy") or {}).get("classification"),
            },
        )
        turn_timeout_seconds = max(
            1,
            min(
                TURN_TIMEOUT_SECONDS,
                int(
                    (turn_plan.get("budgets") or {}).get(
                        "timeout_seconds",
                        TURN_TIMEOUT_SECONDS,
                    )
                ),
            ),
        )
        inputs = _chat_inputs(
            chat_req=chat_req,
            workspace_context=workspace_context,
            notebook_turn=notebook_turn,
            user_content=user_content,
            authorized_tool_names=authorized_tool_names,
            llm_selection=llm_selection,
            turn_plan=turn_plan,
            cancel_token=cancel_token,
            trace_id=trace_id,
        )

        # 3. Configure memory thread (per agent + session)
        thread_id = _chat_thread_id(
            vault_scope=vault_scope,
            workspace_id=workspace_context.workspace_id,
            user_id=chat_principal,
            agent_id=agent_id,
            session_id=session_id,
        )
        config = {
            "configurable": {"thread_id": thread_id},
            "recursion_limit": 12,
        }
        turn_lock = _thread_lock(thread_id)

        # 4. Persistence setup
        checkpoint_key = _checkpoint_key(
            vault_scope=vault_scope,
            workspace_id=workspace_context.workspace_id,
            user_id=chat_principal,
            agent_id=agent_id,
        )
        db_path = cast(Path, cfg.paths["CHECKPOINTS"]) / f"agent_{checkpoint_key}.sqlite"
        os.makedirs(db_path.parent, exist_ok=True)

        def event_generator() -> AsyncIterator[str]:
            return stream_agent_events(
                request_started_at=request_started_at,
                workflow_ready_at=workflow_ready_at,
                llm_selection=llm_selection,
                turn_plan=turn_plan,
                trace_id=trace_id,
                vault_scope=vault_scope,
                workspace_context=workspace_context,
                agent_id=agent_id,
                session_id=session_id,
                turn_timeout_seconds=turn_timeout_seconds,
                chat_req=chat_req,
                untrusted_context_flags=untrusted_context_flags,
                turn_lock=turn_lock,
                db_path=db_path,
                workflow=workflow,
                inputs=inputs,
                config=config,
                cancel_token=cancel_token,
                turn_claimed=turn_claimed,
                chat_principal=chat_principal,
            )

        return StreamingResponse(
            protocolize_stream(
                event_generator(),
                stream_id=trace_id,
                trace_id=trace_id,
                turn_id=chat_req.turn_id or "",
                journal_scope={
                    "workspace_id": workspace_context.workspace_id,
                    "user_id": workspace_context.user_id,
                    "agent_id": agent_id,
                    "session_id": session_id,
                },
            ),
            media_type="application/x-ndjson",
        )

    except HTTPException as error:
        await _finish_failed_turn(
            cancel_token=cancel_token,
            turn_claimed=turn_claimed,
            chat_req=chat_req,
            vault_scope=vault_scope,
            workspace_context=workspace_context,
            chat_principal=chat_principal,
            agent_id=agent_id,
            session_id=session_id,
        )
        if error.status_code == 503:
            error_code = (
                error.detail.get("code")
                if isinstance(error.detail, dict)
                else "service_unavailable"
            )
            return _unavailable_response(
                error_code=str(error_code),
                trace_id=trace_id,
                chat_req=chat_req,
                workspace_context=workspace_context,
                agent_id=agent_id,
                session_id=session_id,
            )
        raise
    except Exception as error:
        await _finish_failed_turn(
            cancel_token=cancel_token,
            turn_claimed=turn_claimed,
            chat_req=chat_req,
            vault_scope=vault_scope,
            workspace_context=workspace_context,
            chat_principal=chat_principal,
            agent_id=agent_id,
            session_id=session_id,
        )
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(error, context="POST /api/agent/chat"),
        )
