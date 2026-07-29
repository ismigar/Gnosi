"""Contract tests for agent-owned model selection in chat."""

import ast
from pathlib import Path


def test_chat_request_defaults_to_the_selected_agents_model():
    source = Path(__file__).parents[1] / "api" / "agent_routes.py"
    module = ast.parse(source.read_text(encoding="utf-8"))
    request = next(node for node in module.body if isinstance(node, ast.ClassDef) and node.name == "ChatRequest")
    field = next(
        node for node in request.body
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.target.id == "llm_mode"
    )

    assert isinstance(field.value, ast.Constant)
    assert field.value.value == "agent_default"


def test_unknown_supervisor_decision_falls_back_to_general():
    """Every initial user turn must reach a response-producing node."""
    source = Path(__file__).parents[1] / "agent" / "factory.py"
    module = ast.parse(source.read_text(encoding="utf-8"))
    create_workflow = next(
        node for node in module.body
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "create_agent_workflow"
    )
    supervisor = next(
        node for node in ast.walk(create_workflow)
        if isinstance(node, ast.FunctionDef) and node.name == "supervisor_node"
    )
    returns = [node.value for node in ast.walk(supervisor) if isinstance(node, ast.Return)]
    assert any(
        isinstance(value, ast.Dict)
        and any(
            isinstance(item, ast.Constant) and item.value == "General"
            for item in value.values
        )
        for value in returns
    )


def test_completed_specialists_end_without_returning_to_supervisor():
    """A final assistant reply must not be used as another supervisor prompt."""
    source = Path(__file__).parents[1] / "agent" / "factory.py"
    module = ast.parse(source.read_text(encoding="utf-8"))
    create_workflow = next(
        node for node in module.body
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "create_agent_workflow"
    )
    routers = {
        node.name: node for node in ast.walk(create_workflow)
        if isinstance(node, ast.FunctionDef) and node.name in {"coder_router", "brain_router"}
    }
    assert set(routers) == {"coder_router", "brain_router"}
    for router in routers.values():
        string_values = [
            node.value for node in ast.walk(router)
            if isinstance(node, ast.Constant) and isinstance(node.value, str)
        ]
        assert "END" in string_values
        assert "supervisor" not in string_values
