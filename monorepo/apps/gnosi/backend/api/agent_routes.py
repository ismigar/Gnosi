from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import List, Dict, Any
from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage
import json
import asyncio

router = APIRouter()

class ChatRequest(BaseModel):
    message: str
    session_id: str = "default" # Session ID for memory
    history: List[Dict[str, Any]] = [] 

@router.post("/chat")
async def chat_endpoint(request: Request, chat_req: ChatRequest):
    """
    Main endpoint for chatting with the agent.
    """
    try:
        # Retrieve graph from state
        if not hasattr(request.app.state, "agent_app"):
             raise HTTPException(status_code=503, detail="Agent not ready (MCP initialization failed?)")
        
        agent_app = request.app.state.agent_app
        
        # Construct initial state
        inputs = {"messages": [HumanMessage(content=chat_req.message)]}
        
        # Configure memory thread
        config = {"configurable": {"thread_id": chat_req.session_id}}
        
        async def event_generator():
            try:
                # Run the graph with config (thread_id)
                async for event in agent_app.astream(inputs, config=config):
                    for node_name, state_update in event.items():
                        if "messages" in state_update:
                            messages = state_update["messages"]
                            # Multiple messages may come, iterate just in case
                            # Normally langgraph returns the last one added in "updates" mode
                            for msg in messages:
                                # 1. AI Message (Thinking or Tool Call)
                                if msg.type == "ai":
                                    if msg.tool_calls:
                                        for tool_call in msg.tool_calls:
                                            payload = {
                                                "type": "tool_start",
                                                "tool": tool_call["name"],
                                                "input": tool_call["args"]
                                            }
                                            yield json.dumps(payload) + "\n"
                                    
                                    if msg.content:
                                        payload = {
                                            "type": "thought",
                                            "content": msg.content
                                        }
                                        yield json.dumps(payload) + "\n"
                                
                                # 2. Tool Output
                                elif msg.type == "tool":
                                    payload = {
                                        "type": "tool_end",
                                        "tool": msg.name,
                                        "output": msg.content
                                    }
                                    yield json.dumps(payload) + "\n"
                                
                                # General Message (fallback)
                                payload = {
                                    "type": "message",
                                    "role": msg.type,
                                    "content": msg.content
                                }
                                yield json.dumps(payload) + "\n"

            except Exception as e:
                yield json.dumps({"type": "error", "content": str(e)}) + "\n"

        return StreamingResponse(event_generator(), media_type="application/x-ndjson")

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
