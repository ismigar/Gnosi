from fastapi import APIRouter, HTTPException, Request, Depends, File, UploadFile
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage
import json
import asyncio
import logging
import os
import hashlib
import re
import uuid
import time
import weakref
from pathlib import Path
from backend.agent.factory import (
    _explicit_brain_write_tool_names,
    create_agent_workflow,
    prepare_agent_runtime,
)
from backend.agent.action_confirmations import (
    bind_confirmation_context,
    cancel_confirmation,
    claim_confirmation,
    confirmation_event,
    finish_confirmation,
    reset_confirmation_context,
)
from backend.agent.gnosi_tools import execute_confirmed_action
from backend.agent.model_router import record_llm_usage, usage_from_message
from backend.agent.model_reliability import (
    blames_the_model, model_evidence, record_failure, reliability_report,
)
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from backend.config.app_config import load_params
from backend.utils.errors import safe_error_detail
from backend.services.workspace_service import require_role, WorkspaceContext
from backend.services.context_vars import get_active_vault_path

cfg = load_params()

log = logging.getLogger(__name__)
router = APIRouter()


# One line per reason, in the user's language. The taxonomy itself (and which
# reasons are the model's fault) lives in `model_reliability`.
FAILURE_MESSAGES = {
    "tool_use_failed": (
        "The model did not call the tools correctly and wrote the call as text. "
        "This is a model limitation, not a tool limitation."
    ),
    "context_length_exceeded": (
        "The conversation exceeds the model's context window. Shorten it or "
        "choose a model with a larger context window."
    ),
    "schema_invalid": "The model did not produce the requested response format.",
    "content_filter": "The provider blocked the response through its content filters.",
    "rate_limit": "Provider request limit reached. Try again later.",
    "insufficient_credit": (
        "The provider account does not have enough credit. This is not a model problem."
    ),
    "auth": "Invalid provider credentials. Check them in Settings → AI.",
    "not_found": "The provider does not recognize this model.",
    "timeout": "The provider did not respond in time. Try again.",
    "server_error": "Provider error. Try again later.",
}


class MentionRef(BaseModel):
    type: str = Field(max_length=32)
    id: str = Field(max_length=256)
    label: Optional[str] = Field(default=None, max_length=256)

class AttachmentRef(BaseModel):
    name: str = Field(max_length=256)
    size: int = 0
    type: str = Field(default="", max_length=128)
    path: str = Field(max_length=512)

class ChatRequest(BaseModel):
    message: str = Field(max_length=100_000)
    agent_id: str = "gnosy" # Default agent
    session_id: str = "default"
    history: List[Dict[str, Any]] = Field(default_factory=list)
    llm_mode: str = "agent_default"  # auto | manual | agent_default
    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None
    mentions: List[MentionRef] = Field(default_factory=list, max_length=20)
    attachments: List[AttachmentRef] = Field(default_factory=list, max_length=8)
    active_skill_ids: Optional[List[str]] = Field(default=None, max_length=64)
    confirmed_tool_ids: List[str] = Field(default_factory=list, max_length=64)


class AttachmentDeleteRequest(BaseModel):
    path: str = Field(max_length=512)


class ActionConfirmationRequest(BaseModel):
    agent_id: str = Field(max_length=128)
    session_id: str = Field(max_length=128)


IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")
ACTION_ID_RE = re.compile(r"^[a-f0-9]{32}$")
SKILL_IDENTIFIER_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,191}$")
MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024
MAX_ATTACHMENT_TEXT = 20_000
MAX_ATTACHMENT_CONTEXT = 40_000
MAX_PDF_PAGES = 50
ATTACHMENT_EXTRACTION_SECONDS = 5
ATTACHMENT_MAX_AGE_SECONDS = 24 * 60 * 60
TURN_TIMEOUT_SECONDS = 120
CHAT_ATTACHMENT_TYPES = {
    ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".yaml", ".yml",
    ".xml", ".html", ".css", ".js", ".jsx", ".ts", ".tsx", ".py", ".pdf",
}
_THREAD_LOCKS: weakref.WeakValueDictionary[str, asyncio.Lock] = weakref.WeakValueDictionary()


def _validated_identifier(value: str, label: str) -> str:
    candidate = (value or "").strip()
    if not IDENTIFIER_RE.fullmatch(candidate):
        raise HTTPException(status_code=422, detail=f"Invalid {label}")
    return candidate


def _validated_skill_ids(values: Optional[List[str]]) -> Optional[List[str]]:
    """Validate and deduplicate optional per-turn skill activations."""
    if values is None:
        return None
    result = []
    seen = set()
    for value in values:
        candidate = (value or "").strip()
        if not SKILL_IDENTIFIER_RE.fullmatch(candidate):
            raise HTTPException(status_code=422, detail="Invalid skill ID")
        if candidate not in seen:
            seen.add(candidate)
            result.append(candidate)
    return result


def _vault_scope() -> tuple[Path, str]:
    vault = Path(get_active_vault_path()).resolve()
    digest = hashlib.sha256(str(vault).encode("utf-8")).hexdigest()[:20]
    return vault, digest


def _attachment_root(vault: Path) -> Path:
    root = (vault / ".gnosi" / "chat-attachments").resolve()
    if root != vault and vault not in root.parents:
        raise HTTPException(status_code=400, detail="Invalid attachment directory")
    return root


def _attachment_target(vault: Path, relative_path: str) -> Path:
    root = _attachment_root(vault)
    relative = Path(relative_path)
    target = (vault / relative).resolve()
    if target == vault or vault not in target.parents or root not in target.parents:
        raise HTTPException(status_code=422, detail="Invalid attachment path")
    return target


def _delete_attachment(vault: Path, relative_path: str) -> None:
    target = _attachment_target(vault, relative_path)
    if target.is_file():
        target.unlink(missing_ok=True)


def _cleanup_expired_attachments(vault: Path) -> None:
    root = _attachment_root(vault)
    if not root.exists():
        return
    cutoff = time.time() - ATTACHMENT_MAX_AGE_SECONDS
    for item in root.iterdir():
        try:
            if item.is_file() and item.stat().st_mtime < cutoff:
                item.unlink(missing_ok=True)
        except OSError:
            continue


def _attachment_context(vault: Path, refs: List[AttachmentRef]) -> str:
    sections = []
    remaining_total = MAX_ATTACHMENT_CONTEXT
    deadline = time.monotonic() + ATTACHMENT_EXTRACTION_SECONDS
    for ref in refs:
        if remaining_total <= 0 or time.monotonic() >= deadline:
            break
        target = _attachment_target(vault, ref.path)
        if not target.is_file() or target.stat().st_size > MAX_ATTACHMENT_BYTES:
            raise HTTPException(status_code=422, detail="Attachment is missing or too large")

        suffix = target.suffix.lower()
        text = ""
        if suffix == ".pdf":
            try:
                from pypdf import PdfReader
                chunks = []
                extracted = 0
                for page_index, page in enumerate(PdfReader(str(target)).pages):
                    if page_index >= MAX_PDF_PAGES:
                        break
                    if extracted >= min(MAX_ATTACHMENT_TEXT, remaining_total):
                        break
                    if time.monotonic() >= deadline:
                        break
                    chunk = page.extract_text() or ""
                    chunks.append(chunk[: min(MAX_ATTACHMENT_TEXT, remaining_total) - extracted])
                    extracted += len(chunks[-1])
                text = "\n".join(chunks)
            except Exception as exc:
                log.warning("Could not extract chat PDF attachment %s: %s", target.name, exc)
        else:
            with target.open("r", encoding="utf-8", errors="replace") as handle:
                text = handle.read(min(MAX_ATTACHMENT_TEXT, remaining_total) + 1)

        if text.strip():
            bounded = text[: min(MAX_ATTACHMENT_TEXT, remaining_total)]
            sections.append(f"Attachment: {ref.name}\n{bounded}")
            remaining_total -= len(bounded)
        else:
            sections.append(
                f"Attachment: {ref.name}\n"
                "(No text could be extracted.)"
            )
    return "\n\n".join(sections)


def _consume_attachment_context(vault: Path, refs: List[AttachmentRef]) -> str:
    """Extract request-owned attachment context and always remove its files."""
    try:
        return _attachment_context(vault, refs)
    finally:
        for attachment in refs:
            try:
                _delete_attachment(vault, attachment.path)
            except Exception as cleanup_error:
                log.warning(
                    "Could not remove chat attachment %s: %s",
                    attachment.path,
                    cleanup_error,
                )


def _tool_stream_event(
    event_type: str,
    tool_name: Optional[str],
    node_name: str,
    metadata: Optional[Dict[str, Any]] = None,
) -> str:
    """Serialize public tool lifecycle metadata without arguments or results."""
    payload = {
        "type": event_type,
        "tool": tool_name,
        "node": node_name,
    }
    if metadata:
        payload.update({
            "tool_id": metadata.get("id"),
            "skill_ids": list(metadata.get("skill_ids") or []),
            "effects": list(metadata.get("effects") or []),
        })
    return json.dumps(payload) + "\n"


def _message_text(content: Any) -> str:
    """Normalize provider-specific structured content into renderable text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                block_type = str(block.get("type") or "").lower()
                if block_type in {"reasoning", "thinking", "analysis"}:
                    continue
                value = block.get("text")
                if value is None and block_type in {"", "text", "output_text"}:
                    value = block.get("content")
                if isinstance(value, str):
                    parts.append(value)
        return "\n".join(part for part in parts if part)
    if content is None:
        return ""
    return str(content)


def _thread_lock(thread_id: str) -> asyncio.Lock:
    lock = _THREAD_LOCKS.get(thread_id)
    if lock is None:
        lock = asyncio.Lock()
        _THREAD_LOCKS[thread_id] = lock
    return lock

async def get_agent_workflow(
    request: Request,
    agent_id: str,
    llm_mode: str = "agent_default",
    llm_provider: Optional[str] = None,
    llm_model: Optional[str] = None,
    user_message: str = "",
    vault_scope: str = "",
    vault_path: Optional[Path] = None,
    active_skill_ids: Optional[List[str]] = None,
):
    """
    Helper to get or build the agent workflow for a specific ID.
    Caches the StateGraph in app.state.agent_cache.
    """
    use_cache = llm_mode == "agent_default" and not llm_provider and not llm_model

    if not hasattr(request.app.state, "agent_cache"):
        request.app.state.agent_cache = {}

    mcp_client = getattr(request.app.state, "mcp_client", None)
    mcp_ready = mcp_client is not None
    tools_list = []
    if mcp_ready:
        tools_list = getattr(request.app.state, "tools_list", [])
        if not tools_list:
            tools_list = await mcp_client.get_all_tools()
            request.app.state.tools_list = tools_list
    else:
        # Degrade gracefully while MCP initializes: chat still works without MCP tools.
        log.warning("MCP client not ready, creating workflow without MCP tools")
        use_cache = False

    from backend.services.mcp_tool_contributions import (
        refresh_mcp_tool_contributions,
    )

    refresh_mcp_tool_contributions(tools_list, mcp_client)
    ai_cfg, agent_data, runtime_capabilities = prepare_agent_runtime(
        agent_id,
        vault_path=vault_path,
        active_skill_ids=active_skill_ids,
    )
    runtime_active_ids = list(
        getattr(runtime_capabilities, "active_skill_ids", ()) or ()
    )
    catalog_revision = str(
        getattr(runtime_capabilities, "catalog_revision", "") or ""
    )
    agent_revision = hashlib.sha256(
        json.dumps(
            agent_data or {},
            sort_keys=True,
            separators=(",", ":"),
            default=str,
        ).encode("utf-8")
    ).hexdigest()[:16]
    runtime_revision = hashlib.sha256(
        json.dumps(
            {
                "active_skill_ids": runtime_active_ids,
                "catalog_revision": catalog_revision,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()[:16]
    cache_key = (
        f"{vault_scope}:{agent_id}:{agent_revision}:{runtime_revision}"
    )
    if use_cache and cache_key in request.app.state.agent_cache:
        cached = request.app.state.agent_cache[cache_key]
        return cached["workflow"], cached.get("llm_selection", {})

    workflow, llm_selection = await create_agent_workflow(
        tools_list,
        mcp_client,
        agent_id=agent_id,
        llm_mode=llm_mode,
        llm_provider=llm_provider,
        llm_model=llm_model,
        user_message=user_message,
        timeout=60,
        active_skill_ids=active_skill_ids,
        vault_path=vault_path,
        prepared_ai_cfg=ai_cfg,
        prepared_agent_data=agent_data,
        runtime_capabilities=runtime_capabilities,
    )

    if workflow is None:
        if llm_mode == "agent_default":
            raise HTTPException(status_code=503, detail={"code": "agent_model_unavailable"})
        raise HTTPException(status_code=503, detail="No LLM provider available")

    if use_cache:
        cache_prefix = f"{vault_scope}:{agent_id}:"
        for stale_key in tuple(request.app.state.agent_cache):
            if stale_key.startswith(cache_prefix) and stale_key != cache_key:
                request.app.state.agent_cache.pop(stale_key, None)
        request.app.state.agent_cache[cache_key] = {
            "workflow": workflow,
            "llm_selection": llm_selection,
        }

    return workflow, llm_selection


@router.post("/chat/attachments", dependencies=[Depends(require_role("editor"))])
async def upload_chat_attachment(file: UploadFile = File(...)):
    """Store one bounded chat attachment inside the active Vault."""
    vault, _ = _vault_scope()
    _cleanup_expired_attachments(vault)
    original_name = Path(file.filename or "attachment").name
    suffix = Path(original_name).suffix.lower()
    if suffix not in CHAT_ATTACHMENT_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported chat attachment type")
    content = await file.read(MAX_ATTACHMENT_BYTES + 1)
    if not content:
        raise HTTPException(status_code=422, detail="Chat attachment is empty")
    if len(content) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=413, detail="Chat attachment exceeds 15 MB")

    root = _attachment_root(vault)
    root.mkdir(parents=True, exist_ok=True)
    target = root / f"{uuid.uuid4().hex}{suffix}"
    target.write_bytes(content)
    return {
        "name": original_name,
        "size": len(content),
        "type": file.content_type or "",
        "path": str(target.relative_to(vault)),
    }


@router.delete("/chat/attachments", dependencies=[Depends(require_role("editor"))])
async def delete_chat_attachment(delete_req: AttachmentDeleteRequest):
    """Delete an abandoned chat upload from the active Vault."""
    vault, _ = _vault_scope()
    _delete_attachment(vault, delete_req.path)
    return {"deleted": True}


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


def _raise_confirmation_error(error: Exception) -> None:
    if isinstance(error, LookupError):
        raise HTTPException(status_code=404, detail="Pending action not found")
    if isinstance(error, PermissionError):
        raise HTTPException(
            status_code=403,
            detail="Pending action belongs to another chat scope",
        )
    if isinstance(error, TimeoutError):
        raise HTTPException(status_code=410, detail="Pending action expired")
    if isinstance(error, RuntimeError):
        raise HTTPException(status_code=409, detail="Pending action is unavailable")
    raise error


@router.post("/chat/confirmations/{action_id}/confirm")
async def confirm_agent_action(
    action_id: str,
    payload: ActionConfirmationRequest,
    workspace_context: WorkspaceContext = Depends(require_role("editor")),
):
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
        raise HTTPException(status_code=403, detail="Administrator permission required")

    try:
        result = await execute_confirmed_action(
            pending["action"],
            pending["arguments"],
            workspace_id=workspace_context.workspace_id,
        )
    except Exception as error:
        await asyncio.to_thread(
            finish_confirmation,
            safe_action_id,
            error=safe_error_detail(error, context="confirm agent action"),
        )
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(error, context="confirm agent action"),
        )

    await asyncio.to_thread(
        finish_confirmation,
        safe_action_id,
        result=result,
    )
    return {
        "status": "completed",
        "confirmation_id": safe_action_id,
        "action": pending["action"],
        "result_status": (
            str(result.get("status") or "")
            if isinstance(result, dict)
            else ""
        ),
    }


@router.post("/chat/confirmations/{action_id}/cancel")
async def cancel_agent_action(
    action_id: str,
    payload: ActionConfirmationRequest,
    workspace_context: WorkspaceContext = Depends(require_role("editor")),
):
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
        raise HTTPException(status_code=409, detail="Pending action is unavailable")
    return {"status": "cancelled", "confirmation_id": safe_action_id}


@router.delete(
    "/chat/sessions/{agent_id}/{session_id}",
    dependencies=[Depends(require_role("editor"))],
)
async def delete_chat_session(agent_id: str, session_id: str):
    """Remove the persisted LangGraph checkpoints for one scoped chat thread."""
    safe_agent_id = _validated_identifier(agent_id, "agent_id")
    safe_session_id = _validated_identifier(session_id, "session_id")
    _vault, vault_scope = _vault_scope()
    thread_id = hashlib.sha256(
        f"{vault_scope}:{safe_agent_id}:{safe_session_id}".encode("utf-8")
    ).hexdigest()
    checkpoint_key = hashlib.sha256(
        f"{vault_scope}:{safe_agent_id}".encode("utf-8")
    ).hexdigest()[:32]
    db_path = cfg.paths["CHECKPOINTS"] / f"agent_{checkpoint_key}.sqlite"
    if db_path.exists():
        async with _thread_lock(thread_id):
            async with AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
                await saver.adelete_thread(thread_id)
    return {"deleted": True}


@router.get("/ai/model-reliability")
async def model_reliability(window_days: int = 30):
    """Recorded failures per model, by reason.

    Evidence for the UI, not a policy: nothing here disables or reroutes a
    model — the user reads it and decides.
    """
    return {"window_days": window_days, "models": reliability_report(window_days)}


@router.get("/agent/context-sources")
async def list_context_sources():
    """Catalogue of large external sources an agent can attach to its context.

    These are queried through their own API, never crawled — see directive
    `agent_context_sources.md`.
    """
    from backend.agent.context_sources import list_sources
    return list_sources()


@router.post("/chat")
async def chat_endpoint(
    request: Request,
    chat_req: ChatRequest,
    workspace_context: WorkspaceContext = Depends(require_role("editor")),
):
    """
    Main endpoint for chatting with a specific agent.
    """
    try:
        agent_id = _validated_identifier(chat_req.agent_id, "agent_id")
        session_id = _validated_identifier(chat_req.session_id, "session_id")
        requested_skill_ids = _validated_skill_ids(chat_req.active_skill_ids)
        confirmed_tool_ids = _validated_skill_ids(chat_req.confirmed_tool_ids) or []
        vault, vault_scope = _vault_scope()

        # 1. Build bounded attachment context and delete the temporary files
        # before provider selection. This cleanup therefore also covers model
        # configuration and workflow-construction failures.
        user_content = chat_req.message
        if chat_req.attachments:
            attachment_text = _consume_attachment_context(vault, chat_req.attachments)
            if attachment_text:
                user_content += "\n\nVerified attachment context:\n" + attachment_text
        if chat_req.mentions:
            mention_lines = []
            for mention in chat_req.mentions:
                mention_type = (mention.type or "").strip().lower()
                mention_id = (mention.id or "").strip()
                if not mention_type or not mention_id:
                    continue
                mention_label = (mention.label or "").strip() or mention_id
                mention_lines.append(f"- {mention_type}: {mention_label} (id: {mention_id})")

            if mention_lines:
                user_content += "\n\nSelected mentions context:\n" + "\n".join(mention_lines)

        # 2. Get the workflow only after request-owned uploads are cleaned up.
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
        )

        authorized_tool_names = _explicit_brain_write_tool_names(
            chat_req.message,
        )
        authorized_tool_names.update(
            (llm_selection or {}).get("turn_grant_tool_names") or [],
        )
        confirmed_tool_id_set = set(confirmed_tool_ids)
        authorized_tool_names.update(
            item.get("name")
            for item in (llm_selection or {}).get("tools", [])
            if item.get("id") in confirmed_tool_id_set
            and item.get("name")
        )
        inputs = {
            "messages": [HumanMessage(content=user_content)],
            # Always overwrite these request-scoped channels, including with
            # empty lists, so checkpoint state from a previous turn cannot
            # retain authorization or activation.
            "turn_authorized_tool_names": sorted(authorized_tool_names),
            "active_skill_ids": list(
                (llm_selection or {}).get("active_skill_ids") or [],
            ),
            "current_user_role": workspace_context.role,
        }
        
        # 3. Configure memory thread (per agent + session)
        thread_id = hashlib.sha256(
            f"{vault_scope}:{agent_id}:{session_id}".encode("utf-8")
        ).hexdigest()
        config = {
            "configurable": {"thread_id": thread_id},
            "recursion_limit": 12,
        }
        turn_lock = _thread_lock(thread_id)
        
        # 4. Persistence setup
        checkpoint_key = hashlib.sha256(
            f"{vault_scope}:{agent_id}".encode("utf-8")
        ).hexdigest()[:32]
        db_path = cfg.paths["CHECKPOINTS"] / f"agent_{checkpoint_key}.sqlite"
        os.makedirs(db_path.parent, exist_ok=True)
        
        async def event_generator():
            answer_count = 0
            confirmation_token = bind_confirmation_context(
                vault_scope=vault_scope,
                workspace_id=workspace_context.workspace_id,
                user_id=workspace_context.user_id,
                role=workspace_context.role,
                agent_id=agent_id,
                session_id=session_id,
            )
            try:
                if llm_selection:
                    yield json.dumps({
                        "type": "llm_selected",
                        "mode": llm_selection.get("mode") or chat_req.llm_mode,
                        "provider": llm_selection.get("provider"),
                        "model": llm_selection.get("model"),
                    }) + "\n"
                    yield json.dumps({
                        "type": "agent_runtime",
                        "assigned_skill_ids": list(
                            llm_selection.get("assigned_skill_ids") or [],
                        ),
                        "active_skill_ids": list(
                            llm_selection.get("active_skill_ids") or [],
                        ),
                        "missing_skill_ids": list(
                            llm_selection.get("missing_skill_ids") or [],
                        ),
                        "unavailable_tool_ids": list(
                            llm_selection.get("unavailable_tool_ids") or [],
                        ),
                        "catalog_revision": llm_selection.get(
                            "catalog_revision",
                        ) or "",
                    }) + "\n"

                # Spend ledger: every AIMessage in the stream carries
                # usage_metadata; accumulate and record once per turn.
                total_in_tok = 0
                total_out_tok = 0
                tool_metadata_by_name = {
                    item.get("name"): item
                    for item in (llm_selection or {}).get("tools", [])
                    if item.get("name")
                }
                async with asyncio.timeout(TURN_TIMEOUT_SECONDS):
                    async with turn_lock:
                        async with AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
                            agent_app = workflow.compile(checkpointer=saver)
                            async for event in agent_app.astream(
                                inputs,
                                config=config,
                                stream_mode="updates",
                            ):
                                if await request.is_disconnected():
                                    return
                                for node_name, state_update in event.items():
                                    for msg in state_update.get("messages", []):
                                        turn_usage = usage_from_message(msg)
                                        if turn_usage:
                                            total_in_tok += turn_usage[0]
                                            total_out_tok += turn_usage[1]

                                        tool_calls = getattr(msg, "tool_calls", None) or []
                                        if tool_calls:
                                            for tool_call in tool_calls:
                                                yield _tool_stream_event(
                                                    "tool_start",
                                                    tool_call.get("name"),
                                                    node_name,
                                                    tool_metadata_by_name.get(
                                                        tool_call.get("name"),
                                                    ),
                                                )
                                            continue

                                        content = _message_text(getattr(msg, "content", ""))
                                        if msg.type == "tool":
                                            yield _tool_stream_event(
                                                "tool_end",
                                                msg.name,
                                                node_name,
                                                tool_metadata_by_name.get(
                                                    msg.name,
                                                ),
                                            )
                                            pending_confirmation = confirmation_event(
                                                content,
                                            )
                                            if pending_confirmation:
                                                answer_count += 1
                                                yield json.dumps(
                                                    pending_confirmation,
                                                    ensure_ascii=False,
                                                ) + "\n"
                                        elif msg.type == "ai" and content:
                                            answer_count += 1
                                            yield json.dumps({
                                                "type": "message",
                                                "role": "ai",
                                                "content": content,
                                                "node": node_name,
                                            }) + "\n"

                if total_in_tok or total_out_tok:
                    # to_thread: the ledger does file I/O under a lock
                    await asyncio.to_thread(
                        record_llm_usage,
                        (llm_selection or {}).get("provider"),
                        (llm_selection or {}).get("model"),
                        total_in_tok,
                        total_out_tok,
                    )
                yield json.dumps({
                    "type": "done",
                    "has_response": answer_count > 0,
                    "message_count": answer_count,
                }) + "\n"

            except Exception as e:
                error_str = str(e)
                log.error(f"Error in event_generator: {error_str}")

                # Record the failure against the model that was actually used, and
                # classify it: the REASON decides whether this is evidence about
                # the model or about the account (a 402 says nothing about the
                # model's abilities). See `model_reliability`.
                provider = (llm_selection or {}).get("provider")
                model_id = (llm_selection or {}).get("model")
                reason = record_failure(provider, model_id, e)

                if reason and reason in FAILURE_MESSAGES:
                    friendly_error = FAILURE_MESSAGES[reason]
                    if blames_the_model(reason):
                        evidence = model_evidence(provider, model_id)
                        repeats = (evidence or {}).get("reasons", {}).get(reason, 0)
                        if repeats > 1:
                            friendly_error += (
                                f" This model has already failed {repeats} times for "
                                "the same reason this month; consider changing it."
                            )
                elif not error_str:
                    friendly_error = "An unexpected agent error occurred."
                else:
                    friendly_error = safe_error_detail(e, context="POST /api/agent/chat event_generator")

                yield json.dumps({"type": "error", "content": friendly_error}) + "\n"
                yield json.dumps({
                    "type": "done",
                    "has_response": True,
                    "message_count": 1,
                }) + "\n"
            finally:
                reset_confirmation_context(confirmation_token)
        return StreamingResponse(event_generator(), media_type="application/x-ndjson")

    except HTTPException as e:
        if e.status_code == 503:
            error_code = (
                e.detail.get("code")
                if isinstance(e.detail, dict)
                else "service_unavailable"
            )

            async def unavailable_generator():
                yield json.dumps({
                    "type": "error",
                    "code": error_code,
                    "content": error_code,
                }) + "\n"
                yield json.dumps({
                    "type": "done",
                    "has_response": True,
                    "message_count": 1,
                }) + "\n"
            return StreamingResponse(
                unavailable_generator(),
                media_type="application/x-ndjson",
                status_code=200,
            )
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e, context="POST /api/agent/chat"))
