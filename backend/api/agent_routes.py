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
from pathlib import Path
from backend.agent.factory import create_agent_workflow
from backend.agent.model_router import record_llm_usage, usage_from_message
from backend.agent.model_reliability import (
    blames_the_model, model_evidence, record_failure, reliability_report,
)
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from backend.config.app_config import load_params
from backend.utils.errors import safe_error_detail
from backend.services.workspace_service import require_role
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
    type: str
    id: str
    label: Optional[str] = None

class AttachmentRef(BaseModel):
    name: str
    size: int = 0
    type: str = ""
    path: str

class ChatRequest(BaseModel):
    message: str
    agent_id: str = "gnosy" # Default agent
    session_id: str = "default"
    history: List[Dict[str, Any]] = Field(default_factory=list)
    llm_mode: str = "agent_default"  # auto | manual | agent_default
    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None
    mentions: List[MentionRef] = Field(default_factory=list)
    attachments: List[AttachmentRef] = Field(default_factory=list)


IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")
MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024
MAX_ATTACHMENT_TEXT = 20_000
CHAT_ATTACHMENT_TYPES = {
    ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".yaml", ".yml",
    ".xml", ".html", ".css", ".js", ".jsx", ".ts", ".tsx", ".py", ".pdf",
    ".png", ".jpg", ".jpeg", ".webp", ".gif",
}


def _validated_identifier(value: str, label: str) -> str:
    candidate = (value or "").strip()
    if not IDENTIFIER_RE.fullmatch(candidate):
        raise HTTPException(status_code=422, detail=f"Invalid {label}")
    return candidate


def _vault_scope() -> tuple[Path, str]:
    vault = Path(get_active_vault_path()).resolve()
    digest = hashlib.sha256(str(vault).encode("utf-8")).hexdigest()[:20]
    return vault, digest


def _attachment_root(vault: Path) -> Path:
    root = (vault / ".gnosi" / "chat-attachments").resolve()
    if root != vault and vault not in root.parents:
        raise HTTPException(status_code=400, detail="Invalid attachment directory")
    return root


def _attachment_context(vault: Path, refs: List[AttachmentRef]) -> str:
    root = _attachment_root(vault)
    sections = []
    for ref in refs:
        relative = Path(ref.path)
        target = (vault / relative).resolve()
        if target == vault or vault not in target.parents or root not in target.parents:
            raise HTTPException(status_code=422, detail="Invalid attachment path")
        if not target.is_file() or target.stat().st_size > MAX_ATTACHMENT_BYTES:
            raise HTTPException(status_code=422, detail="Attachment is missing or too large")

        suffix = target.suffix.lower()
        text = ""
        if suffix == ".pdf":
            try:
                from pypdf import PdfReader
                text = "\n".join((page.extract_text() or "") for page in PdfReader(str(target)).pages)
            except Exception as exc:
                log.warning("Could not extract chat PDF attachment %s: %s", target.name, exc)
        elif suffix not in {".png", ".jpg", ".jpeg", ".webp", ".gif"}:
            text = target.read_text(encoding="utf-8", errors="replace")

        if text.strip():
            sections.append(f"Attachment: {ref.name}\n{text[:MAX_ATTACHMENT_TEXT]}")
        else:
            sections.append(
                f"Attachment: {ref.name}\n"
                "(No text could be extracted. Do not claim to have inspected its visual content.)"
            )
    return "\n\n".join(sections)

async def get_agent_workflow(
    request: Request,
    agent_id: str,
    llm_mode: str = "agent_default",
    llm_provider: Optional[str] = None,
    llm_model: Optional[str] = None,
    user_message: str = "",
    vault_scope: str = "",
):
    """
    Helper to get or build the agent workflow for a specific ID.
    Caches the StateGraph in app.state.agent_cache.
    """
    use_cache = llm_mode == "agent_default" and not llm_provider and not llm_model

    if not hasattr(request.app.state, "agent_cache"):
        request.app.state.agent_cache = {}

    cache_key = f"{vault_scope}:{agent_id}"
    if use_cache and cache_key in request.app.state.agent_cache:
        cached = request.app.state.agent_cache[cache_key]
        return cached["workflow"], cached.get("llm_selection", {})

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

    workflow, llm_selection = await create_agent_workflow(
        tools_list,
        mcp_client,
        agent_id=agent_id,
        llm_mode=llm_mode,
        llm_provider=llm_provider,
        llm_model=llm_model,
        user_message=user_message,
        timeout=60,
    )

    if workflow is None:
        if llm_mode == "agent_default":
            raise HTTPException(status_code=503, detail={"code": "agent_model_unavailable"})
        raise HTTPException(status_code=503, detail="No LLM provider available")

    if use_cache:
        request.app.state.agent_cache[cache_key] = {
            "workflow": workflow,
            "llm_selection": llm_selection,
        }

    return workflow, llm_selection


@router.post("/chat/attachments", dependencies=[Depends(require_role("editor"))])
async def upload_chat_attachment(file: UploadFile = File(...)):
    """Store one bounded chat attachment inside the active Vault."""
    vault, _ = _vault_scope()
    original_name = Path(file.filename or "attachment").name
    suffix = Path(original_name).suffix.lower()
    if suffix not in CHAT_ATTACHMENT_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported chat attachment type")
    content = await file.read(MAX_ATTACHMENT_BYTES + 1)
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


@router.post("/chat", dependencies=[Depends(require_role("editor"))])
async def chat_endpoint(request: Request, chat_req: ChatRequest):
    """
    Main endpoint for chatting with a specific agent.
    """
    try:
        agent_id = _validated_identifier(chat_req.agent_id, "agent_id")
        session_id = _validated_identifier(chat_req.session_id, "session_id")
        vault, vault_scope = _vault_scope()
        # 1. Get dynamic agent workflow
        workflow, llm_selection = await get_agent_workflow(
            request,
            agent_id,
            llm_mode=chat_req.llm_mode,
            llm_provider=chat_req.llm_provider,
            llm_model=chat_req.llm_model,
            user_message=chat_req.message,
            vault_scope=vault_scope,
        )
        
        # 2. Construct initial state
        user_content = chat_req.message
        if chat_req.attachments:
            attachment_text = _attachment_context(vault, chat_req.attachments)
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
                user_content += "\n\nContexto de menciones seleccionadas:\n" + "\n".join(mention_lines)

        inputs = {"messages": [HumanMessage(content=user_content)]}
        
        # 3. Configure memory thread (per agent + session)
        thread_id = hashlib.sha256(
            f"{vault_scope}:{agent_id}:{session_id}".encode("utf-8")
        ).hexdigest()
        config = {"configurable": {"thread_id": thread_id}}
        
        # 4. Persistence setup
        checkpoint_key = hashlib.sha256(
            f"{vault_scope}:{agent_id}".encode("utf-8")
        ).hexdigest()[:32]
        db_path = cfg.paths["CHECKPOINTS"] / f"agent_{checkpoint_key}.sqlite"
        os.makedirs(db_path.parent, exist_ok=True)
        
        async def event_generator():
            visible_responses = 0
            try:
                if llm_selection:
                    yield json.dumps({
                        "type": "llm_selected",
                        "mode": llm_selection.get("mode") or chat_req.llm_mode,
                        "provider": llm_selection.get("provider"),
                        "model": llm_selection.get("model"),
                    }) + "\n"

                # Spend ledger: every AIMessage in the stream carries
                # usage_metadata; accumulate and record once per turn.
                total_in_tok = 0
                total_out_tok = 0
                async with AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
                    agent_app = workflow.compile(checkpointer=saver)
                    async for event in agent_app.astream(inputs, config=config, stream_mode="updates"):
                        for node_name, state_update in event.items():
                            if "messages" in state_update:
                                messages = state_update["messages"]
                                for msg in messages:
                                    turn_usage = usage_from_message(msg)
                                    if turn_usage:
                                        total_in_tok += turn_usage[0]
                                        total_out_tok += turn_usage[1]
                                    # Determine the type of content to send to the frontend
                                    payload = {
                                        "type": "message",
                                        "role": "ai" if msg.type == "ai" else "user",
                                        "content": msg.content,
                                        "node": node_name
                                    }
                                    
                                    if hasattr(msg, "tool_calls") and msg.tool_calls:
                                        payload["type"] = "tool_start"
                                        payload["tool"] = msg.tool_calls[0]["name"]
                                        payload["input"] = msg.tool_calls[0]["args"]
                                    elif msg.type == "tool":
                                        payload["type"] = "tool_end"
                                        payload["tool"] = msg.name
                                        payload["output"] = msg.content
                                    elif node_name == "general" or node_name == "supervisor":
                                        payload["type"] = "message"
                                    
                                    if payload["content"] or payload["type"] != "message":
                                        if payload["type"] in {"message", "tool_start", "tool_end"}:
                                            visible_responses += 1
                                        yield json.dumps(payload) + "\n"

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
                    "has_response": visible_responses > 0,
                    "message_count": visible_responses,
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

        return StreamingResponse(event_generator(), media_type="application/x-ndjson")

    except HTTPException as e:
        if e.status_code == 503:
            error_detail = str(e.detail or "Service unavailable")

            async def unavailable_generator():
                yield json.dumps({
                    "type": "error",
                    "content": error_detail,
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
