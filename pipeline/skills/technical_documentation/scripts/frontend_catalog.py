"""Static source catalog responsibility: frontend catalog."""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from pipeline.skills.technical_documentation.scripts.catalog_common import (
    SOURCE_SUFFIXES,
    TEST_NAME_RE,
    frontend_files,
    generated_header,
    is_owned_inventory_file,
    markdown_cell,
    read_text,
    relative_posix,
    source_link,
)

FRONTEND_API_RE = re.compile(r"['\"](/api/[A-Za-z0-9_?&=./:{}*+%-]+)['\"]")


ROUTE_RE = re.compile(
    r'<Route\s+path\s*=\s*["\']([^"\']+)["\']\s+element\s*=\s*\{\s*<([A-Za-z_$][\w$]*)'
)


STATIC_IMPORT_RE = re.compile(r"\bimport\s+(?!type\b)([^;]+?)\s+from\s+['\"]([^'\"]+)['\"]")


LAZY_IMPORT_RE = re.compile(
    r"const\s+([A-Za-z_$][\w$]*)\s*=\s*lazy\(.*?import\(['\"]([^'\"]+)['\"]\)",
    re.DOTALL,
)


@dataclass(frozen=True)
class FrontendRoute:
    """Describe a literal JSX route and its outer element's source."""

    path: str
    component: str
    source: str


def resolve_frontend_import(
    source: str,
    app_root: Path,
    *,
    importer: Path | None = None,
) -> str:
    """Resolve a relative import from its declaring module, without executing it."""
    if not source.startswith("."):
        return source
    source_root = (app_root / "frontend" / "src").resolve()
    base = importer.parent if importer is not None else source_root
    candidate = (base / source).resolve()
    suffixes = (".tsx", ".ts", ".jsx", ".js")
    choices = [candidate, *[candidate.with_suffix(suffix) for suffix in suffixes]]
    choices.extend(candidate / f"index{suffix}" for suffix in suffixes)
    for choice in choices:
        if (
            choice.resolve().is_relative_to(source_root)
            and choice.suffix in SOURCE_SUFFIXES
            and is_owned_inventory_file(choice)
        ):
            return relative_posix(choice, app_root)
    return source


def frontend_imports(text: str, path: Path, app_root: Path) -> dict[str, str]:
    """Resolve default, named/aliased and lazy component imports in one module."""
    imports: dict[str, str] = {}
    for clause, source in STATIC_IMPORT_RE.findall(text):
        resolved = resolve_frontend_import(source, app_root, importer=path)
        default = re.match(r"([A-Za-z_$][\w$]*)", clause)
        if default:
            imports[default.group(1)] = resolved
        named = re.search(r"\{([^}]+)\}", clause)
        if named:
            for item in named.group(1).split(","):
                binding = re.fullmatch(
                    r"([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?",
                    item.strip(),
                )
                if binding:
                    imports[binding.group(2) or binding.group(1)] = resolved
    for component, source in LAZY_IMPORT_RE.findall(text):
        imports[component] = resolve_frontend_import(source, app_root, importer=path)
    return imports


def collect_frontend_routes(
    app_root: Path,
    *,
    files: list[Path] | None = None,
) -> list[FrontendRoute]:
    """Inspect production JSX/TSX route declarations, including split routers.

    This is a static inventory, not a call graph. Keep the outer element (which
    may be a local scope/guard) and do not infer nested pages as direct mounts.
    """
    source_root = app_root / "frontend" / "src"
    files = frontend_files(source_root, include_tests=False) if files is None else files
    routes: list[FrontendRoute] = []
    for path in sorted(files):
        if {"tests", "__tests__", "fixtures", "__fixtures__"}.intersection(
            path.relative_to(source_root).parts
        ) or TEST_NAME_RE.match(path.name):
            continue
        text = read_text(path)
        declarations = ROUTE_RE.findall(text)
        if not declarations:
            continue
        imports = frontend_imports(text, path, app_root)
        if imports.get("Route") != "react-router-dom":
            continue
        local_components = set(
            re.findall(
                r"\b(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)",
                text,
            )
        )
        for route_path, component in declarations:
            source = imports.get(component, "unresolved")
            if component in local_components and component not in imports:
                source = relative_posix(path, app_root)
            routes.append(FrontendRoute(route_path, component, source))
    if not routes:
        raise ValueError("No literal React Router routes found in frontend/src production source")
    return routes


def frontend_exports(text: str) -> list[str]:
    """Return conservative named/default export signals from frontend source."""
    names = set(
        re.findall(
            r"\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)",
            text,
        )
    )
    default_match = re.search(r"\bexport\s+default\s+([A-Za-z_$][\w$]*)", text)
    if default_match:
        names.add(default_match.group(1))
    return sorted(names)


def build_frontend_catalog(app_root: Path) -> str:
    """Generate frontend routes, modules, exports, and literal API references."""
    source_root = app_root / "frontend" / "src"
    files = frontend_files(source_root, include_tests=False)
    routes = collect_frontend_routes(app_root, files=files)

    lines = generated_header(
        "Frontend catalog",
        "Static catalog of owned React source. Literal API paths are a lower bound because "
        "many calls construct URLs dynamically.",
    )
    lines.extend(
        [
            "## Application routes",
            "",
            "| Browser path | Component | Source |",
            "| --- | --- | --- |",
        ]
    )
    for route in routes:
        source = route.source
        source_display = (
            source_link(source)
            if source != "unresolved" and source.startswith("frontend/")
            else f"`{source}`"
        )
        lines.append(f"| `{route.path}` | `{route.component}` | {source_display} |")

    grouped: dict[str, list[Path]] = defaultdict(list)
    metrics: dict[Path, tuple[int, list[str], list[str]]] = {}
    for path in files:
        relative = path.relative_to(source_root)
        group = relative.parts[0] if len(relative.parts) > 1 else "application root"
        grouped[group].append(path)
        text = read_text(path)
        metrics[path] = (
            len(text.splitlines()),
            frontend_exports(text),
            sorted(set(FRONTEND_API_RE.findall(text))),
        )

    lines.extend(
        [
            "",
            "## Source groups",
            "",
            "| Group | Files | Lines | Literal API references |",
            "| --- | ---: | ---: | ---: |",
        ]
    )
    for group in sorted(grouped):
        group_lines = sum(metrics[path][0] for path in grouped[group])
        group_apis = sum(len(metrics[path][2]) for path in grouped[group])
        lines.append(f"| `{group}` | {len(grouped[group])} | {group_lines} | {group_apis} |")

    for group in sorted(grouped):
        lines.extend(
            [
                "",
                f"## {group}",
                "",
                "| Source | Lines | Export signals | Literal API paths |",
                "| --- | ---: | --- | --- |",
            ]
        )
        for path in grouped[group]:
            source_lines, exports, api_paths = metrics[path]
            lines.append(
                "| "
                + " | ".join(
                    [
                        source_link(relative_posix(path, app_root)),
                        str(source_lines),
                        markdown_cell(", ".join(f"`{item}`" for item in exports)),
                        markdown_cell(", ".join(f"`{item}`" for item in api_paths)),
                    ]
                )
                + " |"
            )
    lines.append("")
    return "\n".join(lines)
