"""Write a reviewable inventory of application AI entrypoints and transports."""
from __future__ import annotations

import ast
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENTRYPOINTS = {"generate_for", "generate_result_for", "run_sync", "execute_operation", "AgentOperation", "stream_workflow", "run_engine", "synthesize", "_invoke_agent_model", "_request_jev", "call_ai_client", "call_ai_with_fallback"}


def inventory() -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for directory in ("backend", "pipeline", "extensions"):
        for path in sorted((ROOT / directory).rglob("*.py")):
            if "tests" in path.parts or path.name.startswith("test_"):
                continue
            tree = ast.parse(path.read_text(encoding="utf-8"))
            parents = {child: parent for parent in ast.walk(tree) for child in ast.iter_child_nodes(parent)}
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                name = node.func.id if isinstance(node.func, ast.Name) else node.func.attr if isinstance(node.func, ast.Attribute) else ""
                partial = name == "partial" and node.args and isinstance(node.args[0], ast.Name) and node.args[0].id in ENTRYPOINTS
                if partial:
                    name = node.args[0].id
                technical = name in {"generate", "encode"} and any(part in path.as_posix() for part in ("handwriting", "transcription", "localize", "literature_ai"))
                if name not in ENTRYPOINTS and not technical:
                    continue
                parent: ast.AST | None = node
                while parent is not None and not isinstance(parent, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    parent = parents.get(parent)
                operation = next((keyword.value.value for keyword in node.keywords if keyword.arg == "operation" and isinstance(keyword.value, ast.Constant)), None)
                position = 1 if partial else 0
                if operation is None and name in {"generate_for", "generate_result_for", "synthesize", "run_engine"} and len(node.args) > position and isinstance(node.args[position], ast.Constant):
                    operation = node.args[position].value
                rows.append({"path": path.relative_to(ROOT).as_posix(), "function": parent.name if parent else "module", "call": name,
                             "operation": operation or "dynamic-dispatch", "classification": "technical-inference" if technical or name == "run_engine" else "governed-agent"})
    return sorted(rows, key=lambda row: (str(row["path"]), str(row["function"]), str(row["call"])))


if __name__ == "__main__":
    print(json.dumps(inventory(), ensure_ascii=False, indent=2))
