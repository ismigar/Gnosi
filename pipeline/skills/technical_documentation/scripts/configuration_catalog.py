"""Static source catalog responsibility: configuration catalog."""

from __future__ import annotations

import ast
import re
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from pipeline.skills.technical_documentation.scripts.catalog_common import (
    SECRET_NAME_RE,
    constant_string,
    expression_name,
    frontend_files,
    generated_header,
    keyword,
    markdown_cell,
    python_files,
    read_text,
    relative_posix,
    safe_unparse,
    source_link,
)

FRONTEND_ENV_RE = re.compile(r"\b(?:import\.meta|process)\.env\.([A-Za-z_$][A-Za-z0-9_$]*)")


@dataclass(frozen=True)
class EnvironmentReference:
    """Describe one environment-variable reference without exposing its value."""

    name: str
    default: str
    source: str
    line: int
    runtime: str


class PythonEnvironmentVisitor(ast.NodeVisitor):
    """Collect literal environment names and safe defaults from Python AST."""

    def __init__(self, source: str, runtime: str) -> None:
        self.source = source
        self.runtime = runtime
        self.references: list[EnvironmentReference] = []

    def visit_Call(self, node: ast.Call) -> None:  # noqa: N802
        """Collect `os.getenv`, `os.environ.get`, and `setdefault` calls."""
        name = expression_name(node.func)
        supported = {
            "os.getenv",
            "os.environ.get",
            "os.environ.setdefault",
            "environ.get",
            "environ.setdefault",
        }
        if name in supported and node.args:
            env_name = constant_string(node.args[0])
            if env_name:
                default_node = node.args[1] if len(node.args) > 1 else keyword(node, "default")
                self.references.append(
                    EnvironmentReference(
                        name=env_name,
                        default=format_environment_default(env_name, default_node),
                        source=self.source,
                        line=node.lineno,
                        runtime=self.runtime,
                    )
                )
        self.generic_visit(node)

    def visit_Subscript(self, node: ast.Subscript) -> None:  # noqa: N802
        """Collect direct `os.environ[NAME]` lookups."""
        if expression_name(node.value) == "os.environ":
            env_name = constant_string(node.slice)
            if env_name:
                self.references.append(
                    EnvironmentReference(
                        name=env_name,
                        default="required",
                        source=self.source,
                        line=node.lineno,
                        runtime=self.runtime,
                    )
                )
        self.generic_visit(node)


def format_environment_default(name: str, node: ast.AST | None) -> str:
    """Render a source default while redacting secret-bearing variables."""
    if SECRET_NAME_RE.search(name):
        return "redacted"
    if node is None:
        return "unset"
    if isinstance(node, ast.Constant) and isinstance(
        node.value, (str, int, float, bool, type(None))
    ):
        value = repr(node.value)
        return value if len(value) <= 70 else f"{value[:69]}…"
    return safe_unparse(node, limit=70)


def collect_environment_references(app_root: Path) -> list[EnvironmentReference]:
    """Collect environment names from owned Python and JavaScript source."""
    references: list[EnvironmentReference] = []
    python_roots = [app_root / "backend", app_root / "pipeline", app_root / "scripts"]
    seen_python: set[Path] = set()
    for root in python_roots:
        if not root.exists():
            continue
        for path in python_files(root):
            if path in seen_python:
                continue
            seen_python.add(path)
            source = relative_posix(path, app_root)
            try:
                tree = ast.parse(read_text(path), filename=str(path))
            except SyntaxError:
                continue
            visitor = PythonEnvironmentVisitor(source, "Python")
            visitor.visit(tree)
            references.extend(visitor.references)

    javascript_roots = [app_root / "frontend" / "src", app_root / "desktop"]
    for root in javascript_roots:
        if not root.exists():
            continue
        for path in frontend_files(root):
            text = read_text(path)
            source = relative_posix(path, app_root)
            for match in FRONTEND_ENV_RE.finditer(text):
                line = text.count("\n", 0, match.start()) + 1
                references.append(
                    EnvironmentReference(
                        name=match.group(1),
                        default="runtime-provided",
                        source=source,
                        line=line,
                        runtime="Vite" if "import.meta" in match.group(0) else "Node.js",
                    )
                )
    return sorted(
        set(references),
        key=lambda item: (item.name, item.source, item.line, item.default),
    )


def build_configuration_catalog(app_root: Path) -> str:
    """Generate the environment-variable catalog without reading environment values."""
    references = collect_environment_references(app_root)
    grouped: dict[str, list[EnvironmentReference]] = defaultdict(list)
    for item in references:
        grouped[item.name].append(item)
    lines = generated_header(
        "Configuration catalog",
        "Environment names and source-written defaults discovered through static inspection. "
        "Secret-bearing defaults are always redacted, "
        "and the generator never reads the process environment.",
    )
    lines.extend(
        [
            f"Discovered **{len(grouped)} variables** "
            f"across **{len(references)} source references**.",
            "",
            "| Variable | Runtime | Source default | Consumers |",
            "| --- | --- | --- | --- |",
        ]
    )
    for name in sorted(grouped):
        items = grouped[name]
        runtimes = sorted({item.runtime for item in items})
        defaults = sorted({item.default for item in items})
        consumers = "<br>".join(source_link(item.source, item.line) for item in items)
        lines.append(
            "| "
            + " | ".join(
                [
                    f"`{name}`",
                    markdown_cell(", ".join(runtimes)),
                    markdown_cell(", ".join(defaults)),
                    consumers,
                ]
            )
            + " |"
        )
    lines.append("")
    return "\n".join(lines)
