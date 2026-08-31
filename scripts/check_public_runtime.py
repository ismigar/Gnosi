"""Reject retired host operations and local state in the public runtime index."""

from __future__ import annotations

import argparse
import logging
import subprocess
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

LOG = logging.getLogger(__name__)
ROOT = Path(__file__).resolve().parents[1]
RUNTIME = "scripts/runtime"
# Historical machine operations belong in private workspace tooling, not in a
# portable application checkout. Keep explicit names so additions get reviewed.
RETIRED_NAMES = frozenset(
    {
        "native_watchdog.sh",
        "install_native_watchdog.sh",
        "docker_watchdog.sh",
        "install_docker_watchdog.sh",
        "install_native_startup.sh",
        "install_startup.sh",
        "install_cron.sh",
        "run_pipeline_scheduled.sh",
        "gnosi_boot.sh",
        "fix_docker_grpcfuse.sh",
        "onedrive_warmup_daemon.py",
        "start_warmup_daemon.sh",
        "install_warmup_daemon.sh",
        "install_warmup_loginitem.sh",
        "cleanup_onedrive_warmup.sh",
        "run_brain.sh",
        "run_prod.sh",
    }
)
LOCAL_DIRECTORIES = frozenset(
    {
        "__pycache__",
        ".tmp",
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
class IndexedRuntimeFile:
    mode: str
    path: str


def indexed_files(root: Path) -> list[IndexedRuntimeFile]:
    """Read staged names/modes; never follow links or open environment files."""
    result = subprocess.run(
        ["git", "-C", str(root), "ls-files", "--stage", "-z", "--", RUNTIME],
        check=True,
        capture_output=True,
    )
    entries = []
    for item in result.stdout.split(b"\0"):
        if not item:
            continue
        metadata, name = item.split(b"\t", 1)
        mode, _oid, stage = metadata.decode("ascii").split(" ")
        if stage != "0":
            raise ValueError("Resolve the runtime index conflict before checking publication")
        entries.append(IndexedRuntimeFile(mode, name.decode("utf-8")))
    return entries


def violations(entries: Iterable[IndexedRuntimeFile]) -> list[str]:
    """Validate the published index independently of unstaged file removals."""
    issues = []
    for entry in entries:
        path = PurePosixPath(entry.path)
        if entry.path != RUNTIME and not entry.path.startswith(f"{RUNTIME}/"):
            raise ValueError("Unexpected path outside the public runtime")
        if ".." in path.parts:
            raise ValueError("Unconfined runtime path")
        if entry.mode not in {"100644", "100755"} or entry.path == RUNTIME:
            issues.append(f"{entry.path}: source links and unsupported file modes are forbidden")
        if path.name in RETIRED_NAMES:
            issues.append(f"{entry.path}: retired operation belongs in historical archives")
        if any(part in LOCAL_DIRECTORIES or part.endswith(".egg-info") for part in path.parts):
            issues.append(f"{entry.path}: generated or local runtime state")
        if path.name.startswith(".env") and not path.name.endswith((".example", ".template")):
            issues.append(f"{entry.path}: environment values must not be published")
        if path.suffix.lower() in {".pyc", ".pyo", ".db", ".sqlite", ".sqlite3", ".log"}:
            issues.append(f"{entry.path}: generated or local data file")
    return sorted(set(issues))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", type=Path, default=ROOT)
    args = parser.parse_args()
    try:
        entries = indexed_files(args.repository)
        if not entries:
            raise ValueError("Public runtime source set is empty")
        issues = violations(entries)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        LOG.error("Public runtime check failed: %s", error)
        return 1
    for issue in issues:
        LOG.error("%s", issue)
    if issues:
        LOG.error("The check reads Git's index; stage reviewed removals before rechecking")
        return 1
    LOG.info("Public runtime boundary passed for %s indexed files", len(entries))
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    raise SystemExit(main())
