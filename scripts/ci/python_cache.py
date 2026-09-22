"""Reuse sealed uv cache snapshots, never a shared mutable cache or a venv."""
from __future__ import annotations

import base64
import csv
import hashlib
import json
import logging
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import tempfile
import zlib
from typing import Mapping

LOG = logging.getLogger(__name__)
MAX_SNAPSHOT_BYTES = 1024**3
MAX_STORE_BYTES = 2 * 1024**3


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def snapshot_path(environment: Mapping[str, str], project: Path) -> Path:
    root = Path(environment["RUNNER_TOOL_CACHE"]).resolve(strict=True)
    store = root / "gnosi-sealed-uv-v1"
    if store.is_symlink():
        raise ValueError("Snapshot store must not be a symlink")
    store.mkdir(exist_ok=True)
    version = subprocess.check_output(["uv", "--version"], text=True, timeout=10).strip()
    scope = "docs-ci" if environment.get("GITHUB_JOB") == "documentation" else "runtime"
    identity = [platform.system(), platform.machine(), version, scope,
                digest(project / "uv.lock"), digest(project / "pyproject.toml")]
    key = hashlib.sha256(json.dumps(identity).encode()).hexdigest()
    return store / f"{key}.tar.gz"


def verify_packages(cache: Path) -> None:
    """Verify wheel RECORD hashes before sealing and after restoring packages."""
    archives = cache / "archive-v0"
    if not archives.is_dir():
        raise ValueError("No extracted wheels to verify")
    for archive in archives.iterdir():
        if not archive.is_dir() or archive.is_symlink():
            raise ValueError("Invalid wheel directory")
        records = list(archive.glob("*.dist-info/RECORD"))
        if not records:
            raise ValueError("Wheel RECORD missing")
        for record in records:
            with record.open(newline="", encoding="utf-8") as stream:
                for filename, checksum, _size in csv.reader(stream):
                    path = (archive / filename).resolve()
                    if not path.is_relative_to(archive.resolve()) or not path.is_file():
                        raise ValueError("Missing or unsafe wheel file")
                    if checksum:
                        algorithm, encoded = checksum.split("=", 1)
                        with path.open("rb") as content:
                            actual = hashlib.file_digest(content, algorithm).digest()
                        if base64.urlsafe_b64encode(actual).rstrip(b"=").decode() != encoded:
                            raise ValueError("Wheel checksum mismatch")


def restore(snapshot: Path, cache: Path) -> bool:
    """Extract a verified snapshot into an empty, job-private cache; fail cold."""
    created = False
    try:
        if snapshot.is_symlink() or snapshot.stat().st_size > MAX_SNAPSHOT_BYTES:
            raise ValueError("Invalid snapshot")
        checksum = snapshot.with_suffix(".sha256")
        if checksum.is_symlink() or digest(snapshot) != checksum.read_text().strip():
            raise ValueError("Snapshot checksum mismatch")
        if cache.exists():
            raise ValueError("Restore requires an empty destination")
        cache.mkdir()
        created = True
        with tarfile.open(snapshot, "r:gz") as archive:
            members = archive.getmembers()
            if sum(member.size for member in members) > 12 * 1024**3:
                raise ValueError("Snapshot expands beyond the cache budget")
            archive.extractall(cache, members=members, filter="data")
        verify_packages(cache)
        snapshot.touch()
        return True
    except (OSError, EOFError, zlib.error, ValueError, tarfile.TarError, csv.Error):
        if created and cache.is_dir() and not cache.is_symlink():
            shutil.rmtree(cache)
        LOG.info("No valid sealed package snapshot; using a fresh download cache")
        return False


def _safe_member(cache: Path, member: tarfile.TarInfo) -> tarfile.TarInfo:
    if member.issym():
        link = cache / member.name
        target = link.resolve(strict=True)
        if not target.is_relative_to(cache.resolve()):
            raise ValueError("External cache symlink")
        member.linkname = os.path.relpath(target, link.parent)
    if not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
        raise ValueError("Unsupported cache entry")
    return member


def save(snapshot: Path, cache: Path) -> None:
    verify_packages(cache)
    with tempfile.TemporaryDirectory(prefix="seal-", dir=snapshot.parent) as temporary:
        output = Path(temporary) / "snapshot.tar.gz"
        with tarfile.open(output, "w:gz", compresslevel=1) as archive:
            archive.add(cache, arcname=".", filter=lambda member: _safe_member(cache, member))
        if output.stat().st_size > MAX_SNAPSHOT_BYTES:
            raise ValueError("Snapshot exceeds the storage budget")
        checksum = Path(temporary) / "snapshot.sha256"
        checksum.write_text(digest(output) + "\n")
        # Only complete archives become visible. A concurrent reader either sees
        # the complete pair or rejects it and downloads afresh.
        output.replace(snapshot)
        checksum.replace(snapshot.with_suffix(".sha256"))
    prune(snapshot)


def prune(current: Path) -> None:
    snapshots = sorted(current.parent.glob("*.tar.gz"), key=lambda path: path.stat().st_mtime)
    total = sum(path.stat().st_size for path in snapshots)
    for path in snapshots:
        if total <= MAX_STORE_BYTES:
            break
        if path != current and not path.is_symlink():
            total -= path.stat().st_size
            path.unlink()
            path.with_suffix(".sha256").unlink(missing_ok=True)


def restore_for_job(environment: Mapping[str, str], cache: Path) -> None:
    if environment.get("GNOSI_CI_SEALED_CACHE") == "1":
        try:
            restored = restore(snapshot_path(environment, Path.cwd()), cache)
            LOG.info("Sealed package cache: %s", "hit" if restored else "miss")
        except (KeyError, OSError, ValueError, subprocess.SubprocessError):
            LOG.warning("Sealed cache unavailable; installation will use fresh downloads")


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    if os.environ.get("GNOSI_CI_SEALED_CACHE") != "1":
        return
    try:
        cache = Path(os.environ["UV_CACHE_DIR"])
        # Reuse the same path validation as provisioning before reading packages.
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
        from scripts.ci.prepare_python_environment import cache_path
        if cache != cache_path(os.environ):
            raise ValueError("Only the current job's package cache may be sealed")
        save(snapshot_path(os.environ, Path.cwd()), cache)
    except (KeyError, OSError, ValueError, tarfile.TarError, csv.Error, subprocess.SubprocessError):
        LOG.warning("Could not seal package cache; next job will download packages afresh")


if __name__ == "__main__":
    main()
