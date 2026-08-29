#!/usr/bin/env python3
"""Fail when frontend network access bypasses reviewed shared boundaries."""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Mapping
from pathlib import Path


LOG = logging.getLogger(__name__)
REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_ROOT = REPOSITORY_ROOT / "frontend"
SOURCE_ROOT = FRONTEND_ROOT / "src"
ALLOWLIST_PATH = FRONTEND_ROOT / "api-boundaries.json"
SOURCE_SUFFIXES = frozenset({".cjs", ".html", ".js", ".jsx", ".mjs", ".ts", ".tsx"})

PATTERNS: Mapping[str, re.Pattern[str]] = {
    "directFetch": re.compile(r"(?<![\w$.])(?:globalThis\.)?fetch\s*\("),
    "eventSource": re.compile(r"\bnew\s+(?:globalThis\.|window\.)?EventSource\s*\("),
    "streamReader": re.compile(r"\.body(?:\?)?\.getReader\s*\("),
    "webSocket": re.compile(r"\bnew\s+(?:globalThis\.|window\.)?WebSocket\s*\("),
    "xmlHttpRequest": re.compile(r"\bnew\s+XMLHttpRequest\s*\("),
}
AXIOS_SPECIFIER = re.compile(
    r"(?:\bfrom\s*|\bvi\.mock\(\s*|\bimport\(\s*|\brequire\(\s*)"
    r"(?P<quote>['\"])axios(?P=quote)"
)
GLOBAL_FETCH_ASSIGNMENT = re.compile(r"^\s*(?:globalThis|window)\.fetch\s*=", re.MULTILINE)
LEGACY_HTTP_IMPORT = re.compile(
    r"(?:\bfrom\s*|\bimport\(\s*|\brequire\(\s*)"
    r"(?P<quote>['\"]).*shared/api/legacy-http(?P=quote)"
)
MAX_LEGACY_HTTP_CONSUMERS = 3


def _relative(path: Path) -> str:
    return path.relative_to(REPOSITORY_ROOT).as_posix()


def _load_allowlist() -> dict[str, dict[str, str]]:
    raw: object = json.loads(ALLOWLIST_PATH.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("Frontend API allowlist must be a JSON object")
    normalized: dict[str, dict[str, str]] = {}
    for category in PATTERNS:
        entries = raw.get(category)
        if not isinstance(entries, dict):
            raise ValueError(f"Missing object allowlist category: {category}")
        clean: dict[str, str] = {}
        for path, reason in entries.items():
            if not isinstance(path, str) or not isinstance(reason, str) or not reason.strip():
                raise ValueError(f"Invalid {category} allowlist entry: {path!r}")
            clean[path] = reason.strip()
        normalized[category] = clean
    return normalized


def _production_sources() -> list[Path]:
    return [
        path
        for path in sorted(SOURCE_ROOT.rglob("*"))
        if (
            path.is_file()
            and path.suffix in SOURCE_SUFFIXES
            and ".test." not in path.name
            and ".spec." not in path.name
        )
    ]


def _all_source_specifiers() -> list[str]:
    violations: list[str] = []
    for path in sorted(SOURCE_ROOT.rglob("*")):
        if path.is_file() and path.suffix in SOURCE_SUFFIXES:
            text = path.read_text(encoding="utf-8")
            if AXIOS_SPECIFIER.search(text):
                violations.append(_relative(path))
    return violations


def _legacy_http_consumers() -> list[str]:
    return [
        _relative(path)
        for path in _production_sources()
        if LEGACY_HTTP_IMPORT.search(path.read_text(encoding="utf-8"))
    ]


def _package_has_axios() -> bool:
    package: object = json.loads((FRONTEND_ROOT / "package.json").read_text(encoding="utf-8"))
    if not isinstance(package, dict):
        raise ValueError("frontend/package.json must be an object")
    for section in ("dependencies", "devDependencies", "optionalDependencies", "peerDependencies"):
        dependencies = package.get(section, {})
        if isinstance(dependencies, dict) and "axios" in dependencies:
            return True
    return False


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    allowlist = _load_allowlist()
    findings: dict[str, set[str]] = {category: set() for category in PATTERNS}
    global_assignments: list[str] = []

    for source_path in _production_sources():
        text = source_path.read_text(encoding="utf-8")
        relative = _relative(source_path)
        for category, pattern in PATTERNS.items():
            if pattern.search(text):
                findings[category].add(relative)
        if GLOBAL_FETCH_ASSIGNMENT.search(text):
            global_assignments.append(relative)

    violations: list[str] = []
    for category, found in findings.items():
        expected = set(allowlist[category])
        unexpected = sorted(found - expected)
        stale = sorted(expected - found)
        violations.extend(f"{category}: unreviewed boundary in {path}" for path in unexpected)
        violations.extend(f"{category}: stale allowlist entry for {path}" for path in stale)
        for allowlisted_path in expected:
            if not (REPOSITORY_ROOT / allowlisted_path).is_file():
                violations.append(
                    f"{category}: allowlisted path does not exist: {allowlisted_path}"
                )

    axios_specifiers = _all_source_specifiers()
    legacy_http_consumers = _legacy_http_consumers()
    violations.extend(f"axios module specifier remains in {path}" for path in axios_specifiers)
    if len(legacy_http_consumers) > MAX_LEGACY_HTTP_CONSUMERS:
        violations.append(
            "legacy-http consumer count increased: "
            f"{len(legacy_http_consumers)} > {MAX_LEGACY_HTTP_CONSUMERS}"
        )
    if _package_has_axios():
        violations.append("axios remains in frontend/package.json")
    violations.extend(f"global fetch assignment remains in {path}" for path in global_assignments)

    if violations:
        for violation in violations:
            LOG.error(violation)
        return 1

    report = {
        "allowlistedBoundaries": {
            category: len(paths) for category, paths in sorted(findings.items())
        },
        "axiosSpecifiers": 0,
        "globalFetchAssignments": 0,
        "legacyHttpConsumers": len(legacy_http_consumers),
        "legacyHttpMaximum": MAX_LEGACY_HTTP_CONSUMERS,
        "productionSources": len(_production_sources()),
    }
    LOG.info(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
