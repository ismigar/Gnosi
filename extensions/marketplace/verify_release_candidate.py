#!/usr/bin/env python3
"""Verify every signed marketplace file announced by a release candidate."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path
import sys
from urllib.parse import unquote, urlsplit

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from extensions.marketplace.signing_policy import OFFICIAL_PUBLIC_KEY_B64


class CandidateVerificationError(RuntimeError):
    """Raised when a candidate is incomplete, unsigned, or internally inconsistent."""


def _read_required(path: Path) -> bytes:
    if not path.is_file():
        raise CandidateVerificationError(f"Missing announced release file: {path}")
    payload = path.read_bytes()
    if not payload:
        raise CandidateVerificationError(f"Empty announced release file: {path}")
    return payload


def _verify_signature(
    public_key: Ed25519PublicKey,
    signature: object,
    payload: bytes,
    label: str,
) -> None:
    if not isinstance(signature, str) or not signature:
        raise CandidateVerificationError(f"Missing signature for {label}")
    try:
        decoded = base64.b64decode(signature, validate=True)
        public_key.verify(decoded, payload)
    except (InvalidSignature, ValueError, TypeError) as error:
        raise CandidateVerificationError(f"Invalid signature for {label}") from error


def _package_name(value: object, label: str) -> str:
    if not isinstance(value, str):
        raise CandidateVerificationError(f"Missing HTTPS package URL for {label}")
    parsed = urlsplit(value)
    decoded_path = unquote(parsed.path)
    name = Path(decoded_path).name
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or parsed.query
        or parsed.fragment
        or not name
        or decoded_path != parsed.path
        or name != decoded_path.rsplit("/", 1)[-1]
        or name in {".", ".."}
    ):
        raise CandidateVerificationError(f"Unsafe package URL for {label}")
    return name


def _verify_index(
    directory: Path,
    index_name: str,
    signature_name: str,
    entries: object,
    public_key: Ed25519PublicKey,
) -> int:
    index_bytes = _read_required(directory / index_name)
    detached_signature = _read_required(directory / signature_name).decode("ascii")
    _verify_signature(public_key, detached_signature, index_bytes, index_name)
    if not isinstance(entries, list) or not entries:
        raise CandidateVerificationError(f"{index_name} must announce at least one package")

    announced: set[str] = set()
    for position, entry in enumerate(entries):
        label = f"{index_name} entry {position}"
        if not isinstance(entry, dict):
            raise CandidateVerificationError(f"Invalid {label}")
        package_name = _package_name(entry.get("url"), label)
        if package_name in announced:
            raise CandidateVerificationError(f"Duplicate package in {index_name}: {package_name}")
        package = _read_required(directory / package_name)
        digest = entry.get("sha256")
        if not isinstance(digest, str) or hashlib.sha256(package).hexdigest() != digest:
            raise CandidateVerificationError(f"SHA-256 mismatch for {package_name}")
        if "size" in entry and entry["size"] != len(package):
            raise CandidateVerificationError(f"Size mismatch for {package_name}")
        _verify_signature(public_key, entry.get("signature"), package, package_name)
        announced.add(package_name)

    actual = {path.name for path in directory.glob("*.zip") if path.is_file()}
    if actual != announced:
        raise CandidateVerificationError(
            f"Package set mismatch in {directory}: announced={sorted(announced)}, actual={sorted(actual)}"
        )
    return len(announced)


def verify_candidate(
    artifacts: Path,
    *,
    public_key_b64: str = OFFICIAL_PUBLIC_KEY_B64,
) -> dict[str, int]:
    """Verify signed plugin/template indexes and all files they announce."""

    try:
        public_key = Ed25519PublicKey.from_public_bytes(
            base64.b64decode(public_key_b64, validate=True)
        )
    except (ValueError, TypeError) as error:
        raise CandidateVerificationError("Invalid bundled official public key") from error

    plugin_dir = artifacts / "plugins"
    plugin_bytes = _read_required(plugin_dir / "plugins-index.json")
    try:
        plugin_entries = json.loads(plugin_bytes)
    except json.JSONDecodeError as error:
        raise CandidateVerificationError("Invalid plugins-index.json") from error
    plugins = _verify_index(
        plugin_dir,
        "plugins-index.json",
        "plugins-index.sig",
        plugin_entries,
        public_key,
    )

    template_dir = artifacts / "vault-templates"
    template_bytes = _read_required(template_dir / "vault-templates-index.json")
    try:
        template_document = json.loads(template_bytes)
    except json.JSONDecodeError as error:
        raise CandidateVerificationError("Invalid vault-templates-index.json") from error
    if not isinstance(template_document, dict) or template_document.get("schemaVersion") != 1:
        raise CandidateVerificationError("Unsupported vault template index schema")
    templates = _verify_index(
        template_dir,
        "vault-templates-index.json",
        "vault-templates-index.sig",
        template_document.get("vaultTemplates"),
        public_key,
    )

    _read_required(artifacts / "release-notes.md")
    return {"plugins": plugins, "vaultTemplates": templates}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", required=True)
    args = parser.parse_args()
    result = verify_candidate(Path(args.artifacts))
    sys.stdout.write(f"{json.dumps(result, sort_keys=True)}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
