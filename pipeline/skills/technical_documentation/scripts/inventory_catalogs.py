"""Static source catalog responsibility: inventory catalogs."""

from __future__ import annotations

import ast
import re
from pathlib import Path

from pipeline.skills.technical_documentation.scripts.api_catalog import parse_router_registration
from pipeline.skills.technical_documentation.scripts.catalog_common import (
    TEST_NAME_RE,
    frontend_files,
    generated_header,
    is_owned_inventory_file,
    markdown_cell,
    python_files,
    read_text,
    relative_posix,
    source_link,
)


def count_python_tests(path: Path) -> int:
    """Count top-level pytest test functions and class methods."""
    try:
        tree = ast.parse(read_text(path), filename=str(path))
    except SyntaxError:
        return 0
    return sum(
        isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith("test_")
        for node in ast.walk(tree)
    )


def build_test_catalog(app_root: Path) -> str:
    """Generate a test-suite inventory by runtime and source area."""
    python_tests = [
        path
        for path in python_files(app_root)
        if "tests" in path.parts or TEST_NAME_RE.match(path.name)
    ]
    frontend_tests = [
        path
        for root in [app_root / "frontend", app_root / "tests" / "e2e"]
        for path in frontend_files(root)
        if TEST_NAME_RE.match(path.name)
    ]
    rows: list[tuple[str, Path, int, str]] = []
    for path in python_tests:
        rows.append(("pytest", path, count_python_tests(path), "Python AST"))
    for path in frontend_tests:
        text = read_text(path)
        cases = len(re.findall(r"\b(?:it|test)\s*\(", text))
        runner = "Playwright" if "e2e" in path.parts else "Vitest"
        rows.append((runner, path, cases, "call-pattern estimate"))
    rows.sort(key=lambda item: (item[0], relative_posix(item[1], app_root)))

    runner_counts: dict[str, tuple[int, int]] = {}
    for runner in sorted({item[0] for item in rows}):
        selected = [item for item in rows if item[0] == runner]
        runner_counts[runner] = (len(selected), sum(item[2] for item in selected))

    lines = generated_header(
        "Test catalog",
        "Inventory of owned test files. Python test counts come from AST names; JavaScript "
        "counts are conservative call-pattern estimates and do not replace runner collection.",
    )
    lines.extend(["## Summary", "", "| Runner | Files | Test signals |", "| --- | ---: | ---: |"])
    for runner, (file_count, test_count) in runner_counts.items():
        lines.append(f"| {runner} | {file_count} | {test_count} |")
    lines.extend(
        [
            "",
            "## Files",
            "",
            "| Runner | File | Test signals | Counting method |",
            "| --- | --- | ---: | --- |",
        ]
    )
    for runner, path, cases, method in rows:
        lines.append(
            f"| {runner} | {source_link(relative_posix(path, app_root))} | {cases} | {method} |"
        )
    lines.append("")
    return "\n".join(lines)


def first_markdown_heading(text: str, fallback: str) -> str:
    """Return the first Markdown heading text."""
    for line in text.splitlines():
        if line.startswith("# "):
            return line.removeprefix("# ").strip()
    return fallback


def build_skill_catalog(app_root: Path) -> str:
    """Generate the runtime skill-package catalog."""
    skill_root = app_root / "pipeline" / "skills"
    rows: list[tuple[str, str, int, int, str]] = []
    for skill_doc in sorted(skill_root.glob("*/SKILL.md")):
        skill_dir = skill_doc.parent
        text = read_text(skill_doc)
        scripts = (
            sorted(
                path
                for path in (skill_dir / "scripts").glob("**/*")
                if path.is_file() and "__pycache__" not in path.parts
            )
            if (skill_dir / "scripts").exists()
            else []
        )
        rows.append(
            (
                skill_dir.name,
                first_markdown_heading(text, skill_dir.name),
                len(text.splitlines()),
                len(scripts),
                relative_posix(skill_doc, app_root),
            )
        )
    lines = generated_header(
        "Runtime skill catalog",
        "Packages under `pipeline/skills/` are application automation and operational "
        "capabilities. They are distinct from development-agent skills.",
    )
    lines.extend(
        [
            f"Discovered **{len(rows)} documented runtime skills**.",
            "",
            "| Skill | Declared title | Documentation lines | Scripts | Contract |",
            "| --- | --- | ---: | ---: | --- |",
        ]
    )
    for name, title, doc_lines, script_count, source in rows:
        lines.append(
            f"| `{name}` | {markdown_cell(title)} | {doc_lines} | "
            f"{script_count} | {source_link(source)} |"
        )
    lines.append("")
    return "\n".join(lines)


def build_repository_inventory(app_root: Path, project_root: Path) -> str:
    """Generate high-level owned-source and documentation counts."""
    backend_all = python_files(app_root / "backend")
    backend_tests = [
        path for path in backend_all if "tests" in path.parts or TEST_NAME_RE.match(path.name)
    ]
    frontend_all = frontend_files(app_root / "frontend" / "src")
    frontend_tests = [path for path in frontend_all if TEST_NAME_RE.match(path.name)]
    route_composition = app_root / "backend" / "app" / "routes.py"
    if not route_composition.is_file():
        route_composition = app_root / "backend" / "server.py"
    route_registrations = parse_router_registration(route_composition, app_root)
    directives = sorted((project_root / "docs" / "dev_memory" / "directives").glob("*.md"))
    skills = sorted((app_root / "pipeline" / "skills").glob("*/SKILL.md"))

    owned_roots = [
        "backend",
        "frontend/src",
        "pipeline",
        "desktop",
        "extensions",
        "tests/e2e",
        "scripts",
    ]
    lines = generated_header(
        "Repository inventory",
        "High-level snapshot of the authoritative application tree. Generated and vendored "
        "dependencies are excluded where the catalog can identify them reliably.",
    )
    lines.extend(
        [
            "## Key counts",
            "",
            "| Surface | Count |",
            "| --- | ---: |",
            f"| Backend Python files | {len(backend_all)} |",
            f"| Backend Python test files | {len(backend_tests)} |",
            f"| Frontend JS/TS source files | {len(frontend_all)} |",
            f"| Frontend unit test files | {len(frontend_tests)} |",
            f"| Registered FastAPI routers | {len(route_registrations)} |",
            f"| Runtime skill contracts | {len(skills)} |",
            f"| Development-memory directives | {len(directives)} |",
            "",
            "## Owned application surfaces",
            "",
            "| Surface | Files | Purpose boundary |",
            "| --- | ---: | --- |",
        ]
    )
    purpose = {
        "backend": "FastAPI, services, models, agents, scheduling, and storage adapters",
        "frontend/src": "React application, UI behavior, state, and browser integrations",
        "pipeline": "Reusable application skills and deterministic processing tools",
        "desktop": "Desktop lifecycle, backend packaging, IPC, and updates",
        "extensions": "Office, browser, plugin, marketplace, and external-system adapters",
        "tests/e2e": "Host-level Playwright acceptance tests",
        "scripts": "Native, self-host, release, and maintenance scripts",
    }
    for source_root in owned_roots:
        root = app_root / source_root
        count = (
            sum(1 for path in root.rglob("*") if is_owned_inventory_file(path))
            if root.exists()
            else 0
        )
        lines.append(f"| `{source_root}/` | {count} | {purpose[source_root]} |")
    lines.extend(
        [
            "",
            "## Exclusion boundary",
            "",
            "Catalogs exclude or avoid interpreting `.venv`, `node_modules`, `dist`, cache "
            "directories, Playwright reports, `local_data`, local SQLite files, and "
            "`frontend/vendor`. Vendored reader code is documented "
            "only at its integration boundary.",
            "",
        ]
    )
    return "\n".join(lines)
