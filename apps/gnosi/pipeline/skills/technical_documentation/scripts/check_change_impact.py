#!/usr/bin/env python3
"""Require public engineering documentation for high-impact Gnosi changes."""

from __future__ import annotations

import argparse
from pathlib import Path, PurePosixPath
import subprocess
import sys


APP_ROOT = Path(__file__).resolve().parents[4]
REPOSITORY_ROOT = APP_ROOT.parents[2]
APP_PREFIX = "monorepo/apps/gnosi/"
IMPLEMENTATION_PREFIXES = (
    f"{APP_PREFIX}backend/",
    f"{APP_PREFIX}electron/",
    f"{APP_PREFIX}frontend/src/",
    f"{APP_PREFIX}integrations/",
    f"{APP_PREFIX}mcp-servers/",
    f"{APP_PREFIX}sh/",
    f"{APP_PREFIX}web-clipper/",
)
IMPLEMENTATION_FILES = {
    f"{APP_PREFIX}docker-compose.yml",
    f"{APP_PREFIX}Dockerfile.backend",
    f"{APP_PREFIX}Dockerfile.frontend",
    f"{APP_PREFIX}package.json",
    f"{APP_PREFIX}requirements.txt",
}
HIGH_IMPACT_PREFIXES = (
    f"{APP_PREFIX}backend/",
    f"{APP_PREFIX}electron/",
    f"{APP_PREFIX}integrations/",
    f"{APP_PREFIX}mcp-servers/",
    f"{APP_PREFIX}sh/",
    f"{APP_PREFIX}web-clipper/",
)
HIGH_IMPACT_FRONTEND_PREFIXES = (
    f"{APP_PREFIX}frontend/src/components/Auth",
    f"{APP_PREFIX}frontend/src/components/Layout",
    f"{APP_PREFIX}frontend/src/context/",
    f"{APP_PREFIX}frontend/src/providers/",
    f"{APP_PREFIX}frontend/src/routes/",
)
HIGH_IMPACT_FILES = IMPLEMENTATION_FILES | {
    f"{APP_PREFIX}frontend/package.json",
    f"{APP_PREFIX}frontend/src/App.jsx",
    f"{APP_PREFIX}frontend/src/main.jsx",
}
SOURCE_SUFFIXES = {
    ".cjs",
    ".html",
    ".js",
    ".jsx",
    ".mjs",
    ".py",
    ".sh",
    ".ts",
    ".tsx",
}
EXCLUDED_PARTS = {
    "__pycache__",
    "dist",
    "node_modules",
    "site",
    "test-results",
    "tests",
    "vendor",
}
DOCUMENTATION_PREFIX = f"{APP_PREFIX}docs/engineering/"
DEPENDENCY_MANIFEST_NAMES = {
    "Pipfile",
    "Pipfile.lock",
    "poetry.lock",
    "package-lock.json",
    "package.json",
    "pyproject.toml",
    "requirements.txt",
    "uv.lock",
}


def is_implementation_path(path: str) -> bool:
    """Return whether a repository path can change shipped behavior."""
    if path in IMPLEMENTATION_FILES:
        return True
    pure_path = PurePosixPath(path)
    if pure_path.suffix not in SOURCE_SUFFIXES:
        return False
    if EXCLUDED_PARTS.intersection(pure_path.parts):
        return False
    return path.startswith(IMPLEMENTATION_PREFIXES)


def requires_documentation_path(path: str) -> bool:
    """Return whether a path can alter a documented system boundary."""
    if path in HIGH_IMPACT_FILES:
        return True
    pure_path = PurePosixPath(path)
    if pure_path.suffix not in SOURCE_SUFFIXES:
        return False
    if EXCLUDED_PARTS.intersection(pure_path.parts):
        return False
    return path.startswith(HIGH_IMPACT_PREFIXES + HIGH_IMPACT_FRONTEND_PREFIXES)


def is_documentation_evidence(path: str) -> bool:
    """Return whether a path updates public English engineering documentation."""
    return path.startswith(DOCUMENTATION_PREFIX) and path.endswith(".md")


def is_dependency_manifest_path(path: str) -> bool:
    """Return whether a path is a supported dependency manifest or lockfile."""
    return PurePosixPath(path).name in DEPENDENCY_MANIFEST_NAMES


def is_dependency_only_change(paths: set[str]) -> bool:
    """Return whether the change set contains only dependency metadata."""
    return bool(paths) and all(is_dependency_manifest_path(path) for path in paths)


def validate_change_set(paths: set[str]) -> list[str]:
    """Require documentation evidence for changes with architectural impact."""
    if is_dependency_only_change(paths):
        return []
    high_impact = sorted(path for path in paths if requires_documentation_path(path))
    if not high_impact:
        return []
    if any(is_documentation_evidence(path) for path in paths):
        return []
    return [
        "High-impact Gnosi changes require an update under "
        "monorepo/apps/gnosi/docs/engineering/. Changed high-impact files: "
        + ", ".join(high_impact[:8])
    ]


def changed_files(base_ref: str) -> set[str]:
    """Return repository-relative paths changed from a Git base reference."""
    if not base_ref or set(base_ref) == {"0"}:
        return set()
    result = subprocess.run(
        ["git", "diff", "--name-only", f"{base_ref}...HEAD"],
        cwd=REPOSITORY_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return {line.strip() for line in result.stdout.splitlines() if line.strip()}


def main() -> int:
    """Validate the current Git change set."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-ref", default="")
    args = parser.parse_args()

    if not args.base_ref:
        print("No base reference supplied; documentation impact check skipped")
        return 0

    errors = validate_change_set(changed_files(args.base_ref))
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1

    print("Functional change documentation impact verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
