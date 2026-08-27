#!/usr/bin/env python3
"""Replace one top-level Python function, including its decorators."""

from __future__ import annotations

import argparse
import ast
import logging
from pathlib import Path

log = logging.getLogger(__name__)


def _function_extent(tree: ast.Module, name: str) -> tuple[int, int]:
    matches = [
        node
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name
    ]
    if len(matches) != 1:
        raise ValueError(f"Expected one top-level function {name!r}; found {len(matches)}")
    node = matches[0]
    start = min([node.lineno, *(decorator.lineno for decorator in node.decorator_list)])
    if node.end_lineno is None:
        raise ValueError(f"Function {name!r} has no end line")
    return start, node.end_lineno


def replace_function(source: Path, name: str, replacement: str) -> bool:
    """Replace one function and return whether the source changed."""
    source_text = source.read_text(encoding="utf-8")
    tree = ast.parse(source_text, filename=str(source))
    start, end = _function_extent(tree, name)

    replacement_text = replacement.rstrip() + "\n"
    replacement_tree = ast.parse(replacement_text, filename="<replacement>")
    replacement_names = [
        node.name
        for node in replacement_tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    ]
    if replacement_names != [name]:
        raise ValueError(f"Replacement must define only {name!r}; found {replacement_names!r}")

    lines = source_text.splitlines(keepends=True)
    current = "".join(lines[start - 1 : end])
    if current == replacement_text:
        return False
    updated = "".join([*lines[: start - 1], replacement_text, *lines[end:]])
    ast.parse(updated, filename=str(source))
    source.write_text(updated, encoding="utf-8")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("name")
    parser.add_argument("replacement", type=Path)
    args = parser.parse_args()

    changed = replace_function(
        args.source.resolve(),
        args.name,
        args.replacement.read_text(encoding="utf-8"),
    )
    log.info("%s top-level function %s", "Replaced" if changed else "Kept", args.name)
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    raise SystemExit(main())
