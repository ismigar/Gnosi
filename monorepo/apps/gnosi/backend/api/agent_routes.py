from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage
import json
import asyncio
import logging
import os
from backend.agent.factory import create_agent_workflow
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from backend.config.app_config import load_params

cfg = load_params()

log = logging.getLogger(__name__)
router = APIRouter()

class ChatRequest(BaseModel):
    message: str
    agent_id: str = "gnosy" # Default agent
    session_id: str = "default"
    history: List[Dict[str, Any]] = []

async def get_agent_workflow(request: Request, agent_id: str):
    """
    Helper to get or build the agent workflow for a specific ID.
    Caches the StateGraph in app.state.agent_cache.
    """
    if not hasattr(request.app.state, "agent_cache"):
        request.app.state.agent_cache = {}
    
    if agent_id not in request.app.state.agent_cache:
        if not hasattr(request.app.state, "mcp_client"):
             raise HTTPException(status_code=503, detail="MCP Client not ready")
        
        tools_list = getattr(request.app.state, "tools_list", [])
        if not tools_list:
            tools_list = await request.app.state.mcp_client.get_all_tools()
            request.app.state.tools_list = tools_list

        workflow = await create_agent_workflow(tools_list, request.app.state.mcp_client, agent_id=agent_id)
        request.app.state.agent_cache[agent_id] = workflow
    
    return request.app.state.agent_cache[agent_id]


@router.post("/chat")
async def chat_endpoint(request: Request, chat_req: ChatRequest):
    """
    Main endpoint for chatting with a specific agent.
    """
    try:
        # 1. Get dynamic agent workflow
        workflow = await get_agent_workflow(request, chat_req.agent_id)
        
        # 2. Construct initial state
        inputs = {"messages": [HumanMessage(content=chat_req.message)]}
        
        # 3. Configure memory thread (per agent + session)
        config = {"configurable": {"thread_id": f"{chat_req.agent_id}_{chat_req.session_id}"}}
        
        # 4. Persistence setup
        db_path = cfg.paths["CHECKPOINTS"] / f"agent_{chat_req.agent_id}.sqlite"
        os.makedirs(db_path.parent, exist_ok=True)
        
        async def event_generator():
            try:
                async with AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
                    agent_app = workflow.compile(checkpointer=saver)
                    async for event in agent_app.astream(inputs, config=config, stream_mode="updates"):
                        for node_name, state_update in event.items():
                            if "messages" in state_update:
                                messages = state_update["messages"]
                                for msg in messages:
                                    # Determinar el tipus de contingut per enviar al frontend
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

            except Exception as e:
                yield json.dumps({"type": "error", "content": str(e)}) + "\n"

        return StreamingResponse(event_generator(), media_type="application/x-ndjson")

    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
