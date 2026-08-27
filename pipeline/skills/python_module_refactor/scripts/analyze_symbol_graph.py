#!/usr/bin/env python3
"""Build a deterministic top-level symbol graph for a Python megamodule."""

from __future__ import annotations

import argparse
import ast
import json
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Symbol:
    """One top-level definition and its source extent."""

    name: str
    kind: str
    start: int
    end: int
    node: ast.AST

    @property
    def lines(self) -> int:
        return self.end - self.start + 1


def _assigned_names(node: ast.AST) -> list[str]:
    names: list[str] = []
    targets: list[ast.AST] = []
    if isinstance(node, (ast.Assign, ast.AnnAssign)):
        targets = list(node.targets) if isinstance(node, ast.Assign) else [node.target]
    for target in targets:
        if isinstance(target, ast.Name):
            names.append(target.id)
        elif isinstance(target, (ast.Tuple, ast.List)):
            names.extend(item.id for item in target.elts if isinstance(item, ast.Name))
    return names


def collect_symbols(tree: ast.Module) -> dict[str, Symbol]:
    """Return every named top-level definition indexed by name."""
    symbols: dict[str, Symbol] = {}
    for node in tree.body:
        names: list[str] = []
        kind = type(node).__name__
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names = [node.name]
        else:
            names = _assigned_names(node)
        if not names or not hasattr(node, "end_lineno"):
            continue
        start = int(getattr(node, "lineno"))
        end = int(getattr(node, "end_lineno"))
        for name in names:
            symbols[name] = Symbol(name, kind, start, end, node)
    return symbols


def symbol_dependencies(symbol: Symbol, owned_names: set[str]) -> set[str]:
    """Return internal names loaded by one definition."""
    local_names: set[str] = set()
    if isinstance(symbol.node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        local_names.update(arg.arg for arg in symbol.node.args.args)
        local_names.update(arg.arg for arg in symbol.node.args.kwonlyargs)
        if symbol.node.args.vararg:
            local_names.add(symbol.node.args.vararg.arg)
        if symbol.node.args.kwarg:
            local_names.add(symbol.node.args.kwarg.arg)
    loaded = {
        node.id
        for node in ast.walk(symbol.node)
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load)
    }
    declared_globals = {
        name
        for node in ast.walk(symbol.node)
        if isinstance(node, ast.Global)
        for name in node.names
    }
    return ((loaded - local_names) | declared_globals) & (owned_names - {symbol.name})


def strongly_connected_components(graph: dict[str, set[str]]) -> list[list[str]]:
    """Return Tarjan strongly connected components in deterministic order."""
    index = 0
    indices: dict[str, int] = {}
    lowlinks: dict[str, int] = {}
    stack: list[str] = []
    on_stack: set[str] = set()
    components: list[list[str]] = []

    def visit(name: str) -> None:
        nonlocal index
        indices[name] = index
        lowlinks[name] = index
        index += 1
        stack.append(name)
        on_stack.add(name)

        for dependency in sorted(graph.get(name, set())):
            if dependency not in indices:
                visit(dependency)
                lowlinks[name] = min(lowlinks[name], lowlinks[dependency])
            elif dependency in on_stack:
                lowlinks[name] = min(lowlinks[name], indices[dependency])

        if lowlinks[name] != indices[name]:
            return
        component: list[str] = []
        while stack:
            member = stack.pop()
            on_stack.remove(member)
            component.append(member)
            if member == name:
                break
        components.append(sorted(component))

    for name in sorted(graph):
        if name not in indices:
            visit(name)
    return sorted(components, key=lambda item: (min(item), len(item)))


def _component_sort_key(row: dict[str, object]) -> tuple[int, str]:
    total_lines = row.get("total_symbol_lines")
    members = row.get("members")
    if not isinstance(total_lines, int) or not isinstance(members, list):
        raise TypeError("Invalid cyclic-component report row")
    return -total_lines, str(members)


def build_report(source: Path) -> dict[str, object]:
    """Build the complete serializable symbol report."""
    tree = ast.parse(source.read_text(encoding="utf-8"), filename=str(source))
    symbols = collect_symbols(tree)
    graph = {name: symbol_dependencies(symbol, set(symbols)) for name, symbol in symbols.items()}
    incoming: dict[str, set[str]] = defaultdict(set)
    for name, dependencies in graph.items():
        for dependency in dependencies:
            incoming[dependency].add(name)

    components = strongly_connected_components(graph)
    component_rows = []
    for members in components:
        total_lines = sum(symbols[name].lines for name in members)
        if len(members) > 1:
            component_rows.append(
                {
                    "members": members,
                    "symbol_count": len(members),
                    "total_symbol_lines": total_lines,
                }
            )

    symbol_rows = []
    for symbol in sorted(symbols.values(), key=lambda item: (item.start, item.name)):
        route_decorators = []
        if isinstance(symbol.node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            route_decorators = [
                ast.unparse(decorator)
                for decorator in symbol.node.decorator_list
                if isinstance(decorator, ast.Call)
                and isinstance(decorator.func, ast.Attribute)
                and decorator.func.attr in {"get", "post", "put", "patch", "delete", "websocket"}
            ]
        symbol_rows.append(
            {
                "name": symbol.name,
                "kind": symbol.kind,
                "start": symbol.start,
                "end": symbol.end,
                "lines": symbol.lines,
                "dependencies": sorted(graph[symbol.name]),
                "dependents": sorted(incoming[symbol.name]),
                "routes": route_decorators,
            }
        )

    return {
        "format": "gnosi-python-symbol-graph-v1",
        "source": source.as_posix(),
        "symbol_count": len(symbols),
        "edge_count": sum(len(value) for value in graph.values()),
        "cyclic_components": sorted(
            component_rows,
            key=_component_sort_key,
        ),
        "symbols": symbol_rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    source = args.source.expanduser().resolve()
    output = args.output.expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(build_report(source), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
