#!/usr/bin/env python3
"""Bound CI image/cache cleanup and preserve the dedicated runner's free disk."""

from __future__ import annotations

import argparse
import logging
import os
from pathlib import Path
import shutil
from subprocess import PIPE, CalledProcessError, TimeoutExpired, run
from time import sleep
from typing import Mapping


LOG = logging.getLogger(__name__)
MINIMUM_FREE_BYTES = 12 * 1024**3
CI_IMAGE_TAGS = ("gnosi-frontend:ci", "gnosi-backend:ci")
MAX_PRUNE_ATTEMPTS = 3
PRUNE_RETRY_DELAY_SECONDS = 5.0
MAX_IMAGE_REMOVAL_ATTEMPTS = 2
IMAGE_REMOVAL_RETRY_DELAY_SECONDS = 5.0


def _free_bytes(path: Path) -> int:
    return shutil.disk_usage(path).free


def _ci_image_exists(tag: str) -> bool:
    listed = run(
        ("docker", "image", "ls", "--quiet", tag),
        check=True, capture_output=True, text=True, timeout=30,
    )
    return bool(listed.stdout.strip())


def _remove_ci_image(tag: str) -> None:
    for attempt in range(1, MAX_IMAGE_REMOVAL_ATTEMPTS + 1):
        if not _ci_image_exists(tag):
            return
        try:
            # Never force removal of an image that is still used by a container.
            run(("docker", "image", "rm", tag), check=True, timeout=60)
        except TimeoutExpired:
            # The daemon may finish deleting after the client times out.
            if not _ci_image_exists(tag):
                LOG.warning("Image removal timed out, but %s is verified absent", tag)
                return
            if attempt == MAX_IMAGE_REMOVAL_ATTEMPTS:
                raise
            LOG.warning("Image removal timed out for %s; retrying once", tag)
            sleep(IMAGE_REMOVAL_RETRY_DELAY_SECONDS)
        else:
            return


def _remove_ci_images() -> None:
    for tag in CI_IMAGE_TAGS:
        _remove_ci_image(tag)


def _prune_build_cache() -> None:
    command = ("docker", "builder", "prune", "--all", "--force")
    for attempt in range(1, MAX_PRUNE_ATTEMPTS + 1):
        try:
            result = run(command, check=True, text=True, stderr=PIPE, timeout=120)
        except CalledProcessError as error:
            message = str(error.stderr or "")
            if "context deadline exceeded" not in message.lower() or attempt == MAX_PRUNE_ATTEMPTS:
                LOG.error("Build cache cleanup failed: %s", message or error)
                raise
            LOG.warning(
                "Build cache cleanup exceeded its deadline (%d/%d); retrying in %.0fs",
                attempt, MAX_PRUNE_ATTEMPTS, PRUNE_RETRY_DELAY_SECONDS,
            )
            sleep(PRUNE_RETRY_DELAY_SECONDS)
        else:
            if result.stderr:
                LOG.warning("%s", result.stderr.strip())
            return


def _prune_unused_docker() -> None:
    """Remove only the two CI image tags and regenerable unused build cache."""
    _remove_ci_images()
    _prune_build_cache()


def runner_temp(environment: Mapping[str, str]) -> Path:
    raw = environment.get("RUNNER_TEMP", "")
    if not raw:
        raise ValueError("RUNNER_TEMP is required on the dedicated Docker runner")
    path = Path(raw).expanduser().resolve(strict=True)
    if not path.is_dir():
        raise ValueError("RUNNER_TEMP must be an existing directory")
    return path


def _require_capacity(path: Path, minimum_free_bytes: int) -> int:
    available = _free_bytes(path)
    if available < minimum_free_bytes:
        raise RuntimeError(
            "Dedicated Docker runner still has less than 12 GiB free after pruning"
        )
    LOG.info("Docker runner has %.1f GiB free after cleanup", available / 1024**3)
    return available


def cleanup(
    environment: Mapping[str, str], *, minimum_free_bytes: int = MINIMUM_FREE_BYTES,
) -> int:
    """Always clean CI images/cache, then verify capacity; never prune volumes."""
    path = runner_temp(environment)
    _prune_unused_docker()
    return _require_capacity(path, minimum_free_bytes)


def prepare(
    environment: Mapping[str, str],
    *,
    minimum_free_bytes: int = MINIMUM_FREE_BYTES,
) -> int:
    """Clean only CI images/cache when capacity is below the gate."""
    path = runner_temp(environment)
    available = _free_bytes(path)
    if available >= minimum_free_bytes:
        LOG.info("Docker runner has %.1f GiB free", available / 1024**3)
        return available

    LOG.warning(
        "Docker runner has only %.1f GiB free; cleaning CI images and unused build cache",
        available / 1024**3,
    )
    _prune_unused_docker()
    return _require_capacity(path, minimum_free_bytes)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cleanup", action="store_true", help="Clean CI resources after a job")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    if args.cleanup:
        cleanup(os.environ)
    else:
        prepare(os.environ)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
