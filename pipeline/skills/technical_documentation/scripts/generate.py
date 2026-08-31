#!/usr/bin/env python3
"""Generate deterministic source catalogs for the Gnosi engineering portal."""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import TypedDict

if not __package__:
    sys.path.insert(0, str(Path(__file__).resolve().parents[4]))

from pipeline.skills.technical_documentation.scripts.api_catalog import (
    HTTP_METHODS as HTTP_METHODS,
    RouteOperation as RouteOperation,
    RouterConfiguration as RouterConfiguration,
    RouterRegistration as RouterRegistration,
    _accepts_canonical_router as _accepts_canonical_router,
    _declares_added_router_routes as _declares_added_router_routes,
    _import_target as _import_target,
    _python_module_path as _python_module_path,
    _top_level_call as _top_level_call,
    build_api_catalog as build_api_catalog,
    declares_router as declares_router,
    dependency_summary as dependency_summary,
    imported_router_registrars as imported_router_registrars,
    parse_added_router_routes as parse_added_router_routes,
    parse_direct_app_routes as parse_direct_app_routes,
    parse_route_module as parse_route_module,
    parse_router_registration as parse_router_registration,
    resolve_registered_router as resolve_registered_router,
    route_decorator_details as route_decorator_details,
    router_configuration as router_configuration,
)
from pipeline.skills.technical_documentation.scripts.backend_catalog import (
    build_backend_catalog as build_backend_catalog,
    python_module_metrics as python_module_metrics,
)
from pipeline.skills.technical_documentation.scripts.catalog_common import (
    EXCLUDED_FILE_NAMES as EXCLUDED_FILE_NAMES,
    EXCLUDED_FILE_PARTS as EXCLUDED_FILE_PARTS,
    GENERATE_COMMAND as GENERATE_COMMAND,
    GENERATED_NOTICE as GENERATED_NOTICE,
    PUBLIC_SOURCE_BASE as PUBLIC_SOURCE_BASE,
    SECRET_NAME_RE as SECRET_NAME_RE,
    SOURCE_SUFFIXES as SOURCE_SUFFIXES,
    TEST_NAME_RE as TEST_NAME_RE,
    constant_string as constant_string,
    expression_name as expression_name,
    first_doc_line as first_doc_line,
    frontend_files as frontend_files,
    generated_header as generated_header,
    is_owned_inventory_file as is_owned_inventory_file,
    join_url_paths as join_url_paths,
    keyword as keyword,
    markdown_cell as markdown_cell,
    python_files as python_files,
    read_text as read_text,
    relative_posix as relative_posix,
    safe_unparse as safe_unparse,
    source_link as source_link,
    string_list as string_list,
)
from pipeline.skills.technical_documentation.scripts.configuration_catalog import (
    FRONTEND_ENV_RE as FRONTEND_ENV_RE,
    EnvironmentReference as EnvironmentReference,
    PythonEnvironmentVisitor as PythonEnvironmentVisitor,
    build_configuration_catalog as build_configuration_catalog,
    collect_environment_references as collect_environment_references,
    format_environment_default as format_environment_default,
)
from pipeline.skills.technical_documentation.scripts.frontend_catalog import (
    FRONTEND_API_RE as FRONTEND_API_RE,
    LAZY_IMPORT_RE as LAZY_IMPORT_RE,
    ROUTE_RE as ROUTE_RE,
    STATIC_IMPORT_RE as STATIC_IMPORT_RE,
    FrontendRoute as FrontendRoute,
    build_frontend_catalog as build_frontend_catalog,
    collect_frontend_routes as collect_frontend_routes,
    frontend_exports as frontend_exports,
    frontend_imports as frontend_imports,
    resolve_frontend_import as resolve_frontend_import,
)
from pipeline.skills.technical_documentation.scripts.inventory_catalogs import (
    build_repository_inventory as build_repository_inventory,
    build_skill_catalog as build_skill_catalog,
    build_test_catalog as build_test_catalog,
    count_python_tests as count_python_tests,
    first_markdown_heading as first_markdown_heading,
)
from pipeline.skills.technical_documentation.scripts.model_catalog import (
    annotation_contains_none as annotation_contains_none,
    boolean_keyword as boolean_keyword,
    build_data_model_catalog as build_data_model_catalog,
    column_declaration as column_declaration,
    column_foreign_key as column_foreign_key,
    column_nullable as column_nullable,
    mapped_annotation_type as mapped_annotation_type,
)

log = logging.getLogger(__name__)


def find_app_root(start: Path) -> Path:
    """Return the application root containing the backend and frontend trees."""
    for candidate in (start.resolve(), *start.resolve().parents):
        if (candidate / "backend").is_dir() and (candidate / "frontend").is_dir():
            return candidate
    raise RuntimeError(f"Could not locate the Gnosi application root from {start}")


def find_project_root(start: Path) -> Path:
    """Return the repository root that may own private development directives.

    Canonical generation must not change merely because the checkout happens
    to live below a private workspace repository. External memory can still be
    supplied explicitly with ``--project-root`` for local audits.
    """
    return find_app_root(start)


class DomainCoverage(TypedDict):
    """Validated fields from the curated domain coverage configuration."""

    id: str
    name: str
    guide: str
    source_globs: list[str]
    test_globs: list[str]
    directives: list[str]


def domain_string(value: object, field: str) -> str:
    """Reject malformed domain labels and paths rather than coerce them."""
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Domain field {field} must be a nonempty string")
    return value


def domain_string_list(value: object, field: str) -> list[str]:
    """Retain ordered string lists, including valid empty test/directive lists."""
    if not isinstance(value, list):
        raise ValueError(f"Domain field {field} must be a string list")
    return [domain_string(entry, field) for entry in value]


def load_domains(config_path: Path) -> list[DomainCoverage]:
    """Load and minimally validate the curated domain coverage configuration."""
    data = json.loads(read_text(config_path))
    if not isinstance(data, list):
        raise ValueError("domains.json must contain a list")
    domains: list[DomainCoverage] = []
    for item in data:
        if not isinstance(item, dict):
            raise ValueError("Every domain entry must be an object")
        required = {"id", "name", "guide", "source_globs", "test_globs", "directives"}
        missing = required - item.keys()
        if missing:
            raise ValueError(f"Domain {item.get('id', '<unknown>')} misses {sorted(missing)}")
        domains.append(
            {
                "id": domain_string(item["id"], "id"),
                "name": domain_string(item["name"], "name"),
                "guide": domain_string(item["guide"], "guide"),
                "source_globs": domain_string_list(item["source_globs"], "source_globs"),
                "test_globs": domain_string_list(item["test_globs"], "test_globs"),
                "directives": domain_string_list(item["directives"], "directives"),
            }
        )
    return domains


def matches_for_globs(app_root: Path, patterns: list[str]) -> list[Path]:
    """Resolve application-relative glob patterns with stable de-duplication."""
    matches: set[Path] = set()
    for pattern in patterns:
        matches.update(path for path in app_root.glob(pattern) if is_owned_inventory_file(path))
    return sorted(matches)


def build_coverage_catalog(app_root: Path, project_root: Path, domains_path: Path) -> str:
    """Generate the curated capability-to-source documentation matrix."""
    domains = load_domains(domains_path)
    lines = generated_header(
        "Documentation coverage",
        "Curated traceability matrix connecting product domains to reviewed guides, source, "
        "tests, and development-memory directives. "
        "File presence proves traceability, not behavior.",
    )
    lines.extend(
        [
            "| Domain | Status | Guide | Source files | Test files | Directives found |",
            "| --- | --- | --- | ---: | ---: | ---: |",
        ]
    )
    details: list[str] = []
    for item in domains:
        domain_id = str(item["id"])
        name = str(item["name"])
        guide = app_root / str(item["guide"])
        sources = matches_for_globs(app_root, [str(value) for value in item["source_globs"]])
        tests = matches_for_globs(app_root, [str(value) for value in item["test_globs"]])
        directive_paths = [
            project_root / "docs" / "dev_memory" / "directives" / str(value)
            for value in item["directives"]
        ]
        directives = [path for path in directive_paths if path.is_file()]
        directive_root = project_root / "docs" / "dev_memory" / "directives"
        if directive_root.is_dir() and item["directives"] and not directives:
            log.warning(
                "Domain %s declares %d directive(s) but none were found under "
                "%s/docs/dev_memory/directives — check --project-root.",
                domain_id,
                len(item["directives"]),
                project_root,
            )
        status = "covered" if guide.is_file() and sources else "gap"
        guide_source = relative_posix(guide, app_root) if guide.is_file() else str(item["guide"])
        guide_link = (
            f"[`{name}`](../{guide_source.removeprefix('docs/engineering/')})"
            if guide.is_file()
            else f"`{guide_source}`"
        )
        lines.append(
            f"| `{domain_id}` | **{status}** | {guide_link} | "
            f"{len(sources)} | {len(tests)} | {len(directives)} |"
        )
        details.extend(
            [
                "",
                f"## {name}",
                "",
                f"- Guide: {guide_link}",
                f"- Source patterns: {', '.join(f'`{value}`' for value in item['source_globs'])}",
                f"- Test patterns: {', '.join(f'`{value}`' for value in item['test_globs'])}",
                "- Directives: "
                + (
                    ", ".join(f"`docs/dev_memory/directives/{path.name}`" for path in directives)
                    or "none found"
                ),
            ]
        )
    lines.extend(details)
    lines.append("")
    return "\n".join(lines)


def build_outputs(app_root: Path, project_root: Path, domains_path: Path) -> dict[str, str]:
    """Build every generated page in a stable order."""
    return {
        "api-catalog.md": build_api_catalog(app_root),
        "backend-modules.md": build_backend_catalog(app_root),
        "configuration.md": build_configuration_catalog(app_root),
        "coverage.md": build_coverage_catalog(app_root, project_root, domains_path),
        "data-model.md": build_data_model_catalog(app_root),
        "frontend-catalog.md": build_frontend_catalog(app_root),
        "repository-inventory.md": build_repository_inventory(app_root, project_root),
        "skills.md": build_skill_catalog(app_root),
        "tests.md": build_test_catalog(app_root),
    }


def write_or_check(outputs: dict[str, str], output_dir: Path, check: bool) -> int:
    """Write generated pages or report deterministic differences."""
    stale: list[str] = []
    for name, content in outputs.items():
        expected = f"{content.rstrip()}\n"
        path = output_dir / name
        if check:
            current = read_text(path) if path.is_file() else ""
            if current != expected:
                stale.append(name)
        else:
            output_dir.mkdir(parents=True, exist_ok=True)
            path.write_text(expected, encoding="utf-8")
            log.info("Generated %s", path)

    existing = {path.name for path in output_dir.glob("*.md")} if output_dir.exists() else set()
    unexpected = sorted(existing - outputs.keys())
    if check and (stale or unexpected):
        if stale:
            log.error("Stale or missing generated pages: %s", ", ".join(stale))
        if unexpected:
            log.error("Unexpected generated pages: %s", ", ".join(unexpected))
        return 1
    if check:
        log.info("All %d generated pages are current", len(outputs))
    return 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Fail if committed generated pages differ from current source.",
    )
    parser.add_argument(
        "--app-root",
        type=Path,
        help="Override the auto-detected Gnosi application root.",
    )
    parser.add_argument(
        "--project-root",
        type=Path,
        help=(
            "Override the repository root that owns docs/dev_memory/directives. "
            "Defaults to auto-detection from the script location."
        ),
    )
    parser.add_argument(
        "--domains",
        type=Path,
        help="Override the curated domains JSON file.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """Generate or verify the engineering reference catalogs."""
    args = parse_args(argv or sys.argv[1:])
    app_root = (args.app_root or find_app_root(Path(__file__))).resolve()
    project_root = (args.project_root or find_project_root(Path(__file__))).resolve()
    domains_path = (
        args.domains
        or app_root / "pipeline" / "skills" / "technical_documentation" / "domains.json"
    )
    if not domains_path.is_file():
        log.error("Domain configuration not found: %s", domains_path)
        return 2
    output_dir = app_root / "docs" / "engineering" / "generated"
    try:
        outputs = build_outputs(app_root, project_root, domains_path)
    except (OSError, SyntaxError, ValueError, json.JSONDecodeError) as exc:
        log.error("Documentation generation failed: %s", exc)
        return 2
    return write_or_check(outputs, output_dir, args.check)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    raise SystemExit(main())
