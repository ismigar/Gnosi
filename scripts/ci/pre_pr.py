#!/usr/bin/env python3
"""Run existing local quality gates serially before publishing a pull request."""

from __future__ import annotations

import argparse
import hashlib
import logging
import os
import platform
import re
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path
from time import monotonic
from typing import Mapping, Sequence

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.ci.pre_pr_commands import Step, build_steps

ROOT = Path(__file__).resolve().parents[2]
LOG = logging.getLogger(__name__)
REMOTE_GATES = ("documentation", "backend", "frontend", "native-smoke", "docker")


def _git(root: Path, *arguments: str) -> str:
    return subprocess.run(
        ("git", *arguments),
        cwd=root,
        capture_output=True,
        text=True,
        check=True,
        timeout=30,
    ).stdout.strip()


def resolve_commit(root: Path, reference: str) -> str:
    """Pin a ref once, without fetching, switching branches, or using a shell."""
    if not reference or reference.startswith("-") or any(char.isspace() for char in reference):
        raise ValueError("Supply a non-empty Git base ref without whitespace or options")
    revision = _git(root, "rev-parse", "--verify", "--end-of-options", f"{reference}^{{commit}}")
    if not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", revision):
        raise ValueError("Git did not return a valid commit ID")
    return revision


def check_checkout(root: Path) -> None:
    """Index-based gates must not miss new source files or unresolved merges."""
    if _git(root, "ls-files", "--unmerged"):
        raise ValueError("Resolve merge conflicts before running the pre-PR gate")
    if _git(root, "ls-files", "--others", "--exclude-standard"):
        raise ValueError("Review and stage or ignore untracked files before running the gate")


def source_fingerprint(root: Path) -> tuple[str, str]:
    """Allow generated catalog refreshes, but reject source changes during validation."""
    exclusions = tuple(
        f":(exclude)docs/engineering{suffix}/generated" for suffix in ("", "-ca", "-es", "-fr")
    )
    changes = _git(
        root, "diff", "--no-ext-diff", "--no-textconv", "--binary", "HEAD", "--", ".", *exclusions
    )
    return resolve_commit(root, "HEAD"), hashlib.sha256(changes.encode("utf-8")).hexdigest()


def check_python_architecture() -> None:
    if sys.version_info[:2] != (3, 11):
        raise ValueError("Use the existing locked Python 3.11 environment")
    node_arch = subprocess.run(
        ("node", "-p", "process.arch"),
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    ).stdout.strip()
    python_arch = {"aarch64": "arm64", "AMD64": "x64", "x86_64": "x64"}.get(
        platform.machine(),
        platform.machine(),
    )
    if python_arch != node_arch:
        raise ValueError("Python and Node architectures differ; select matching native toolchains")


def isolated_environment(parent: Mapping[str, str], temporary: Path) -> dict[str, str]:
    """Do not inherit live API credentials, application paths, or live-test opt-ins."""
    environment = {
        name: value
        for name, value in parent.items()
        if not re.search(
            r"TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY|PRIVATE_KEY|AUTH", name, re.IGNORECASE
        )
        and not name.startswith(("GNOSI_", "DIGITAL_BRAIN_", "VAULT_", "HOME_HOST_", "LOCAL_DATA_"))
    }
    for directory in ("data", "vault", "host", "cache"):
        (temporary / directory).mkdir()
    environment.update(
        {
            "GNOSI_VALIDATION_ROOT": str(temporary),
            "GNOSI_DATA_DIR": str(temporary / "data"),
            "DIGITAL_BRAIN_VAULT_PATH": str(temporary / "vault"),
            "VAULT_HOST_PATH": str(temporary / "vault"),
            "HOME_HOST_PATH": str(temporary / "host"),
            "GNOSI_SHARED_ENV_FILE": str(temporary / "disabled.env"),
            "GNOSI_DISABLE_SCHEDULER": "1",
            "GNOSI_FILES_PROVIDER": "local",
            "GNOSI_RUN_LIVE_E2E": "0",
            "GNOSI_BACKEND_URL": "http://127.0.0.1:9",
            "GNOSI_BASE_URL": "http://127.0.0.1:9",
            "GNOSI_API_TOKEN": "",
            "GNOSI_TEST_STORAGE_STATE": str(temporary / "unused-auth-state.json"),
            "UV_NO_SYNC": "1",
            "UV_FROZEN": "1",
            "UV_CACHE_DIR": str(temporary / "cache" / "uv"),
            "pnpm_config_verify_deps_before_run": "error",
            "NODE_OPTIONS": "--max-old-space-size=4096",
            "GNOSI_VITEST_MAX_WORKERS": "1",
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONPYCACHEPREFIX": str(temporary / "cache" / "bytecode"),
            "MYPY_CACHE_DIR": str(temporary / "cache" / "mypy"),
            "RUFF_CACHE_DIR": str(temporary / "cache" / "ruff"),
        }
    )
    return environment


def run_steps(root: Path, steps: Sequence[Step], environment: Mapping[str, str]) -> int:
    """Execute one phase at a time, with no retry, shell evaluation, or skipped failure."""
    for index, step in enumerate(steps, 1):
        LOG.info("[%d/%d] %s", index, len(steps), step.name)
        started = monotonic()
        try:
            result = subprocess.run(step.arguments, cwd=root, env=environment, check=False)
        except OSError:
            LOG.error("Cannot start %s. Check the installed toolchain and dependencies.", step.name)
            return 127
        except KeyboardInterrupt:
            LOG.error("Interrupted during %s; validation is incomplete.", step.name)
            return 130
        status = result.returncode if result.returncode >= 0 else 128 - result.returncode
        if status:
            LOG.error(
                "FAILED: %s (exit %d, %.1fs). Later phases were not run.",
                step.name,
                status,
                monotonic() - started,
            )
            return status
        LOG.info("PASS: %s (%.1fs)", step.name, monotonic() - started)
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base-ref", required=True, help="Exact PR base commit or a locally available ref"
    )
    parser.add_argument(
        "--quick", action="store_true", help="Static/contract subset; not full PR evidence"
    )
    parser.add_argument(
        "--list", action="store_true", help="Show the plan without running quality gates"
    )
    args = parser.parse_args(argv)
    try:
        base_sha = resolve_commit(ROOT, args.base_ref)
        head_sha = resolve_commit(ROOT, "HEAD")
        steps = build_steps(ROOT, base_sha, quick=args.quick)
        LOG.info(
            "Local %s validation; HEAD %s; base %s",
            "quick" if args.quick else "full",
            head_sha,
            base_sha,
        )
        if args.list:
            for step in steps:
                LOG.info("%s: %s", step.name, shlex.join(step.arguments))
            LOG.info("Plan only: no checks have passed.")
            return 0
        check_checkout(ROOT)
        check_python_architecture()
        before = source_fingerprint(ROOT)
        if before[0] != head_sha:
            raise ValueError("HEAD changed during setup; rerun the gate")
        LOG.info("Checking the current working tree, including staged and unstaged tracked edits.")
        with tempfile.TemporaryDirectory(prefix="gnosi-pre-pr-") as temporary:
            status = run_steps(ROOT, steps, isolated_environment(os.environ, Path(temporary)))
        if status:
            return status
        check_checkout(ROOT)
        if source_fingerprint(ROOT) != before:
            raise ValueError("Source or HEAD changed during validation; rerun the gate")
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        LOG.error(
            "Pre-PR setup failed (%s); no successful validation is recorded.", type(error).__name__
        )
        if isinstance(error, ValueError):
            LOG.error("%s", error)
        return 2
    LOG.info(
        "Local %s checks passed. GitHub still must pass all five checks: %s.",
        "QUICK SUBSET" if args.quick else "full",
        ", ".join(REMOTE_GATES),
    )
    if not args.quick:
        LOG.info("Review and stage regenerated documentation, then rerun the documentation gate.")
    LOG.info("No live app, native smoke, Docker build, release, push, or merge was performed.")
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stdout)
    raise SystemExit(main())
