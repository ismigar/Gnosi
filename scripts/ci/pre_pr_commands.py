"""Reviewed local subsets of the existing shared-CI validation commands."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

DOCS = "pipeline/skills/technical_documentation/scripts"


@dataclass(frozen=True)
class Step:
    name: str
    arguments: tuple[str, ...]


def _python(name: str, *arguments: str) -> Step:
    return Step(name, ("uv", "run", *arguments))


def build_steps(root: Path, base_sha: str, *, quick: bool) -> list[Step]:
    """Keep local commands explicit; never execute shell text from a workflow."""
    ci_tests = sorted(
        path.relative_to(root).as_posix() for path in (root / "backend/tests").glob("test_ci_*.py")
    )
    if not ci_tests:
        raise ValueError("CI contract test collection is empty")
    steps = [
        Step("Pinned Node and pnpm", ("node", "scripts/verify-toolchain.mjs")),
        Step(
            "Locked Python environment",
            ("uv", "sync", "--frozen", "--check", "--inexact", "--group", "docs-ci"),
        ),
        Step("Whitespace and conflict markers", ("git", "diff", "--check", "HEAD")),
        _python("Public pipeline", "python", "scripts/check_public_pipeline.py"),
        _python("Pipeline structure", "python", "scripts/check_public_pipeline.py", "--structure"),
        _python("Public runtime", "python", "scripts/check_public_runtime.py"),
        _python(
            "Python lint",
            "ruff",
            "check",
            "backend",
            "pipeline",
            "scripts",
            "extensions/mcp/drupal-proxy",
        ),
        _python(
            "Backend guardrails", "python", "scripts/check-source-guardrails.py", "--require-pruned"
        ),
        Step("Frontend guardrails", ("pnpm", "guardrails:frontend")),
        Step("Frontend lint", ("pnpm", "lint:frontend")),
        Step("Frontend types", ("pnpm", "--filter", "@gnosi/frontend", "typecheck")),
        Step("Desktop IPC types", ("pnpm", "--filter", "@gnosi/desktop", "typecheck:ipc")),
        Step("E2E setup contracts and types", ("pnpm", "test:e2e:contracts")),
        _python(
            "CI and pre-PR regressions",
            "python",
            "-m",
            "pytest",
            *ci_tests,
            "backend/tests/test_root_typecheck_contract.py",
            "backend/tests/test_pre_pr_validation.py",
            "-q",
            "-p",
            "no:cacheprovider",
        ),
    ]
    if quick:
        steps.extend(
            [
                _python(
                    "Documentation change impact",
                    "python",
                    f"{DOCS}/check_change_impact.py",
                    "--base-ref",
                    base_sha,
                ),
                _python("Generated documentation", "python", f"{DOCS}/generate.py", "--check"),
                _python("Documentation traceability", "python", f"{DOCS}/validate.py"),
                _python("Documentation locales", "python", f"{DOCS}/localize.py", "--check"),
            ]
        )
        return steps
    resources = ("desktop/scripts/backend_resources.py", "desktop/tests/test_backend_resources.py")
    steps.extend(
        [
            Step("OpenAPI and frontend API contracts", ("pnpm", "check:api-client")),
            _python(
                "Complete backend types",
                "mypy",
                "--strict",
                "--exclude",
                "^backend/tests/",
                "backend",
            ),
            _python(
                "Complete pipeline types",
                "python",
                "scripts/check_public_pipeline.py",
                "--typecheck",
            ),
            _python("Frozen resource lint", "ruff", "check", "--select", "E,F,I", *resources),
            _python(
                "Frozen resource types", "mypy", "--strict", "--explicit-package-bases", *resources
            ),
            _python(
                "Frozen resource source policy",
                "python",
                resources[0],
                "check-source",
                "--repository",
                ".",
            ),
            _python(
                "Python syntax",
                "python",
                "-m",
                "compileall",
                "-q",
                "backend",
                "pipeline",
                "scripts",
                "extensions",
            ),
            _python("Complete Python suite", "pytest"),
            Step("Complete frontend suite", ("pnpm", "test:frontend")),
            Step("Production frontend build", ("pnpm", "build:frontend")),
            Step("Complete desktop suite", ("pnpm", "test:desktop")),
            _python(
                "Complete documentation update gate",
                "python",
                f"{DOCS}/pre_pr.py",
                "--base-ref",
                base_sha,
            ),
        ]
    )
    return steps
