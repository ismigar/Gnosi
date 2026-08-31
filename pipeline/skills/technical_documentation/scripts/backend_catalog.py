"""Static source catalog responsibility: backend catalog."""

from __future__ import annotations

import ast
from collections import defaultdict
from pathlib import Path

from pipeline.skills.technical_documentation.scripts.catalog_common import (
    first_doc_line,
    generated_header,
    markdown_cell,
    python_files,
    read_text,
    relative_posix,
    source_link,
)


def python_module_metrics(path: Path) -> tuple[str, int, int, int, int, int]:
    """Return summary and structural metrics for a Python source module."""
    text = read_text(path)
    try:
        tree = ast.parse(text, filename=str(path))
    except SyntaxError:
        return "Syntax could not be parsed", len(text.splitlines()), 0, 0, 0, 0
    classes = [node for node in tree.body if isinstance(node, ast.ClassDef)]
    functions = [
        node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    ]
    async_functions = [node for node in functions if isinstance(node, ast.AsyncFunctionDef)]
    documented = sum(bool(ast.get_docstring(node)) for node in [*classes, *functions])
    summary = first_doc_line(tree, "No module docstring")
    return (
        summary,
        len(text.splitlines()),
        len(classes),
        len(functions),
        len(async_functions),
        documented,
    )


def build_backend_catalog(app_root: Path) -> str:
    """Generate a catalog of owned backend Python modules."""
    backend_root = app_root / "backend"
    files = python_files(backend_root, include_tests=False)
    grouped: dict[str, list[Path]] = defaultdict(list)
    total_lines = 0
    for path in files:
        relative = path.relative_to(backend_root)
        group = relative.parts[0] if len(relative.parts) > 1 else "application root"
        grouped[group].append(path)

    lines = generated_header(
        "Backend module catalog",
        "Owned Python modules parsed without importing the application. Counts describe "
        "top-level declarations and are navigation aids, not complexity scores.",
    )
    lines.extend(["## Module groups", "", "| Group | Modules | Lines |", "| --- | ---: | ---: |"])
    group_metrics: dict[str, tuple[int, int]] = {}
    module_metrics: dict[Path, tuple[str, int, int, int, int, int]] = {}
    for group in sorted(grouped):
        group_lines = 0
        for path in grouped[group]:
            metrics = python_module_metrics(path)
            module_metrics[path] = metrics
            group_lines += metrics[1]
        group_metrics[group] = (len(grouped[group]), group_lines)
        total_lines += group_lines
        lines.append(f"| `{group}` | {len(grouped[group])} | {group_lines} |")
    lines.extend(
        [
            "",
            f"Total: **{len(files)} modules** and **{total_lines} source lines**.",
            "",
        ]
    )

    for group in sorted(grouped):
        lines.extend(
            [
                f"## {group}",
                "",
                "| Module | Lines | Classes | Functions | Async | "
                "Documented declarations | Purpose signal |",
                "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
            ]
        )
        for path in grouped[group]:
            summary, source_lines, classes, functions, async_functions, documented = module_metrics[
                path
            ]
            source = relative_posix(path, app_root)
            lines.append(
                "| "
                + " | ".join(
                    [
                        source_link(source),
                        str(source_lines),
                        str(classes),
                        str(functions),
                        str(async_functions),
                        str(documented),
                        markdown_cell(summary),
                    ]
                )
                + " |"
            )
        lines.append("")
    return "\n".join(lines)
