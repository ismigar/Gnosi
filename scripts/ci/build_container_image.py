#!/usr/bin/env python3
"""Build a fresh CI image and recover only verified post-load client failures."""

from __future__ import annotations

import argparse
import logging
from pathlib import Path
import subprocess
from typing import Sequence


LOG = logging.getLogger(__name__)


def _run(command: Sequence[str], *, check: bool) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(tuple(command), check=check)


def build_image(*, dockerfile: Path, tag: str, context: Path) -> None:
    """Build one fresh image, accepting only a verified post-load failure."""
    if not dockerfile.is_file():
        raise ValueError(f"Dockerfile is not a regular file: {dockerfile}")
    if not context.is_dir():
        raise ValueError(f"Build context is not a directory: {context}")
    if not tag or any(character.isspace() for character in tag):
        raise ValueError("Image tag must be non-empty and contain no whitespace")

    _run(("docker", "image", "rm", "--force", tag), check=False)
    result = _run(
        (
            "docker",
            "build",
            "--file",
            str(dockerfile),
            "--tag",
            tag,
            str(context),
        ),
        check=False,
    )
    if result.returncode == 0:
        return

    inspection = _run(("docker", "image", "inspect", tag), check=False)
    if inspection.returncode != 0:
        raise subprocess.CalledProcessError(result.returncode, result.args)
    LOG.warning(
        "Container client exited %d after registering fresh image %s; "
        "continuing to the Compose smoke gate",
        result.returncode,
        tag,
    )


def parse_args(arguments: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dockerfile", type=Path, required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--context", type=Path, default=Path("."))
    return parser.parse_args(arguments)


def main(arguments: Sequence[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    args = parse_args(arguments)
    build_image(
        dockerfile=args.dockerfile.resolve(),
        tag=args.tag,
        context=args.context.resolve(),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
