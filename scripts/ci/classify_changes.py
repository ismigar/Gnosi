"""Only trusted PRs changing portal prose may omit runtime checks."""
from __future__ import annotations

import os
from pathlib import PurePosixPath, Path
import re
import subprocess
from typing import Mapping

SHA = re.compile(r"^[0-9a-f]{40}$")
PORTALS = {"engineering", "engineering-ca", "engineering-es", "engineering-fr"}


def documentation_path(value: str) -> bool:
    path = PurePosixPath(value)
    parts = path.parts
    return (
        not path.is_absolute() and ".." not in parts
        and len(parts) >= 3 and parts[0] == "docs" and parts[1] in PORTALS
        and path.suffix == ".md"
    )


def runtime_required(environment: Mapping[str, str]) -> bool:
    if (environment.get("CI_EVENT") != "pull_request"
            or environment.get("CI_HEAD_REPOSITORY") != environment.get("GITHUB_REPOSITORY")
            or not environment.get("GITHUB_REPOSITORY")
            or environment.get("CI_RELEASE_CANDIDATE") == "true"):
        return True
    base, head = environment.get("CI_BASE_SHA", ""), environment.get("CI_HEAD_SHA", "")
    if not SHA.fullmatch(base) or not SHA.fullmatch(head):
        return True
    try:
        # --no-renames includes both names: moving code into docs still runs CI.
        changed = subprocess.check_output(
            ["git", "diff", "--name-only", "--no-renames", "-z", f"{base}...{head}", "--"],
            timeout=30,
        ).decode("utf-8").split("\0")
    except (OSError, UnicodeError, subprocess.SubprocessError):
        return True
    paths = [path for path in changed if path]
    return not paths or not all(documentation_path(path) for path in paths)


def main() -> None:
    required = runtime_required(os.environ)
    with Path(os.environ["GITHUB_OUTPUT"]).open("a") as stream:
        stream.write(f"runtime_required={str(required).lower()}\n")
    message = ("Full runtime validation required." if required else
               "Only engineering portal Markdown changed. Runtime checks are not needed; "
               "the documentation check still validates all four portals.")
    print(message)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with Path(summary).open("a") as stream:
            stream.write(message + "\n")


if __name__ == "__main__":
    main()
