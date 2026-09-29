"""Structured, tool-free phases of the canonical agent workflow."""
from __future__ import annotations

from typing import Any

from langchain_core.messages import SystemMessage
from langgraph.graph import END, START, StateGraph

from backend.domains.agent.policy import AgentState, _invoke_agent_model
from backend.domains.agent.team_help import HELP_TOOL, TeamHelp, requested_help, can_request_help


def operation_workflow(model: Any, instructions: str, context_window: int, *, team_help: TeamHelp | None = None,
                       output_schema: dict[str, Any] | None = None, provider: str = "") -> StateGraph[Any, None, Any, Any]:
    help_tool = HELP_TOOL
    if provider == "openrouter" and output_schema is not None:
        help_tool = {**HELP_TOOL, "function": {**HELP_TOOL["function"], "strict": True}}
    selected_model = model.bind_tools([help_tool]) if team_help else model
    def execute(state: AgentState) -> dict[str, Any]:
        messages = [SystemMessage(content=instructions), *state["messages"]]
        from backend.services.agent_context_budget import OperationContextExceeded, messages_budget
        from backend.services.agent_execution_trace import record
        budget = messages_budget(messages, str(getattr(model, "model_name", "") or getattr(model, "model", "")), context_window)
        record("context.budget", budget)
        if not budget["fits"]:
            raise OperationContextExceeded()
        active_model = selected_model if can_request_help(state) else model
        from backend.domains.agent.structured_output import constrain_output
        active_model = constrain_output(active_model, provider, output_schema)
        return {"messages": [_invoke_agent_model(active_model, messages, state)]}

    graph: StateGraph[Any, None, Any, Any] = StateGraph(AgentState)
    graph.add_node("agent_operation", execute)
    graph.add_edge(START, "agent_operation")
    if team_help:
        graph.add_node("team_help", team_help.execute)
        graph.add_conditional_edges("agent_operation", lambda state: "team_help" if requested_help(state) else END)
        graph.add_edge("team_help", END)
    else:
        graph.add_edge("agent_operation", END)
    return graph
