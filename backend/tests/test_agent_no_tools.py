"""Explicit human tool restrictions override capability grants and context reads."""

import pytest

from backend.domains.agent.intent import _request_mode, request_disallows_tools
from backend.domains.agent.runtime_tools import _turn_model_tools
from backend.domains.agent.turn_planning import build_turn_plan


@pytest.mark.parametrize("message", [
    "No utilitzis eines. Resumeix les fonts següents.",
    "No utilices herramientas. Resume estas fuentes.",
    "Do not use tools. Summarize these sources.",
    "N’utilise aucun outil. Résume ces sources.",
    "Don't use any tools.",
    "N'utilise pas d'outils.",
])
def test_explicit_restriction_overrides_forced_reads_and_write_grants(message):
    assert request_disallows_tools(message)
    assert _request_mode(message) == "conversation"
    plan = build_turn_plan(
        message, mode="lookup", context_refs=[{"type": "notebook", "id": "qa"}],
        tool_metadata=[{"name": "search_context", "effects": ["read"]}],
        authorized_tool_names=["send_mail"], required_tool_name="search_context",
    )
    assert plan["required_tool"] is None
    assert plan["allowed_tool_names"] == []
    assert plan["budgets"]["max_tool_calls"] == 0
    assert plan["budgets"]["max_read_tool_results"] == 0
    assert _turn_model_tools(
        [object()], [], ["send_mail"], user_message=message,
        required_read_tool_names=["search_context"],
    ) == []


@pytest.mark.parametrize("message", [
    'Busca el document "No utilitzis eines".',
    'Find the note «Do not use tools».',
    'Explain the phrase `N’utilise aucun outil`.',
    'Utilitza eines per cercar les fonts.',
])
def test_quoted_material_does_not_restrict_tools(message):
    assert not request_disallows_tools(message)


def test_notebook_context_cannot_force_read_when_user_forbids_tools():
    from backend.domains.agent.workflow_nodes import AgentWorkflowNodes

    nodes = object.__new__(AgentWorkflowNodes)
    nodes.context_refs = [{"type": "notebook", "ref": "qa"}]
    nodes.context_tool_names = {"search_notebook_context"}
    route = nodes._context_route([], "No utilitzis eines. Resumeix les fonts.", "lookup")
    assert route.required_tool == ""
    assert route.inventory_arguments is None


@pytest.mark.parametrize("node_name", ["general_node", "coder_node"])
def test_specialists_never_bind_help_or_coder_tools_when_forbidden(monkeypatch, node_name):
    from langchain_core.messages import AIMessage, HumanMessage
    from backend.domains.agent import workflow_nodes

    nodes = object.__new__(workflow_nodes.AgentWorkflowNodes)
    nodes.llm = object()
    nodes.coder_llm = object()
    nodes.team_help = object()
    nodes.agent_name = "qa"
    nodes.combined_persona = ""
    nodes.general_prompt = "Answer the user"
    nodes.message_budget_chars = 1000
    monkeypatch.setattr(workflow_nodes, "can_request_help", lambda _state: True)
    models = []

    def invoke(model, _messages, _state):
        models.append(model)
        return AIMessage(content="OK")

    monkeypatch.setattr(workflow_nodes, "_invoke_agent_model", invoke)
    state = {"messages": [HumanMessage(content="Do not use tools. Explain this Python code.")]}
    getattr(nodes, node_name)(state)
    assert models == [nodes.llm]
    assert nodes.supervisor_node(state) == {"next": "General"}
