#!/usr/bin/env python3
"""Build signed official Vault template packages as GitHub Release assets."""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
import zipfile
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

SCHEMA_VERSION = 1


def _private_key() -> Ed25519PrivateKey:
    raw = os.environ.get("GNOSI_PLUGIN_SIGNING_KEY", "").strip()
    if not raw:
        raise RuntimeError("GNOSI_PLUGIN_SIGNING_KEY is required for official templates")
    if raw.startswith("{"):
        raw = json.loads(raw)["private"]
    return Ed25519PrivateKey.from_private_bytes(base64.b64decode(raw))


def _sign(key: Ed25519PrivateKey, payload: bytes) -> str:
    return base64.b64encode(key.sign(payload)).decode("ascii")


def _write(archive: zipfile.ZipFile, name: str, payload: bytes) -> None:
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o100644 << 16
    archive.writestr(info, payload)


def _starter_package() -> tuple[bytes, dict]:
    welcome = (
        "---\n"
        "id: 8ef8ef98-8f5b-4b9c-ae54-5c1bff2d29d8\n"
        "title: Welcome to Gnosi\n"
        "---\n\n"
        "# Welcome to Gnosi\n\n"
        "This Vault was created from the official Starter template.\n\n"
        "- Create pages and connect them with wikilinks.\n"
        "- Add a database when you need structured records.\n"
        "- Keep your knowledge portable as Markdown and regular assets.\n"
    ).encode("utf-8")
    files = [{
        "path": "Wiki/Welcome to Gnosi.md",
        "size": len(welcome),
        "sha256": hashlib.sha256(welcome).hexdigest(),
    }]
    manifest = {
        "id": "starter-vault",
        "version": "1.0.0",
        "schemaVersion": SCHEMA_VERSION,
        "name": "Starter Vault",
        "description": "A clean, portable Gnosi Vault with a short welcome guide.",
        "author": "Gnosi",
        "license": "CC-BY-4.0",
        "minGnosiVersion": "1.0.0",
        "categories": ["starter", "productivity"],
        "languages": ["en"],
        "recommendedPlugins": [],
        "preview": "",
        "files": files,
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        _write(
            archive,
            "template.json",
            json.dumps(manifest, indent=2, ensure_ascii=False, sort_keys=True).encode("utf-8"),
        )
        _write(archive, "vault/Wiki/Welcome to Gnosi.md", welcome)
    return buffer.getvalue(), manifest


def build(out: Path, base_url: str) -> dict:
    """Write the starter package, signed index, and detached index signature."""

    key = _private_key()
    out.mkdir(parents=True, exist_ok=True)
    package, manifest = _starter_package()
    package_name = f"{manifest['id']}-{manifest['version']}.gnosi-vault.zip"
    (out / package_name).write_bytes(package)
    entry = {
        key: manifest[key]
        for key in (
            "id", "version", "name", "description", "author", "license",
            "categories", "languages", "recommendedPlugins", "preview",
        )
    }
    entry.update({
        "url": f"{base_url.rstrip('/')}/{package_name}",
        "sha256": hashlib.sha256(package).hexdigest(),
        "signature": _sign(key, package),
        "size": len(package),
    })
    index = {
        "schemaVersion": 1,
        "vaultTemplates": [entry],
    }
    index_bytes = json.dumps(
        index, indent=2, ensure_ascii=False, sort_keys=True
    ).encode("utf-8")
    (out / "vault-templates-index.json").write_bytes(index_bytes)
    (out / "vault-templates-index.sig").write_text(_sign(key, index_bytes), encoding="ascii")
    return {"templates": 1, "package": package_name, "out": str(out)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Build signed official Vault templates")
    parser.add_argument("--out", required=True)
    parser.add_argument(
        "--base-url",
        default="https://github.com/ismigar/Gnosi/releases/latest/download",
    )
    args = parser.parse_args()
    result = build(Path(args.out), args.base_url)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
