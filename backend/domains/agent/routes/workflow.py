import asyncio
import hashlib
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, cast

from fastapi import HTTPException, Request

from backend.agent.factory import create_agent_workflow, prepare_agent_runtime
from backend.domains.agent.routes.checkpoints import _ai_runtime_revision

log = logging.getLogger(__name__)


async def get_agent_workflow(  # noqa: C901 - bounded cache-key assembly
    request: Request,
    agent_id: str,
    llm_mode: str = "agent_default",
    llm_provider: Optional[str] = None,
    llm_model: Optional[str] = None,
    user_message: str = "",
    vault_scope: str = "",
    vault_path: Optional[Path] = None,
    active_skill_ids: Optional[List[str]] = None,
    turn_context_refs: Optional[List[Dict[str, Any]]] = None,
    memory_user_id: str = "",
) -> tuple[Any, Dict[str, Any]]:
    """
    Helper to get or build the agent workflow for a specific ID.
    Caches the StateGraph in app.state.agent_cache.
    """
    use_cache = llm_mode == "agent_default" and not llm_provider and not llm_model

    if not hasattr(request.app.state, "agent_cache"):
        request.app.state.agent_cache = {}

    mcp_client = getattr(request.app.state, "mcp_client", None)
    tools_list: list[Any] = []
    if mcp_client is not None:
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
    if turn_context_refs:
        from backend.agent.agent_context import (
            expand_dashboard_context_refs,
            merge_context_refs,
        )

        agent_data = dict(agent_data or {})
        agent_data["context_refs"] = expand_dashboard_context_refs(
            merge_context_refs(
                agent_data.get("context_refs") or [],
                turn_context_refs,
            ),
        )
    runtime_active_ids = list(getattr(runtime_capabilities, "active_skill_ids", ()) or ())
    catalog_revision = str(getattr(runtime_capabilities, "catalog_revision", "") or "")
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
                "ai_runtime_revision": _ai_runtime_revision(ai_cfg),
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()[:16]
    reviewed_memory_rows: list[dict[str, Any]] = []
    if memory_user_id:
        from backend.services.agent_personal_memory import search_memories

        reviewed_memory_rows = await asyncio.to_thread(
            search_memories,
            vault_path,
            agent_id,
            user_message,
            user_id=memory_user_id,
            limit=5,
        )
    memory_revision = hashlib.sha256(
        json.dumps(
            [
                {"memory_id": item.get("memory_id"), "revision": item.get("revision")}
                for item in reviewed_memory_rows
            ],
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()[:16]
    memory_principal = hashlib.sha256(str(memory_user_id or "").encode("utf-8")).hexdigest()[:12]
    cache_key = (
        f"{vault_scope}:{memory_principal}:{agent_id}:{agent_revision}:"
        f"{runtime_revision}:{memory_revision}"
    )
    if use_cache and cache_key in request.app.state.agent_cache:
        cached = request.app.state.agent_cache[cache_key]
        return cached["workflow"], cast(Dict[str, Any], cached.get("llm_selection", {}))

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
        memory_user_id=memory_user_id,
        reviewed_memory_rows=reviewed_memory_rows,
    )

    if workflow is None:
        if llm_mode == "agent_default":
            raise HTTPException(status_code=503, detail={"code": "agent_model_unavailable"})
        raise HTTPException(status_code=503, detail="No LLM provider available")

    if use_cache:
        cache_prefix = f"{vault_scope}:{memory_principal}:{agent_id}:"
        for stale_key in tuple(request.app.state.agent_cache):
            if stale_key.startswith(cache_prefix) and stale_key != cache_key:
                request.app.state.agent_cache.pop(stale_key, None)
        request.app.state.agent_cache[cache_key] = {
            "workflow": workflow,
            "llm_selection": llm_selection,
        }

    return workflow, llm_selection
