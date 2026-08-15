#!/usr/bin/env python3
"""Run the complete engineering-documentation gate before publishing a PR."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_ROOT = SCRIPT_DIR.parent
APP_ROOT = SCRIPT_DIR.parents[3]


@dataclass(frozen=True)
class GateCommand:
    """Describe one deterministic documentation validation phase."""

    name: str
    arguments: tuple[str, ...]


def build_commands(*, base_ref: str | None, check_only: bool) -> list[GateCommand]:
    """Return the ordered commands that define the local documentation gate."""
    python = sys.executable
    commands = [
        GateCommand(
            "Test documentation tooling",
            (python, "-m", "pytest", str(SKILL_ROOT / "tests"), "-q"),
        ),
    ]
    if base_ref:
        commands.append(
            GateCommand(
                "Require documentation for functional changes",
                (
                    python,
                    str(SCRIPT_DIR / "check_change_impact.py"),
                    "--base-ref",
                    base_ref,
                ),
            )
        )
    if not check_only:
        commands.append(
            GateCommand(
                "Update generated reference",
                (python, str(SCRIPT_DIR / "generate.py")),
            )
        )
    commands.extend(
        [
            GateCommand(
                "Verify generated reference",
                (python, str(SCRIPT_DIR / "generate.py"), "--check"),
            ),
            GateCommand(
                "Validate traceability and links",
                (python, str(SCRIPT_DIR / "validate.py")),
            ),
            GateCommand(
                "Verify localized mirrors",
                (python, str(SCRIPT_DIR / "localize.py"), "--check"),
            ),
            GateCommand(
                "Build English portal",
                (python, "-m", "mkdocs", "build", "--strict"),
            ),
            GateCommand(
                "Build Catalan portal",
                (
                    python,
                    "-m",
                    "mkdocs",
                    "build",
                    "--strict",
                    "--config-file",
                    "mkdocs-ca.yml",
                ),
            ),
            GateCommand(
                "Build Spanish portal",
                (
                    python,
                    "-m",
                    "mkdocs",
                    "build",
                    "--strict",
                    "--config-file",
                    "mkdocs-es.yml",
                ),
            ),
        ]
    )
    return commands


def run_gate(commands: list[GateCommand]) -> None:
    """Execute the documentation gate and stop at the first failed phase."""
    environment = os.environ.copy()
    existing_pythonpath = environment.get("PYTHONPATH")
    environment["PYTHONPATH"] = os.pathsep.join(
        part for part in (str(APP_ROOT), existing_pythonpath) if part
    )

    for command in commands:
        print(f"\n==> {command.name}", flush=True)
        subprocess.run(
            command.arguments,
            cwd=APP_ROOT,
            env=environment,
            check=True,
        )


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse command-line arguments for update and CI-check modes."""
    parser = argparse.ArgumentParser(
        description="Update and validate Gnosi engineering documentation before a PR."
    )
    parser.add_argument(
        "--base-ref",
        help="Git base ref used by the functional-change documentation gate.",
    )
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="Reject stale generated pages without updating them.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """Run every required engineering-documentation validation phase."""
    args = parse_args(argv)
    run_gate(build_commands(base_ref=args.base_ref, check_only=args.check_only))
    print("\nEngineering documentation pre-PR gate passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
