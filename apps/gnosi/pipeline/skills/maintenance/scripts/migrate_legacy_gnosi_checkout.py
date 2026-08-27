"""Migrate runtime state from the legacy Gnosi checkout to the canonical one."""

from __future__ import annotations

import argparse
from datetime import datetime
import json
import logging
from pathlib import Path
import shutil
import socket


LOG = logging.getLogger(__name__)


def _resolve_projectes_root() -> Path:
    """Find the tracked repository root from stable markers."""
    for candidate in Path(__file__).resolve().parents:
        if (
            (candidate / "package.json").is_file()
            and (candidate / "apps" / "gnosi").is_dir()
        ):
            return candidate
    raise RuntimeError("Could not resolve the Projectes repository root")


PROJECTES_ROOT = _resolve_projectes_root()
CANONICAL_ROOT = PROJECTES_ROOT / "apps" / "gnosi"
LEGACY_MONOREPO = PROJECTES_ROOT / "monorepo"
LEGACY_ROOT = LEGACY_MONOREPO / "apps" / "gnosi"
MIGRATION_RECORD = PROJECTES_ROOT / ".tmp" / "legacy-gnosi-migration.json"


def _port_is_open(port: int) -> bool:
    """Return whether a loopback TCP port accepts connections."""
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.25):
            return True
    except OSError:
        return False


def _copy_if_missing(source: Path, destination: Path) -> None:
    """Copy a runtime file without overwriting an existing destination."""
    if destination.exists():
        LOG.info("Preserving existing destination: %s", destination)
        return
    if not source.is_file():
        LOG.info("Source is absent; nothing to copy: %s", source)
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    LOG.info("Copied runtime file to canonical location: %s", destination)


def prepare_environment() -> None:
    """Prepare canonical environment files while the legacy backend is live."""
    if LEGACY_ROOT.is_symlink() and LEGACY_ROOT.resolve() == CANONICAL_ROOT:
        LOG.info("Legacy path already points to the canonical checkout")
        return
    if not CANONICAL_ROOT.is_dir() or not LEGACY_ROOT.is_dir():
        raise RuntimeError("Both canonical and legacy Gnosi roots must exist")
    _copy_if_missing(LEGACY_ROOT / ".env", CANONICAL_ROOT / ".env")
    _copy_if_missing(LEGACY_ROOT / ".env_shared", PROJECTES_ROOT / ".env_shared")
    _copy_if_missing(LEGACY_ROOT / "vault.db", CANONICAL_ROOT / "vault.db")


def migrate_runtime_and_archive() -> Path:
    """Move local runtime state and archive the legacy checkout recoverably."""
    if LEGACY_ROOT.is_symlink() and LEGACY_ROOT.resolve() == CANONICAL_ROOT:
        if not MIGRATION_RECORD.is_file():
            raise RuntimeError("Compatibility link exists without a migration record")
        record = json.loads(MIGRATION_RECORD.read_text(encoding="utf-8"))
        archive_path = Path(record["recoverable_archive"])
        LOG.info("Legacy checkout migration is already complete")
        return archive_path
    if _port_is_open(5002):
        raise RuntimeError(
            "Port 5002 is still active; stop the legacy backend before migration"
        )
    if not CANONICAL_ROOT.is_dir() or not LEGACY_ROOT.is_dir():
        raise RuntimeError("Both canonical and legacy Gnosi roots must exist")

    source_data = LEGACY_ROOT / "local_data"
    destination_data = CANONICAL_ROOT / "local_data"
    quarantine_path = None
    if destination_data.exists():
        quarantine_path = PROJECTES_ROOT / ".tmp" / (
            "canonical-local-data-before-migration-"
            + datetime.now().strftime("%Y%m%dT%H%M%S")
        )
        quarantine_path.parent.mkdir(parents=True, exist_ok=True)
        destination_data.rename(quarantine_path)
        LOG.info("Quarantined pre-existing canonical state: %s", quarantine_path)
    if not source_data.is_dir():
        raise RuntimeError(f"Legacy local_data is missing: {source_data}")
    source_data.rename(destination_data)
    LOG.info("Moved local runtime state to: %s", destination_data)

    archive_root = Path.home() / ".Trash"
    archive_path = archive_root / (
        "Projectes-monorepo-legacy-" + datetime.now().strftime("%Y%m%dT%H%M%S")
    )
    if archive_path.exists():
        raise RuntimeError(f"Archive destination already exists: {archive_path}")
    LEGACY_MONOREPO.rename(archive_path)
    LOG.info("Moved legacy monorepo to macOS Trash: %s", archive_path)

    compatibility_apps = LEGACY_MONOREPO / "apps"
    compatibility_apps.mkdir(parents=True, exist_ok=True)
    compatibility_link = compatibility_apps / "gnosi"
    compatibility_link.symlink_to(CANONICAL_ROOT, target_is_directory=True)
    LOG.info("Created legacy-path compatibility link: %s", compatibility_link)

    MIGRATION_RECORD.parent.mkdir(parents=True, exist_ok=True)
    MIGRATION_RECORD.write_text(
        json.dumps(
            {
                "canonical_root": str(CANONICAL_ROOT),
                "compatibility_link": str(compatibility_link),
                "quarantined_canonical_data": (
                    str(quarantine_path) if quarantine_path else None
                ),
                "recoverable_archive": str(archive_path),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return archive_path


def main() -> int:
    """Run a selected migration phase."""
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=("prepare", "migrate"))
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    if args.phase == "prepare":
        prepare_environment()
    else:
        archive_path = migrate_runtime_and_archive()
        LOG.info("Legacy checkout remains recoverable at: %s", archive_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
