from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage
import json
import asyncio
import logging
import os
from backend.agent.factory import create_agent_workflow
from backend.agent.model_router import record_llm_usage, usage_from_message
from backend.agent.model_reliability import (
    blames_the_model, model_evidence, record_failure, reliability_report,
)
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from backend.config.app_config import load_params
from backend.utils.errors import safe_error_detail
from backend.services.workspace_service import require_role

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

class ChatRequest(BaseModel):
    message: str
    agent_id: str = "gnosy" # Default agent
    session_id: str = "default"
    history: List[Dict[str, Any]] = []
    llm_mode: str = "auto"  # auto | manual | agent_default
    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None
    mentions: List[MentionRef] = []

async def get_agent_workflow(
    request: Request,
    agent_id: str,
    llm_mode: str = "agent_default",
    llm_provider: Optional[str] = None,
    llm_model: Optional[str] = None,
    user_message: str = "",
):
    """
    Helper to get or build the agent workflow for a specific ID.
    Caches the StateGraph in app.state.agent_cache.
    """
    use_cache = llm_mode == "agent_default" and not llm_provider and not llm_model

    if not hasattr(request.app.state, "agent_cache"):
        request.app.state.agent_cache = {}

    if use_cache and agent_id in request.app.state.agent_cache:
        cached = request.app.state.agent_cache[agent_id]
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
    )

    if workflow is None:
        raise HTTPException(status_code=503, detail="No LLM provider available")

    if use_cache:
        request.app.state.agent_cache[agent_id] = {
            "workflow": workflow,
            "llm_selection": llm_selection,
        }

    return workflow, llm_selection


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
        # 1. Get dynamic agent workflow
        workflow, llm_selection = await get_agent_workflow(
            request,
            chat_req.agent_id,
            llm_mode=chat_req.llm_mode,
            llm_provider=chat_req.llm_provider,
            llm_model=chat_req.llm_model,
            user_message=chat_req.message,
        )
        
        # 2. Construct initial state
        user_content = chat_req.message
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
        config = {"configurable": {"thread_id": f"{chat_req.agent_id}_{chat_req.session_id}"}}
        
        # 4. Persistence setup
        db_path = cfg.paths["CHECKPOINTS"] / f"agent_{chat_req.agent_id}.sqlite"
        os.makedirs(db_path.parent, exist_ok=True)
        
        async def event_generator():
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

        return StreamingResponse(event_generator(), media_type="application/x-ndjson")

    except HTTPException as e:
        if e.status_code == 503:
            error_detail = str(e.detail or "Service unavailable")

            async def unavailable_generator():
                yield json.dumps({
                    "type": "error",
                    "content": error_detail,
                }) + "\n"

            return StreamingResponse(
                unavailable_generator(),
                media_type="application/x-ndjson",
                status_code=200,
            )
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e, context="POST /api/agent/chat"))
