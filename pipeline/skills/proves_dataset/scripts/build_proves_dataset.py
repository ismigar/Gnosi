#!/usr/bin/env python3
"""Build a deterministic representative test vault without modifying its source."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


FULL_DIRECTORIES = (
    "BD",
    "Wiki",
    "Calendar",
    ".Dashboards",
    "Daily Notes",
    "Drawings",
    "Templates",
    "Newsletters",
    "Imported",
    "Clips",
    "data",
)
SAMPLE_POLICIES = {
    "Assets": (40, 5 * 1024 * 1024),
    "Images": (30, 2 * 1024 * 1024),
    "Library": (20, 10 * 1024 * 1024),
    "Biblioteca": (12, 5 * 1024 * 1024),
}
IGNORED_NAMES = {".DS_Store", "Thumbs.db", "desktop.ini"}


def iter_files(root: Path) -> Iterable[Path]:
    """Yield regular files in a stable order without following symlinks."""
    if not root.exists():
        return
    for path in sorted(root.rglob("*"), key=lambda item: item.as_posix().casefold()):
        if path.is_symlink() or not path.is_file() or path.name in IGNORED_NAMES:
            continue
        yield path


def copy_file(source: Path, destination: Path, report: dict) -> bool:
    """Copy one file and record recoverable OneDrive read errors."""
    try:
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        report["files_copied"] += 1
        report["bytes_copied"] += destination.stat().st_size
        return True
    except OSError as exc:
        report["errors"].append(
            {"path": str(source), "error": f"{type(exc).__name__}: {exc}"}
        )
        return False


def copy_complete_directory(source_root: Path, target_root: Path, name: str, report: dict) -> None:
    """Copy every readable regular file from a lightweight directory."""
    source_dir = source_root / name
    for source in iter_files(source_dir):
        copy_file(source, target_root / source.relative_to(source_root), report)


def diverse_sample(root: Path, limit: int, max_bytes: int, report: dict) -> list[Path]:
    """Select files round-robin by extension for deterministic format diversity."""
    groups: dict[str, deque[Path]] = defaultdict(deque)
    for path in iter_files(root):
        try:
            size = path.stat().st_size
        except OSError as exc:
            report["errors"].append(
                {"path": str(path), "error": f"{type(exc).__name__}: {exc}"}
            )
            continue
        if size <= 0 or size > max_bytes:
            report["files_skipped_by_size"] += 1
            continue
        groups[path.suffix.lower() or "(none)"].append(path)

    selected: list[Path] = []
    extensions = deque(sorted(groups))
    while extensions and len(selected) < limit:
        extension = extensions.popleft()
        bucket = groups[extension]
        selected.append(bucket.popleft())
        if bucket:
            extensions.append(extension)
    return selected


def copy_mail_sample(source_root: Path, target_root: Path, report: dict) -> None:
    """Copy stable Markdown mail records plus matching HTML bodies."""
    mail_root = source_root / "Mail"
    markdown = [path for path in iter_files(mail_root) if path.suffix.lower() == ".md"]
    selected = markdown[:40]
    for source in selected:
        copy_file(source, target_root / source.relative_to(source_root), report)
        html = source.with_suffix(".html")
        if html.is_file() and not html.is_symlink():
            copy_file(html, target_root / html.relative_to(source_root), report)
    report["samples"]["Mail"] = len(selected)


def tree_fingerprint(root: Path) -> str:
    """Hash source metadata without reading file contents."""
    digest = hashlib.sha256()
    for path in iter_files(root):
        try:
            stat = path.stat()
        except OSError:
            continue
        digest.update(str(path.relative_to(root)).encode("utf-8", errors="surrogateescape"))
        digest.update(f":{stat.st_size}:{stat.st_mtime_ns}\n".encode())
    return digest.hexdigest()


def validate_paths(source: Path, target: Path, allow_existing: bool) -> None:
    """Fail closed when paths do not match the registered vault topology."""
    source = source.resolve()
    target = target.resolve()
    if source.name != "Principal" or target.name != "Proves":
        raise ValueError("Expected vault basenames Principal and Proves.")
    if source.parent != target.parent or source == target:
        raise ValueError("Principal and Proves must be distinct sibling directories.")
    if not source.is_dir() or not target.is_dir():
        raise ValueError("Both registered vault directories must already exist.")
    existing = [
        item
        for item in target.iterdir()
        if item.name not in IGNORED_NAMES
        and (item.is_file() or (item.is_dir() and any(item.iterdir())))
    ]
    if existing and not allow_existing:
        raise ValueError("Proves is not empty; use --allow-existing only for an intentional refresh.")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    parser.add_argument("--allow-existing", action="store_true")
    args = parser.parse_args()

    source = args.source.resolve()
    target = args.target.resolve()
    validate_paths(source, target, args.allow_existing)
    fingerprint_before = tree_fingerprint(source)
    report = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source": str(source),
        "target": str(target),
        "files_copied": 0,
        "bytes_copied": 0,
        "files_skipped_by_size": 0,
        "samples": {},
        "errors": [],
    }

    for directory in FULL_DIRECTORIES:
        copy_complete_directory(source, target, directory, report)
    copy_complete_directory(source, target, ".gnosi/page_meta", report)
    copy_mail_sample(source, target, report)

    for directory, (limit, max_bytes) in SAMPLE_POLICIES.items():
        selected = diverse_sample(source / directory, limit, max_bytes, report)
        for path in selected:
            copy_file(path, target / path.relative_to(source), report)
        report["samples"][directory] = len(selected)

    registry = target / "BD" / "vault_db_registry.json"
    if not registry.is_file():
        report["errors"].append({"path": str(registry), "error": "Required registry is missing."})

    fingerprint_after = tree_fingerprint(source)
    report["source_unchanged"] = fingerprint_before == fingerprint_after
    manifest = target / ".gnosi" / "test_dataset_manifest.json"
    manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["source_unchanged"] and registry.is_file() else 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError) as exc:
        print(f"Dataset build stopped safely: {exc}", file=sys.stderr)
        raise SystemExit(2)
