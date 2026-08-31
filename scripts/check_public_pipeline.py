"""Reject private operations and generated state in the public pipeline index."""

from __future__ import annotations

import argparse
import logging
import subprocess
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

LOG = logging.getLogger(__name__)
ROOT = Path(__file__).resolve().parents[1]
PRIVATE_PREFIXES = (
    "pipeline/private_skills/",
    "pipeline/backup_agents/",
    "pipeline/skills/backup_projectes/",
    "pipeline/brain/",
    "pipeline/skills/autonomous_loop/",
    "pipeline/skills/auto_improver/",
    "pipeline/skills/proves_dataset/",
    "pipeline/skills/publisher/",
    "pipeline/skills/release_preflight/",
    "pipeline/skills/vault_ai_assistant/",
)
PRIVATE_FILES = frozenset({"pipeline/scripts/migrate_progres_to_virtual.py"})
GENERATED_DIRECTORIES = frozenset(
    {
        "sandbox",
        ".tmp",
        "__pycache__",
        ".pytest_cache",
        ".ruff_cache",
        ".vite",
        "node_modules",
        ".venv",
        "local_data",
        "secrets",
    }
)


@dataclass(frozen=True)
class IndexedFile:
    mode: str
    path: str


def indexed_files(root: Path) -> list[IndexedFile]:
    """Read index metadata only, including force-added ignored files."""
    result = subprocess.run(
        ["git", "-C", str(root), "ls-files", "--stage", "-z", "--", "pipeline"],
        check=True,
        capture_output=True,
    )
    entries = []
    for item in result.stdout.split(b"\0"):
        if not item:
            continue
        metadata, name = item.split(b"\t", 1)
        mode, _oid, stage = metadata.decode().split(" ")
        if stage != "0":
            raise ValueError("Resolve the pipeline index conflict before checking publication")
        entries.append(IndexedFile(mode, name.decode("utf-8")))
    return entries


def violations(entries: Iterable[IndexedFile]) -> list[str]:
    """Classify names and modes without opening source, secrets or symlinks."""
    issues = []
    for entry in entries:
        path = PurePosixPath(entry.path)
        if not entry.path.startswith("pipeline/"):
            raise ValueError("Unexpected path outside pipeline")
        if entry.mode not in {"100644", "100755"}:
            issues.append(f"{entry.path}: external source link or unsupported file mode")
        if entry.path.startswith(PRIVATE_PREFIXES) or entry.path in PRIVATE_FILES:
            issues.append(f"{entry.path}: private operation belongs outside public Gnosi")
        if any(part in GENERATED_DIRECTORIES or part.endswith(".egg-info") for part in path.parts):
            issues.append(f"{entry.path}: generated or local runtime state")
        if path.name.startswith(".env") and not path.name.endswith((".example", ".template")):
            issues.append(f"{entry.path}: environment values must not be published")
        if path.suffix.lower() in {".pyc", ".pyo", ".sqlite", ".sqlite3", ".db", ".log"}:
            issues.append(f"{entry.path}: generated or local data file")
    return sorted(issues)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", type=Path, default=ROOT)
    args = parser.parse_args()
    try:
        entries = indexed_files(args.repository)
        issues = violations(entries)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        LOG.error("Public pipeline check failed: %s", error)
        return 1
    for issue in issues:
        LOG.error("%s", issue)
    if issues:
        LOG.error("The check reads Git's index; stage reviewed removals before rechecking")
        return 1
    LOG.info("Public pipeline boundary passed for %s indexed files", len(entries))
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    raise SystemExit(main())
