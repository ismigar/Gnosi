#!/usr/bin/env python3
"""Move selected top-level symbols into a module and leave explicit imports."""

from __future__ import annotations

import argparse
import ast
import logging
from pathlib import Path
from typing import TypeAlias

log = logging.getLogger(__name__)

NamedNode: TypeAlias = (
    ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef | ast.Assign | ast.AnnAssign
)


def _node_name(node: ast.stmt) -> str | None:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        return node.name
    if isinstance(node, ast.Assign) and len(node.targets) == 1:
        target = node.targets[0]
        return target.id if isinstance(target, ast.Name) else None
    if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
        return node.target.id
    return None


def _named_nodes(tree: ast.Module, selected_names: set[str]) -> dict[str, NamedNode]:
    """Return requested named nodes and reject ambiguity only in that scope."""
    result: dict[str, NamedNode] = {}
    duplicates: set[str] = set()
    for node in tree.body:
        if not isinstance(
            node,
            (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Assign, ast.AnnAssign),
        ):
            continue
        name = _node_name(node)
        if name is None or name not in selected_names:
            continue
        if name in result:
            duplicates.add(name)
        result[name] = node
    if duplicates:
        names = ", ".join(sorted(duplicates))
        raise ValueError(f"Duplicate top-level symbols are unsupported: {names}")
    return result


def _extent(node: NamedNode) -> tuple[int, int]:
    start = node.lineno
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        start = min([start, *(decorator.lineno for decorator in node.decorator_list)])
    if node.end_lineno is None:
        name = _node_name(node) or "<unknown>"
        raise ValueError(f"Top-level symbol {name!r} has no end line")
    return start, node.end_lineno


def _validate_names(names: list[str]) -> list[str]:
    normalized = [name.strip() for name in names if name.strip()]
    if not normalized:
        raise ValueError("At least one symbol is required")
    if len(set(normalized)) != len(normalized):
        raise ValueError("Symbol names must be unique")
    return normalized


def extract_symbols(
    source: Path,
    destination: Path,
    names: list[str],
    *,
    destination_preamble: str,
    source_import: str,
) -> bool:
    """Extract symbols and return whether either module changed."""
    selected_names = _validate_names(names)
    source_text = source.read_text(encoding="utf-8")
    source_tree = ast.parse(source_text, filename=str(source))
    selected_name_set = set(selected_names)
    source_nodes = _named_nodes(source_tree, selected_name_set)
    present = [name for name in selected_names if name in source_nodes]

    if not present:
        if not destination.exists():
            raise ValueError("Symbols are absent from source and destination does not exist")
        destination_text = destination.read_text(encoding="utf-8")
        destination_tree = ast.parse(destination_text, filename=str(destination))
        destination_nodes = _named_nodes(destination_tree, selected_name_set)
        missing = [name for name in selected_names if name not in destination_nodes]
        if missing:
            raise ValueError("Symbols are absent from both modules: " + ", ".join(missing))
        if source_import.strip() not in source_text:
            raise ValueError("Destination owns the symbols but the source import is absent")
        return False

    if len(present) != len(selected_names):
        missing = [name for name in selected_names if name not in source_nodes]
        raise ValueError("Partial extraction state; missing from source: " + ", ".join(missing))
    if destination.exists():
        raise ValueError(f"Destination already exists: {destination}")
    if not source_import.strip():
        raise ValueError("Source import must not be empty")

    lines = source_text.splitlines(keepends=True)
    extents = sorted((_extent(source_nodes[name]), name) for name in selected_names)
    snippets = ["".join(lines[start - 1 : end]).rstrip() for (start, end), _name in extents]
    destination_text = destination_preamble.rstrip() + "\n\n\n" + "\n\n\n".join(snippets) + "\n"
    ast.parse(destination_text, filename=str(destination))

    first_start = extents[0][0][0]
    removed_lines: set[int] = set()
    for (start, end), _name in extents:
        removed_lines.update(range(start, end + 1))
    updated_lines: list[str] = []
    for line_number, line in enumerate(lines, start=1):
        if line_number == first_start:
            updated_lines.append(source_import.rstrip() + "\n")
        if line_number not in removed_lines:
            updated_lines.append(line)
    updated_source = "".join(updated_lines)
    ast.parse(updated_source, filename=str(source))

    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(destination_text, encoding="utf-8")
    source.write_text(updated_source, encoding="utf-8")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("symbols", nargs="+")
    parser.add_argument("--destination-preamble", required=True, type=Path)
    parser.add_argument("--source-import", required=True, type=Path)
    args = parser.parse_args()

    changed = extract_symbols(
        args.source.resolve(),
        args.destination.resolve(),
        args.symbols,
        destination_preamble=args.destination_preamble.read_text(encoding="utf-8"),
        source_import=args.source_import.read_text(encoding="utf-8"),
    )
    log.info("%s %d symbols", "Extracted" if changed else "Kept", len(args.symbols))
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    raise SystemExit(main())
