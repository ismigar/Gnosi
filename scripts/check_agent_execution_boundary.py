"""Reject functional modules that bypass the principal's transport boundary."""
from __future__ import annotations

import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# These files implement the central transport, resilience or explicit diagnostics.
TRANSPORT = {
    "backend/domains/agent/llm.py", "backend/agent/factory.py",
    "backend/agent/model_router.py", "backend/agent/provider_resilience.py",
    "backend/agent/json_tool_model.py",
    "backend/services/agent_cancellation.py", "backend/domains/agent/policy.py",
    "backend/domains/agent/workflow_setup.py", "backend/domains/agent/workflow.py",
    "backend/api/ai_routes.py", "backend/domains/configuration/agent/governance_routes.py",
}
MODEL_FUNCTIONS = {"get_llm", "get_default_llm", "get_default_llm_with_meta", "call_ai_client", "call_ai_with_fallback", "ChatOpenAI", "ChatAnthropic", "ChatOllama", "ChatGroq", "OpenAI", "Anthropic", "Groq", "AsyncGroq", "AsyncOpenAI", "AsyncAnthropic"}


def violations(path: Path) -> list[str]:
    relative = path.relative_to(ROOT).as_posix()
    if relative in TRANSPORT or "/tests/" in relative:
        return []
    tree = ast.parse(path.read_text(encoding="utf-8"))
    parents = {child: parent for parent in ast.walk(tree) for child in ast.iter_child_nodes(parent)}
    errors = []
    aliases: set[str] = set(MODEL_FUNCTIONS)
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and len(node.value) > 80:
            parent = parents.get(node)
            if isinstance(parent, ast.Expr):
                continue
            owner = parent
            while owner is not None and not isinstance(owner, (ast.FunctionDef, ast.AsyncFunctionDef)):
                owner = parents.get(owner)
            if owner is not None and "prompt" in owner.name and re.search(r"\b(?:You are|Your task is|Return ONLY|Write the entire|Create a reusable)\b", node.value):
                errors.append(f"{relative}:{node.lineno}: behavior text must be loaded from a declared resource")
        if isinstance(node, ast.ImportFrom):
            for imported in node.names:
                if imported.name in MODEL_FUNCTIONS:
                    aliases.add(imported.asname or imported.name)
        if isinstance(node, ast.Call):
            function = node.func
            name = function.id if isinstance(function, ast.Name) else function.attr if isinstance(function, ast.Attribute) else ""
            direct_invoke = isinstance(function, ast.Attribute) and function.attr in {"invoke", "ainvoke"} and isinstance(function.value, ast.Name) and function.value.id in {"llm", "model", "chat_model"}
            provider_create = isinstance(function, ast.Attribute) and function.attr == "create" and isinstance(function.value, ast.Attribute) and function.value.attr in {"completions", "messages", "responses"}
            if name in aliases or direct_invoke or provider_create:
                errors.append(f"{relative}:{node.lineno}: model access must use the principal executor")
    return errors


def main() -> int:
    errors = [error for directory in ("backend", "pipeline", "extensions") for path in (ROOT / directory).rglob("*.py") for error in violations(path)]
    print("\n".join(errors) if errors else "Principal-agent execution boundary passed")
    return bool(errors)


if __name__ == "__main__":
    raise SystemExit(main())
