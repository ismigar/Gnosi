#!/usr/bin/env python3
"""Provision a fresh, job-scoped uv project environment for self-hosted CI."""

from __future__ import annotations

import argparse
import hashlib
import logging
import os
import platform
from pathlib import Path
import re
import shutil
import sys
from typing import Mapping


LOG = logging.getLogger(__name__)
ENVIRONMENT_PREFIX = "gnosi-venv-"
CACHE_PREFIX = "gnosi-uv-cache-"
SAFE_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")


def _required(environment: Mapping[str, str], name: str) -> str:
    value = environment.get(name, "")
    if not value:
        raise ValueError(f"Missing required CI variable: {name}")
    return value


def _safe_identifier(value: str, name: str) -> str:
    if value in {".", ".."} or not SAFE_IDENTIFIER.fullmatch(value):
        raise ValueError(f"Unsafe {name}: expected a simple CI identifier")
    return value


def environment_path(environment: Mapping[str, str]) -> Path:
    """Return a validated, direct child of RUNNER_TEMP for this exact job."""
    runner_temp_raw = _required(environment, "RUNNER_TEMP")
    runner_temp = Path(runner_temp_raw).expanduser().resolve(strict=True)
    if not runner_temp.is_dir():
        raise ValueError("RUNNER_TEMP must be an existing directory")

    run_id = _safe_identifier(_required(environment, "GITHUB_RUN_ID"), "GITHUB_RUN_ID")
    run_attempt = _safe_identifier(
        _required(environment, "GITHUB_RUN_ATTEMPT"), "GITHUB_RUN_ATTEMPT"
    )
    job = _safe_identifier(_required(environment, "GITHUB_JOB"), "GITHUB_JOB")
    candidate = runner_temp / f"{ENVIRONMENT_PREFIX}{run_id}-{run_attempt}-{job}"

    # Do not resolve candidate: an existing symlink must be unlinked, never followed.
    if candidate.parent != runner_temp or not candidate.name.startswith(ENVIRONMENT_PREFIX):
        raise ValueError("Refusing Python environment outside RUNNER_TEMP")
    return candidate


def cache_path(environment: Mapping[str, str]) -> Path:
    """Return the validated job-scoped uv cache path."""
    environment_candidate = environment_path(environment)
    suffix = environment_candidate.name.removeprefix(ENVIRONMENT_PREFIX)
    return environment_candidate.parent / f"{CACHE_PREFIX}{suffix}"


def persistent_cache_path(environment: Mapping[str, str]) -> Path | None:
    """Select uv's native append-only package cache, never a shared environment."""
    if environment.get("GNOSI_CI_PACKAGE_CACHE") != "1":
        return None
    raw = environment.get("RUNNER_TOOL_CACHE")
    if not raw:
        LOG.warning("Runner tool cache unavailable; using job-private downloads")
        return None
    root = Path(raw).expanduser().resolve(strict=True)
    if not root.is_dir():
        raise ValueError("RUNNER_TOOL_CACHE must be an existing directory")
    identity = "|".join((
        environment.get("GITHUB_REPOSITORY", "Gnosi"), platform.system(),
        platform.machine(), f"{sys.version_info.major}.{sys.version_info.minor}",
    ))
    cache = root / "gnosi-uv-packages-v1" / hashlib.sha256(identity.encode()).hexdigest()
    # Reject aliases before creating directories or handing the path to uv.
    for candidate in (cache.parent, cache):
        if candidate.is_symlink():
            raise ValueError("Persistent package cache must not be a symlink")
    cache.mkdir(parents=True, exist_ok=True)
    return cache


def _remove_scoped_path(path: Path) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.exists():
        shutil.rmtree(path)


def prepare(environment: Mapping[str, str]) -> Path:
    """Remove only the validated job environment and export its fresh location."""
    candidate = environment_path(environment)
    persistent = persistent_cache_path(environment)
    cache = persistent or cache_path(environment)
    github_env = Path(_required(environment, "GITHUB_ENV")).expanduser().resolve(strict=True)
    if not github_env.is_file():
        raise ValueError("GITHUB_ENV must be an existing regular file")

    _remove_scoped_path(candidate)
    if persistent is None:
        _remove_scoped_path(cache)

    if persistent is None and environment.get("GNOSI_CI_SEALED_CACHE") == "1":
        sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
        from scripts.ci.python_cache import restore_for_job
        restore_for_job(environment, cache)

    with github_env.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(f"UV_PROJECT_ENVIRONMENT={candidate}\n")
        handle.write(f"UV_CACHE_DIR={cache}\n")
        handle.write("UV_LINK_MODE=copy\n")
    LOG.info("Prepared isolated uv environment at %s", candidate)
    LOG.info("Python package cache: %s (%s)", cache, "persistent" if persistent else "job-private")
    return candidate


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    prepare(os.environ)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
