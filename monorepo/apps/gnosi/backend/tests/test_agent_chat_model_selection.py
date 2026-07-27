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
