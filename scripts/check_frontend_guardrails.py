#!/usr/bin/env python3
"""Prevent new or worsening Gnosi frontend migration debt."""

from __future__ import annotations

import argparse
import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any


log = logging.getLogger(__name__)
MAX_LINES = 500
DEFAULT_BASELINE = Path("frontend/src/test/contracts/frontend_guardrail_allowlist.json")
SOURCE_SUFFIXES = {".js", ".jsx", ".ts", ".tsx"}
LEGACY_SUFFIXES = {".js", ".jsx"}
APPROVED_STORAGE_ADAPTERS = {
    "frontend/src/shared/platform/browser-storage.ts",
}
APPROVED_EVENT_ADAPTERS = {
    "frontend/src/shared/platform/app-events.ts",
    "frontend/src/shared/platform/browser-events.ts",
}
IMPORT_PATTERN = re.compile(
    # A secondary source-layout check, not a JavaScript parser. ESLint owns AST
    # validation (including dynamic/type imports and reexports). Do not scan
    # arbitrary quoted test fixtures as though they were module declarations.
    r"^[ \t]*(?:import\s+(?:(?:type\s+)?[\w$*{},\s]+?\s+from\s+)?"
    r"|export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]+\})\s+from\s+)"
    r"['\"]([^'\"]+)['\"]",
    re.MULTILINE,
)
STORAGE_PATTERN = re.compile(r"\b(?:localStorage|sessionStorage)\b")
EVENT_PATTERN = re.compile(
    r"\b(?:window\.(?:addEventListener|removeEventListener|dispatchEvent)|CustomEvent)\b"
)


@dataclass(frozen=True)
class FrontendMetrics:
    """Migration debt indexed by repository-relative source path."""

    legacy_js_jsx: dict[str, int]
    oversized_files: dict[str, int]
    direct_storage: dict[str, int]
    global_events: dict[str, int]
    feature_boundary_errors: list[str]

    def baseline_categories(self) -> dict[str, dict[str, int]]:
        return {
            "legacy_js_jsx": self.legacy_js_jsx,
            "oversized_files": self.oversized_files,
            "direct_storage": self.direct_storage,
            "global_events": self.global_events,
        }


def _production_sources(root: Path) -> list[Path]:
    source_root = root / "frontend" / "src"
    sources: list[Path] = []
    for path in sorted(source_root.rglob("*")):
        if not path.is_file() or path.suffix not in SOURCE_SUFFIXES:
            continue
        relative = path.relative_to(source_root)
        if "generated" in relative.parts:
            continue
        sources.append(path)
    return sources


def _feature_owner(relative_source: Path) -> str | None:
    parts = relative_source.parts
    if len(parts) >= 2 and parts[0] == "features":
        return parts[1]
    return None


def _import_parts(source_root: Path, source_file: Path, imported: str) -> tuple[str, ...]:
    specifier = re.split(r"[?#]", imported, maxsplit=1)[0]
    if specifier.startswith("@/"):
        candidate = (source_root / specifier[2:]).resolve()
    elif specifier.startswith("."):
        candidate = (source_file.parent / specifier).resolve()
    else:
        return ()
    try:
        relative = candidate.relative_to(source_root.resolve())
    except ValueError:
        return ()
    return relative.parts


def _feature_boundary_errors(root: Path, path: Path, text: str) -> list[str]:
    source_root = root / "frontend" / "src"
    relative_source = path.relative_to(source_root)
    owner = _feature_owner(relative_source)
    layer = relative_source.parts[0]
    errors: list[str] = []
    for imported in IMPORT_PATTERN.findall(text):
        parts = _import_parts(source_root, path, imported)
        if not parts:
            continue
        source = path.relative_to(root).as_posix()
        if layer == "shared" and parts[0] in {"app", "features"}:
            errors.append(f"{source} imports app/feature code into shared: {imported}")
        elif layer == "features" and parts[0] == "app":
            errors.append(f"{source} imports app composition into a feature: {imported}")
        elif len(parts) >= 2 and parts[0] == "features" and parts[1] != owner:
            public_entry = len(parts) == 2 or (
                len(parts) == 3 and re.fullmatch(r"index(?:\.[jt]sx?)?", parts[2])
            )
            if public_entry:
                continue
            errors.append(
                f"{source} imports private code from feature {parts[1]}: "
                f"{imported}"
            )
    return errors


def current_metrics(root: Path) -> FrontendMetrics:
    """Return every current migration guardrail metric."""
    legacy_js_jsx: dict[str, int] = {}
    oversized_files: dict[str, int] = {}
    direct_storage: dict[str, int] = {}
    global_events: dict[str, int] = {}
    feature_errors: list[str] = []

    for path in _production_sources(root):
        relative = path.relative_to(root).as_posix()
        text = path.read_text(encoding="utf-8")
        lines = len(text.splitlines())
        if path.suffix in LEGACY_SUFFIXES:
            legacy_js_jsx[relative] = lines
        if lines > MAX_LINES:
            oversized_files[relative] = lines
        if relative not in APPROVED_STORAGE_ADAPTERS:
            storage_count = len(STORAGE_PATTERN.findall(text))
            if storage_count:
                direct_storage[relative] = storage_count
        if relative not in APPROVED_EVENT_ADAPTERS:
            event_count = len(EVENT_PATTERN.findall(text))
            if event_count:
                global_events[relative] = event_count
        feature_errors.extend(_feature_boundary_errors(root, path, text))

    return FrontendMetrics(
        legacy_js_jsx=legacy_js_jsx,
        oversized_files=oversized_files,
        direct_storage=direct_storage,
        global_events=global_events,
        feature_boundary_errors=sorted(feature_errors),
    )


def _validated_categories(payload: dict[str, Any]) -> dict[str, dict[str, int]] | None:
    categories = payload.get("allowlist")
    if payload.get("format") != "gnosi-frontend-guardrails-v1" or not isinstance(
        categories, dict
    ):
        return None
    validated: dict[str, dict[str, int]] = {}
    for category in ("legacy_js_jsx", "oversized_files", "direct_storage", "global_events"):
        raw_entries = categories.get(category)
        if not isinstance(raw_entries, dict):
            return None
        entries: dict[str, int] = {}
        for path, value in raw_entries.items():
            if not isinstance(path, str) or not isinstance(value, int):
                return None
            entries[path] = value
        validated[category] = entries
    return validated


def check_baseline(
    metrics: FrontendMetrics,
    baseline: dict[str, Any],
    *,
    require_pruned: bool,
    require_zero: bool,
) -> list[str]:
    """Return actionable errors for new, worsening, stale, or final debt."""
    accepted_categories = _validated_categories(baseline)
    if accepted_categories is None:
        return ["The frontend guardrail baseline has an unsupported format."]

    errors = list(metrics.feature_boundary_errors)
    for category, current_entries in metrics.baseline_categories().items():
        accepted_entries = accepted_categories[category]
        for path, current_value in current_entries.items():
            accepted_value = accepted_entries.get(path)
            if accepted_value is None:
                errors.append(f"New frontend {category} violation: {path}")
            elif current_value > accepted_value:
                errors.append(
                    f"Worsened frontend {category} violation: {path}: "
                    f"{current_value} > {accepted_value}"
                )
            elif require_pruned and current_value < accepted_value:
                errors.append(
                    f"Tighten improved frontend {category} entry: {path}: "
                    f"{accepted_value} -> {current_value}"
                )
        if require_pruned:
            for path in sorted(set(accepted_entries) - set(current_entries)):
                errors.append(f"Prune resolved frontend {category} entry: {path}")
        if require_zero:
            for path in sorted(current_entries):
                errors.append(f"Unresolved frontend {category} violation: {path}")
    return errors


def _baseline_payload(metrics: FrontendMetrics) -> dict[str, Any]:
    return {
        "format": "gnosi-frontend-guardrails-v1",
        "limits": {"handwritten_file_lines": MAX_LINES, "component_lines": 300},
        "allowlist": metrics.baseline_categories(),
    }


def _report_payload(metrics: FrontendMetrics) -> dict[str, Any]:
    categories = metrics.baseline_categories()
    return {
        "counts": {category: len(entries) for category, entries in categories.items()},
        "feature_boundary_errors": metrics.feature_boundary_errors,
        "metrics": categories,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE)
    parser.add_argument("--write-baseline", action="store_true")
    parser.add_argument("--require-pruned", action="store_true")
    parser.add_argument("--require-zero", action="store_true")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    root = args.root.expanduser().resolve()
    baseline_path = args.baseline
    if not baseline_path.is_absolute():
        baseline_path = root / baseline_path
    metrics = current_metrics(root)

    if args.report:
        report_path = args.report
        if not report_path.is_absolute():
            report_path = root / report_path
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(
            json.dumps(_report_payload(metrics), indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

    if args.write_baseline:
        baseline_path.parent.mkdir(parents=True, exist_ok=True)
        baseline_path.write_text(
            json.dumps(_baseline_payload(metrics), indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        log.info(
            "Wrote frontend guardrail baseline: %s",
            {name: len(entries) for name, entries in metrics.baseline_categories().items()},
        )
        return 0

    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    errors = check_baseline(
        metrics,
        baseline,
        require_pruned=args.require_pruned,
        require_zero=args.require_zero,
    )
    for error in errors:
        log.error(error)
    if errors:
        return 1
    log.info(
        "Frontend guardrails passed: %s",
        {name: len(entries) for name, entries in metrics.baseline_categories().items()},
    )
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    raise SystemExit(main())
