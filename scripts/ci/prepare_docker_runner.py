#!/usr/bin/env python3
"""Ensure a dedicated self-hosted Docker runner has enough free disk."""

from __future__ import annotations

import logging
import os
from pathlib import Path
import shutil
import subprocess
from typing import Mapping


LOG = logging.getLogger(__name__)
MINIMUM_FREE_BYTES = 12 * 1024**3


def _free_bytes(path: Path) -> int:
    return shutil.disk_usage(path).free


def _prune_unused_docker() -> None:
    subprocess.run(
        ("docker", "system", "prune", "--all", "--force", "--volumes"),
        check=True,
    )


def runner_temp(environment: Mapping[str, str]) -> Path:
    raw = environment.get("RUNNER_TEMP", "")
    if not raw:
        raise ValueError("RUNNER_TEMP is required on the dedicated Docker runner")
    path = Path(raw).expanduser().resolve(strict=True)
    if not path.is_dir():
        raise ValueError("RUNNER_TEMP must be an existing directory")
    return path


def prepare(
    environment: Mapping[str, str],
    *,
    minimum_free_bytes: int = MINIMUM_FREE_BYTES,
) -> int:
    """Prune only unused Docker resources when capacity is below the gate."""
    path = runner_temp(environment)
    available = _free_bytes(path)
    if available >= minimum_free_bytes:
        LOG.info("Docker runner has %.1f GiB free", available / 1024**3)
        return available

    LOG.warning(
        "Docker runner has only %.1f GiB free; pruning unused Docker resources",
        available / 1024**3,
    )
    _prune_unused_docker()
    available = _free_bytes(path)
    if available < minimum_free_bytes:
        raise RuntimeError(
            "Dedicated Docker runner still has less than 12 GiB free after pruning"
        )
    LOG.info("Docker runner recovered %.1f GiB free", available / 1024**3)
    return available


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    prepare(os.environ)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
