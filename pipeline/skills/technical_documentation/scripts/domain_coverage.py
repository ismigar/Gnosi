"""Curated source ownership shared by documentation generation and validation."""

from __future__ import annotations

import json
from pathlib import Path
from typing import TypedDict

from pipeline.skills.technical_documentation.scripts.catalog_common import (
    frontend_files,
    is_owned_inventory_file,
    read_text,
)


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
        matches.update(
            path for path in app_root.glob(pattern)
            if is_owned_inventory_file(path, root=app_root)
        )
    return sorted(matches)


def untraced_frontend_features(
    app_root: Path, domains: list[DomainCoverage],
) -> list[str]:
    """Find feature modules without any production source in curated ownership.

    Tests, assets and local build artifacts cannot stand in for production
    source. A match establishes a navigation path, not behavioral acceptance.
    """
    feature_root = app_root / "frontend" / "src" / "features"
    production_by_module: dict[str, set[Path]] = {}
    for path in frontend_files(feature_root, include_tests=False):
        parts = path.relative_to(feature_root).parts
        if len(parts) > 1:
            production_by_module.setdefault(parts[0], set()).add(path)
    traced = set(matches_for_globs(
        app_root,
        [pattern for domain in domains for pattern in domain["source_globs"]],
    ))
    return sorted(
        name for name, sources in production_by_module.items()
        if not sources.intersection(traced)
    )
