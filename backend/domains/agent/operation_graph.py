"""Structured operations with optional governed read tools."""
from __future__ import annotations

from typing import Any

from langchain_core.messages import SystemMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import ToolNode

from backend.domains.agent.policy import AgentState, _invoke_agent_model
from backend.domains.agent.team_help import HELP_TOOL, TeamHelp, requested_help, can_request_help


def is_read_tool(descriptor: Any) -> bool:
    effects = {str(getattr(effect, "value", effect)) for effect in descriptor.effects}
    return bool(effects) and effects.issubset({"read", "external_read", "personal_data"})


def operation_workflow(model: Any, instructions: str, context_window: int, *, team_help: TeamHelp | None = None,
                       output_schema: dict[str, Any] | None = None, provider: str = "",
                       runtime: Any = None, max_output_tokens: int | None = None,
                       default_reasoning_effort: str | None = None) -> StateGraph[Any, None, Any, Any]:
    from backend.services.agent_tool_identity import runtime_tool_name
    from backend.domains.agent.policy import _tool_policy_wrapper
    pairs = [(descriptor, tool) for descriptor, tool in zip(runtime.tool_descriptors, runtime.tools, strict=True)
             if is_read_tool(descriptor)] if runtime is not None else []
    tools = [tool for _, tool in pairs]
    names = [runtime_tool_name(tool) for tool in tools]
    if any(not name for name in names) or len(set(names)) != len(names):
        raise ValueError("agent_operation_tool_identity_invalid")
    policies = {runtime_tool_name(tool): {
        "id": descriptor.id, "minimum_role": descriptor.minimum_role,
        "confirmation": str(getattr(descriptor.confirmation, "value", descriptor.confirmation)),
        "effects": [str(getattr(effect, "value", effect)) for effect in descriptor.effects],
        "timeout_seconds": descriptor.metadata.get("timeout_seconds", 120), "_descriptor": descriptor,
    } for descriptor, tool in pairs}
    help_tool = HELP_TOOL
    if provider == "openrouter" and output_schema is not None:
        help_tool = {**HELP_TOOL, "function": {**HELP_TOOL["function"], "strict": True}}
    # The Responses transport auto-parses structured operation output and
    # requires every accompanying function tool to declare a strict schema.
    binding = {"strict": True} if provider == "openrouter" and output_schema is not None else {}
    read_model = model.bind_tools(tools, **binding) if tools else model
    selected_model = model.bind_tools([*tools, help_tool], **binding) if team_help else read_model
    def execute(state: AgentState) -> dict[str, Any]:
        messages = [SystemMessage(content=instructions), *state["messages"]]
        from backend.services.agent_context_budget import OperationContextExceeded, messages_budget
        from backend.services.agent_execution_trace import record
        budget = messages_budget(messages, str(getattr(model, "model_name", "") or getattr(model, "model", "")), context_window)
        record("context.budget", budget)
        if not budget["fits"]:
            raise OperationContextExceeded()
        active_model = selected_model if can_request_help(state) else read_model
        from backend.domains.agent.structured_output import constrain_output, constrain_default_reasoning
        from backend.agent.json_tool_model import JsonToolModel
        # Native tool selection must remain a function-call turn. JSON-only
        # answer formatting makes some providers describe a call as text
        # instead of executing it. The final operation contract is validated
        # and repaired by execute_operation; the JSON fallback has its own
        # outer transport contract.
        if not tools or isinstance(active_model, JsonToolModel):
            active_model = constrain_output(active_model, provider, output_schema)
        if max_output_tokens is not None:
            active_model = active_model.bind(max_tokens=max_output_tokens)
        active_model = constrain_default_reasoning(active_model, provider, default_reasoning_effort)
        return {"messages": [_invoke_agent_model(active_model, messages, state)]}

    graph: StateGraph[Any, None, Any, Any] = StateGraph(AgentState)
    graph.add_node("agent_operation", execute)
    graph.add_edge(START, "agent_operation")
    if tools:
        tool_node = ToolNode(tools, wrap_tool_call=_tool_policy_wrapper(policies), handle_tool_errors=False)
        async def execute_tools(state: AgentState, config: RunnableConfig) -> dict[str, Any]:
            result = await tool_node.ainvoke(state, config)
            if any(getattr(message, "status", "") == "error" for message in result["messages"]):
                raise RuntimeError("agent_operation_tool_failed")
            return dict(result)
        graph.add_node("operation_tools", execute_tools)
        graph.add_edge("operation_tools", "agent_operation")
    if team_help:
        graph.add_node("team_help", team_help.execute)
        graph.add_edge("team_help", END)
    def route(state: AgentState) -> str:
        if team_help and requested_help(state):
            return "team_help"
        calls = getattr(state["messages"][-1], "tool_calls", None) or []
        if calls:
            if not tools or any(call.get("name") not in policies for call in calls):
                raise PermissionError("agent_operation_tool_unassigned")
            return "operation_tools"
        return END
    graph.add_conditional_edges("agent_operation", route)
    return graph
