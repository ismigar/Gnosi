#!/usr/bin/env python3
"""Prevent new or worsening Gnosi backend size and complexity violations."""

from __future__ import annotations

import argparse
import json
import logging
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any


log = logging.getLogger(__name__)
MAX_LINES = 800
MAX_COMPLEXITY = 15
DEFAULT_BASELINE = Path("backend/tests/contracts/backend_guardrail_allowlist.json")
COMPLEXITY_RE = re.compile(r"\((\d+)\s*>\s*\d+\)")


def _production_modules(root: Path) -> list[Path]:
    modules: list[Path] = []
    for path in sorted((root / "backend").rglob("*.py")):
        relative = path.relative_to(root)
        if "tests" in relative.parts:
            continue
        if relative.parts[:4] == ("backend", "migrations", "alembic", "versions"):
            continue
        modules.append(path)
    return modules


def _line_violations(root: Path) -> dict[str, int]:
    return {
        path.relative_to(root).as_posix(): len(path.read_text(encoding="utf-8").splitlines())
        for path in _production_modules(root)
        if len(path.read_text(encoding="utf-8").splitlines()) > MAX_LINES
    }


def _complexity_violations(root: Path) -> dict[str, int]:
    executable = shutil.which("ruff")
    if not executable:
        raise RuntimeError("Ruff is unavailable; run this command through uv.")
    result = subprocess.run(
        [
            executable,
            "check",
            "--select",
            "C901",
            "--config",
            f"lint.mccabe.max-complexity={MAX_COMPLEXITY}",
            "--output-format=json",
            "backend",
        ],
        cwd=root,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode not in {0, 1}:
        raise RuntimeError(result.stderr.strip() or "Ruff complexity audit failed.")
    findings = json.loads(result.stdout or "[]")
    violations: dict[str, int] = {}
    for finding in findings:
        if not isinstance(finding, dict) or finding.get("code") != "C901":
            continue
        filename = Path(str(finding.get("filename") or ""))
        try:
            relative = filename.resolve().relative_to(root).as_posix()
        except ValueError:
            continue
        if relative.startswith("backend/tests/"):
            continue
        match = COMPLEXITY_RE.search(str(finding.get("message") or ""))
        if match:
            violations[relative] = max(violations.get(relative, 0), int(match.group(1)))
    return violations


def current_violations(root: Path) -> dict[str, dict[str, Any]]:
    """Return every current handwritten production violation by path."""
    lines = _line_violations(root)
    complexity = _complexity_violations(root)
    return {
        path: {
            "max_lines": lines.get(path, MAX_LINES),
            "max_complexity": complexity.get(path, MAX_COMPLEXITY),
            "reason": "Legacy debt scheduled for Gnosi PRs 4-6",
        }
        for path in sorted(set(lines) | set(complexity))
    }


def _write_baseline(path: Path, violations: dict[str, dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "format": "gnosi-backend-guardrails-v1",
        "limits": {"lines": MAX_LINES, "complexity": MAX_COMPLEXITY},
        "allowlist": violations,
    }
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def check_baseline(
    violations: dict[str, dict[str, Any]],
    baseline: dict[str, Any],
    require_pruned: bool,
) -> list[str]:
    """Return actionable errors for new, worsening or stale violations."""
    allowlist = baseline.get("allowlist")
    if baseline.get("format") != "gnosi-backend-guardrails-v1" or not isinstance(
        allowlist, dict
    ):
        return ["The backend guardrail baseline has an unsupported format."]
    errors: list[str] = []
    for path, current in violations.items():
        accepted = allowlist.get(path)
        if not isinstance(accepted, dict):
            errors.append(f"New source guardrail violation: {path}")
            continue
        for key in ("max_lines", "max_complexity"):
            if int(current[key]) > int(accepted.get(key, 0)):
                errors.append(
                    f"Worsened {key} for {path}: {current[key]} > {accepted.get(key)}"
                )
    if require_pruned:
        for path in sorted(set(allowlist) - set(violations)):
            errors.append(f"Prune resolved source guardrail entry: {path}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE)
    parser.add_argument("--write-baseline", action="store_true")
    parser.add_argument("--require-pruned", action="store_true")
    args = parser.parse_args()
    root = args.root.expanduser().resolve()
    baseline_path = args.baseline
    if not baseline_path.is_absolute():
        baseline_path = root / baseline_path
    violations = current_violations(root)
    if args.write_baseline:
        _write_baseline(baseline_path, violations)
        log.info("Wrote %s source guardrail entries.", len(violations))
        return 0
    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    errors = check_baseline(violations, baseline, args.require_pruned)
    for error in errors:
        log.error(error)
    if errors:
        return 1
    log.info("Source guardrails passed with %s temporary entries.", len(violations))
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    raise SystemExit(main())
