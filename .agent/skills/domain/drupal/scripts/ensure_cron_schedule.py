#!/usr/bin/env python3
"""Install the marked Temenos Drupal cron entry without touching other jobs."""

from __future__ import annotations

import argparse
from pathlib import Path
import shlex
import subprocess
from typing import Sequence


MARKER = "# temenos-drupal-cron"
SCHEDULE = "* * * * *"


def build_entry(site_root: Path, php_bin: Path) -> str:
    """Build the single cron line owned by this helper."""
    drush = site_root / "vendor" / "drush" / "drush" / "drush.php"
    return (
        f"{SCHEDULE} cd {shlex.quote(str(site_root))} && "
        f"{shlex.quote(str(php_bin))} {shlex.quote(str(drush))} cron --quiet "
        f">/dev/null 2>&1 {MARKER}"
    )


def merge_crontab(existing: str, entry: str) -> str:
    """Replace only the marked entry and preserve unrelated crontab lines."""
    lines = [line for line in existing.splitlines() if MARKER not in line]
    lines.append(entry)
    return "\n".join(lines).rstrip() + "\n"


def read_crontab() -> str:
    """Read the current user's crontab, treating an absent crontab as empty."""
    result = subprocess.run(
        ["crontab", "-l"],
        capture_output=True,
        text=True,
    )
    if result.returncode not in (0, 1):
        raise RuntimeError(result.stderr.strip() or "Could not read crontab")
    return result.stdout


def install_crontab(contents: str) -> None:
    """Install complete crontab contents through standard input."""
    subprocess.run(
        ["crontab", "-"],
        input=contents,
        text=True,
        check=True,
    )


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site-root", type=Path, required=True)
    parser.add_argument("--php-bin", type=Path, default=Path("/usr/bin/php8.4"))
    parser.add_argument("--check", action="store_true")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    site_root = args.site_root.resolve()
    php_bin = args.php_bin.resolve()
    drush = site_root / "vendor" / "drush" / "drush" / "drush.php"
    if not site_root.is_dir() or not drush.is_file() or not php_bin.is_file():
        raise RuntimeError("Site root, PHP binary, or Drush entrypoint is missing")

    existing = read_crontab()
    entry = build_entry(site_root, php_bin)
    merged = merge_crontab(existing, entry)
    if args.check:
        if existing != merged:
            raise RuntimeError("The marked Drupal cron entry is missing or stale")
        print("Drupal cron entry is current")
        return 0

    install_crontab(merged)
    if read_crontab() != merged:
        raise RuntimeError("Installed crontab does not match the requested contents")
    print("Drupal cron entry installed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
