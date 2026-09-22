"""Structured, tool-free phases of the canonical agent workflow."""
from __future__ import annotations

from typing import Any

from langchain_core.messages import SystemMessage
from langgraph.graph import END, START, StateGraph

from backend.domains.agent.policy import AgentState, _invoke_agent_model


def operation_workflow(model: Any, instructions: str, context_window: int) -> StateGraph[Any, None, Any, Any]:
    def execute(state: AgentState) -> dict[str, Any]:
        messages = [SystemMessage(content=instructions), *state["messages"]]
        size = sum(len(str(message.content).encode("utf-8")) for message in messages)
        # Conservative bound: complete instructions and evidence are never truncated.
        if size + max(2048, context_window // 4) + 512 > context_window:
            raise RuntimeError("agent_operation_context_exceeded")
        return {"messages": [_invoke_agent_model(model, messages, state)]}

    graph: StateGraph[Any, None, Any, Any] = StateGraph(AgentState)
    graph.add_node("agent_operation", execute)
    graph.add_edge(START, "agent_operation")
    graph.add_edge("agent_operation", END)
    return graph
