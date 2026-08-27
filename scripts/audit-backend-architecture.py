#!/usr/bin/env python3
"""Build a deterministic, data-free inventory of the Gnosi Python backend."""

from __future__ import annotations

import argparse
import ast
import importlib
import json
import logging
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


log = logging.getLogger(__name__)
ROUTE_METHODS = {"delete", "get", "head", "options", "patch", "post", "put", "websocket"}


@dataclass(frozen=True)
class FunctionMetric:
    """One function and its conservative cyclomatic-complexity estimate."""

    qualified_name: str
    line: int
    lines: int
    complexity: int


def _expression_text(node: ast.AST) -> str:
    """Render one AST expression without evaluating application code."""
    try:
        return ast.unparse(node)
    except (AttributeError, ValueError):
        return node.__class__.__name__


def _module_name(path: Path, backend_root: Path) -> str:
    relative = path.relative_to(backend_root.parent).with_suffix("")
    return ".".join(relative.parts)


def _imports(tree: ast.Module) -> list[str]:
    values: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            values.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            values.add(node.module)
    return sorted(value for value in values if value == "backend" or value.startswith("backend."))


def _mutable_globals(tree: ast.Module) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    mutable_calls = {"dict", "list", "set", "defaultdict", "Lock", "RLock", "Event"}
    for node in tree.body:
        if not isinstance(node, (ast.Assign, ast.AnnAssign)):
            continue
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        value = node.value
        mutable = isinstance(value, (ast.Dict, ast.List, ast.Set))
        if isinstance(value, ast.Call):
            function_name = _expression_text(value.func).split(".")[-1]
            mutable = mutable or function_name in mutable_calls
        if not mutable:
            continue
        for target in targets:
            if isinstance(target, ast.Name):
                results.append({"name": target.id, "line": node.lineno})
    return sorted(results, key=lambda item: (item["line"], item["name"]))


def _function_complexity(node: ast.FunctionDef | ast.AsyncFunctionDef) -> int:
    complexity = 1
    decision_nodes = (
        ast.For,
        ast.AsyncFor,
        ast.While,
        ast.If,
        ast.IfExp,
        ast.ExceptHandler,
        ast.With,
        ast.AsyncWith,
        ast.Assert,
        ast.Match,
    )
    for child in ast.walk(node):
        if isinstance(child, decision_nodes):
            complexity += 1
        elif isinstance(child, ast.BoolOp):
            complexity += max(0, len(child.values) - 1)
        elif isinstance(child, ast.comprehension):
            complexity += 1 + len(child.ifs)
    return complexity


def _functions(tree: ast.Module) -> list[FunctionMetric]:
    metrics: list[FunctionMetric] = []

    def visit(nodes: Iterable[ast.stmt], prefix: str = "") -> None:
        for node in nodes:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                name = f"{prefix}{node.name}"
                metrics.append(
                    FunctionMetric(
                        qualified_name=name,
                        line=node.lineno,
                        lines=(node.end_lineno or node.lineno) - node.lineno + 1,
                        complexity=_function_complexity(node),
                    )
                )
            elif isinstance(node, ast.ClassDef):
                visit(node.body, f"{prefix}{node.name}.")

    visit(tree.body)
    return sorted(metrics, key=lambda item: (item.line, item.qualified_name))


def _routes(tree: ast.Module) -> list[dict[str, Any]]:
    routes: list[dict[str, Any]] = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            if not isinstance(decorator, ast.Call) or not isinstance(decorator.func, ast.Attribute):
                continue
            method = decorator.func.attr.lower()
            if method not in ROUTE_METHODS:
                continue
            path = _expression_text(decorator.args[0]) if decorator.args else ""
            routes.append(
                {
                    "router": _expression_text(decorator.func.value),
                    "method": method.upper(),
                    "path_expression": path,
                    "handler": node.name,
                    "line": node.lineno,
                    "keywords": {
                        keyword.arg or "**": _expression_text(keyword.value)
                        for keyword in decorator.keywords
                    },
                }
            )
    return sorted(routes, key=lambda item: (item["line"], item["method"], item["handler"]))


def audit_backend(repository_root: Path) -> dict[str, Any]:
    """Return the stable architecture inventory for one repository checkout."""
    backend_root = repository_root / "backend"
    modules: list[dict[str, Any]] = []
    for path in sorted(backend_root.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source, filename=str(path))
        functions = _functions(tree)
        modules.append(
            {
                "module": _module_name(path, backend_root),
                "path": path.relative_to(repository_root).as_posix(),
                "lines": len(source.splitlines()),
                "imports": _imports(tree),
                "mutable_globals": _mutable_globals(tree),
                "routes": _routes(tree),
                "functions": [
                    {
                        "name": item.qualified_name,
                        "line": item.line,
                        "lines": item.lines,
                        "complexity": item.complexity,
                    }
                    for item in functions
                ],
                "max_complexity": max((item.complexity for item in functions), default=0),
            }
        )
    return {
        "format": "gnosi-backend-architecture-v1",
        "module_count": len(modules),
        "route_count": sum(len(module["routes"]) for module in modules),
        "modules": modules,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--openapi-output",
        type=Path,
        help="Also import backend.server and write its deterministic OpenAPI document",
    )
    args = parser.parse_args()
    root = args.root.expanduser().resolve()
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    output = args.output or root / ".tmp" / "backend-architecture.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = audit_backend(root)
    output.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    log.info("Wrote backend architecture inventory to %s", output)
    if args.openapi_output:
        server = importlib.import_module("backend.server")
        openapi = server.app.openapi()
        openapi_output = args.openapi_output.expanduser().resolve()
        openapi_output.parent.mkdir(parents=True, exist_ok=True)
        openapi_output.write_text(
            json.dumps(openapi, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        log.info("Wrote deterministic OpenAPI document to %s", openapi_output)
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    raise SystemExit(main())
