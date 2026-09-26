"""Structured, tool-free phases of the canonical agent workflow."""
from __future__ import annotations

from typing import Any

from langchain_core.messages import SystemMessage
from langgraph.graph import END, START, StateGraph

from backend.domains.agent.policy import AgentState, _invoke_agent_model


def operation_workflow(model: Any, instructions: str, context_window: int) -> StateGraph[Any, None, Any, Any]:
    def execute(state: AgentState) -> dict[str, Any]:
        messages = [SystemMessage(content=instructions), *state["messages"]]
        from backend.services.agent_context_budget import messages_budget
        from backend.services.agent_execution_trace import record
        budget = messages_budget(messages, str(getattr(model, "model_name", "") or getattr(model, "model", "")), context_window)
        record("context.budget", budget)
        if not budget["fits"]:
            raise RuntimeError("agent_operation_context_exceeded")
        return {"messages": [_invoke_agent_model(model, messages, state)]}

    graph: StateGraph[Any, None, Any, Any] = StateGraph(AgentState)
    graph.add_node("agent_operation", execute)
    graph.add_edge(START, "agent_operation")
    graph.add_edge("agent_operation", END)
    return graph
