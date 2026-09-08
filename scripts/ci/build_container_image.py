#!/usr/bin/env python3
"""Build a fresh CI image and recover only verified post-load client failures."""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
import re
import subprocess
from typing import Sequence, cast
from uuid import uuid4


LOG = logging.getLogger(__name__)
REVISION_LABEL = "org.opencontainers.image.revision"
BUILD_LABEL = "io.gnosi.ci.build-id"


def _run(
    command: Sequence[str], *, check: bool, capture_output: bool = False,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        tuple(command), check=check, capture_output=capture_output, text=True,
        timeout=60 if capture_output else None,
    )


def _source_revision(context: Path) -> str:
    result = _run(
        ("git", "-C", str(context), "rev-parse", "HEAD"),
        check=True, capture_output=True,
    )
    revision = result.stdout.strip()
    if not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", revision):
        raise RuntimeError("Build context does not have a valid Git revision")
    return revision


def _mapping(value: object) -> dict[str, object]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise RuntimeError("Container inspection returned invalid image metadata")
    return cast(dict[str, object], value)


def _verify_image(tag: str, revision: str, build_id: str) -> None:
    inspection = _run(
        ("docker", "image", "inspect", tag), check=True, capture_output=True,
    )
    payload: object = json.loads(inspection.stdout)
    if not isinstance(payload, list) or len(payload) != 1:
        raise RuntimeError("Container inspection must return exactly one image")
    labels = _mapping(_mapping(_mapping(payload[0]).get("Config")).get("Labels"))
    if labels.get(REVISION_LABEL) != revision or labels.get(BUILD_LABEL) != build_id:
        raise RuntimeError("Image metadata does not match this build and revision")


def build_image(*, dockerfile: Path, tag: str, context: Path) -> None:
    """Build one fresh image, accepting only a verified post-load failure."""
    if not dockerfile.is_file():
        raise ValueError(f"Dockerfile is not a regular file: {dockerfile}")
    if not context.is_dir():
        raise ValueError(f"Build context is not a directory: {context}")
    if not tag or tag.startswith("-") or any(character.isspace() for character in tag):
        raise ValueError("Image tag must be non-empty and contain no whitespace")

    revision = _source_revision(context)
    build_id = uuid4().hex
    existing = _run(
        ("docker", "image", "ls", "--quiet", tag), check=True, capture_output=True,
    )
    if existing.stdout.strip():
        # An in-use image or failed removal must stop the build, never be ignored.
        _run(("docker", "image", "rm", tag), check=True)
    result = _run(
        (
            "docker",
            "build",
            "--file",
            str(dockerfile),
            "--tag",
            tag,
            "--label",
            f"{REVISION_LABEL}={revision}",
            "--label",
            f"{BUILD_LABEL}={build_id}",
            str(context),
        ),
        check=False,
    )
    try:
        _verify_image(tag, revision, build_id)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, ValueError, RuntimeError) as error:
        if result.returncode != 0:
            raise subprocess.CalledProcessError(result.returncode, result.args) from error
        raise
    if result.returncode != 0:
        LOG.warning(
            "Container client exited %d, but image %s matches revision %s and this "
            "unique build; continuing to the Compose smoke gate",
            result.returncode, tag, revision,
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
