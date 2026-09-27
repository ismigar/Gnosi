"""Validate maintainer-reviewed template packages without credentials or execution."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import uuid
import zipfile
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Any

from backend.services.vault_templates import (
    _SECRET_PATTERNS,
    _TEXT_SUFFIXES,
    validate_package,
)

MAX_REVIEWED_BYTES = 50 * 1024 * 1024


def validate_reviewed(receipt: Any, package: bytes) -> dict[str, Any]:
    """Bind a human review receipt to the exact validated, privacy-checked bytes.

    Receipts must come from the authenticated broker. They are audit records,
    not signatures, and are not accepted from untrusted contributors as approval.
    """
    if not isinstance(receipt, dict) or receipt.get("schemaVersion") != 1:
        raise ValueError("Unsupported review receipt")
    if receipt.get("kind") != "vault-template" or receipt.get("status") != "approved":
        raise ValueError("Only approved Vault templates can enter the catalog")
    try:
        uuid.UUID(receipt["submissionId"])
        datetime.fromisoformat(receipt["reviewedAt"].replace("Z", "+00:00"))
    except (ValueError, TypeError, KeyError, AttributeError) as error:
        raise ValueError("Receipt is missing a valid review identity or date") from error
    if not isinstance(receipt.get("reviewedBy"), str) or not receipt["reviewedBy"].strip():
        raise ValueError("Receipt is missing the reviewer")
    if not package or len(package) > MAX_REVIEWED_BYTES or len(package) != receipt.get("sizeBytes"):
        raise ValueError("Reviewed package size does not match the receipt")
    if hashlib.sha256(package).hexdigest() != receipt.get("sha256"):
        raise ValueError("Reviewed package SHA-256 does not match the receipt")
    manifest, files = validate_package(package)
    metadata = receipt.get("metadata")
    if not isinstance(metadata, dict) or any(
        metadata.get(field) != manifest[field] for field in ("id", "version")
    ):
        raise ValueError("Reviewed template identity does not match its metadata")
    expected = f"{manifest['id']}-{manifest['version']}.gnosi-vault.zip"
    if receipt.get("filename") != expected:
        raise ValueError("Reviewed package filename does not match its manifest")
    if not manifest["license"] or not manifest["author"]:
        raise ValueError("Reviewed templates require an author and license")
    with zipfile.ZipFile(io.BytesIO(package)) as archive:
        for info in files:
            path = PurePosixPath(info.filename)
            if any(part.casefold().startswith(".env") for part in path.parts):
                raise ValueError("Reviewed template contains environment configuration")
            if path.suffix.casefold() in _TEXT_SUFFIXES:
                text = archive.read(info).decode("utf-8", errors="replace")
                if any(pattern.search(text) for _, pattern in _SECRET_PATTERNS):
                    raise ValueError(f"Reviewed template contains a possible credential: {info.filename}")
    return manifest


def read_reviewed(receipt_path: Path, package_path: Path) -> tuple[bytes, dict[str, Any], dict[str, Any]]:
    if receipt_path.is_symlink() or package_path.is_symlink():
        raise ValueError("Reviewed input must not be a symbolic link")
    if receipt_path.stat().st_size > 64 * 1024 or package_path.stat().st_size > MAX_REVIEWED_BYTES:
        raise ValueError("Reviewed input exceeds its size limit")
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    package = package_path.read_bytes()
    manifest = validate_reviewed(receipt, package)
    return package, manifest, receipt


def reviewed_packages(directory: Path) -> list[tuple[bytes, dict[str, Any]]]:
    if not directory.is_dir() or directory.is_symlink():
        raise ValueError("Reviewed directory must be a real directory")
    result = []
    expected_files = set()
    for receipt_path in sorted(directory.glob("*.review.json")):
        # Derive filenames from the directory entry, never from untrusted JSON.
        stem = receipt_path.name.removesuffix(".review.json")
        if not re.fullmatch(r"[a-z0-9][a-z0-9_.+-]{1,150}", stem):
            raise ValueError("Invalid reviewed input name")
        package_path = directory / f"{stem}.gnosi-vault.zip"
        package, manifest, _receipt = read_reviewed(receipt_path, package_path)
        expected_files.update({receipt_path.name, package_path.name})
        result.append((package, manifest))
    if {path.name for path in directory.iterdir()} != expected_files:
        raise ValueError("Reviewed directory contains unpaired or unexpected files")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--receipt", type=Path, required=True)
    parser.add_argument("--package", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    package, manifest, receipt = read_reviewed(args.receipt, args.package)
    args.out.mkdir(parents=True, exist_ok=True)
    stem = f"{manifest['id']}-{manifest['version']}"
    outputs = {
        args.out / f"{stem}.gnosi-vault.zip": package,
        args.out / f"{stem}.review.json": (json.dumps(receipt, sort_keys=True, indent=2) + "\n").encode(),
    }
    for path, data in outputs.items():
        if path.is_symlink() or (path.exists() and path.read_bytes() != data):
            raise ValueError("Refusing to replace different reviewed bytes")
    for path, data in outputs.items():
        path.write_bytes(data)
    print(json.dumps({"id": manifest["id"], "version": manifest["version"], "validated": True}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
