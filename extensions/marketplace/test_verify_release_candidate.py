from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from extensions.marketplace.verify_release_candidate import (
    CandidateVerificationError,
    verify_candidate,
)


def _sign(private_key: Ed25519PrivateKey, payload: bytes) -> str:
    return base64.b64encode(private_key.sign(payload)).decode("ascii")


def _write_index(
    directory: Path,
    index_name: str,
    signature_name: str,
    document: object,
    private_key: Ed25519PrivateKey,
) -> None:
    payload = json.dumps(document, indent=2, sort_keys=True).encode("utf-8")
    (directory / index_name).write_bytes(payload)
    (directory / signature_name).write_text(_sign(private_key, payload), encoding="ascii")


def _fixture(tmp_path: Path) -> tuple[Path, str]:
    private_key = Ed25519PrivateKey.generate()
    public_key = base64.b64encode(
        private_key.public_key().public_bytes_raw()
    ).decode("ascii")
    artifacts = tmp_path / "artifacts"
    plugins = artifacts / "plugins"
    templates = artifacts / "vault-templates"
    plugins.mkdir(parents=True)
    templates.mkdir()
    (artifacts / "release-notes.md").write_text("# Synthetic release\n", encoding="utf-8")

    plugin_package = b"synthetic plugin package"
    plugin_name = "hello-command.zip"
    (plugins / plugin_name).write_bytes(plugin_package)
    _write_index(
        plugins,
        "plugins-index.json",
        "plugins-index.sig",
        [{
            "id": "hello-command",
            "url": f"https://example.test/{plugin_name}",
            "sha256": hashlib.sha256(plugin_package).hexdigest(),
            "signature": _sign(private_key, plugin_package),
        }],
        private_key,
    )

    template_package = b"synthetic vault template"
    template_name = "starter-vault-3.0.0.gnosi-vault.zip"
    (templates / template_name).write_bytes(template_package)
    _write_index(
        templates,
        "vault-templates-index.json",
        "vault-templates-index.sig",
        {
            "schemaVersion": 1,
            "vaultTemplates": [{
                "id": "starter-vault",
                "url": f"https://example.test/{template_name}",
                "sha256": hashlib.sha256(template_package).hexdigest(),
                "signature": _sign(private_key, template_package),
                "size": len(template_package),
            }],
        },
        private_key,
    )
    return artifacts, public_key


def test_complete_signed_candidate_passes(tmp_path: Path) -> None:
    artifacts, public_key = _fixture(tmp_path)
    assert verify_candidate(artifacts, public_key_b64=public_key) == {
        "plugins": 1,
        "vaultTemplates": 1,
    }


@pytest.mark.parametrize(
    ("relative", "replacement", "message"),
    [
        ("plugins/plugins-index.sig", b"bad", "Invalid signature"),
        ("plugins/hello-command.zip", b"changed", "SHA-256 mismatch"),
        ("vault-templates/vault-templates-index.sig", b"", "Empty announced"),
        ("vault-templates/starter-vault-3.0.0.gnosi-vault.zip", None, "Missing announced"),
        ("release-notes.md", b"", "Empty announced"),
    ],
)
def test_candidate_rejects_missing_or_changed_announced_files(
    tmp_path: Path,
    relative: str,
    replacement: bytes | None,
    message: str,
) -> None:
    artifacts, public_key = _fixture(tmp_path)
    path = artifacts / relative
    if replacement is None:
        path.unlink()
    else:
        path.write_bytes(replacement)
    with pytest.raises(CandidateVerificationError, match=message):
        verify_candidate(artifacts, public_key_b64=public_key)


def test_candidate_rejects_unannounced_package(tmp_path: Path) -> None:
    artifacts, public_key = _fixture(tmp_path)
    (artifacts / "plugins" / "extra.zip").write_bytes(b"extra")
    with pytest.raises(CandidateVerificationError, match="Package set mismatch"):
        verify_candidate(artifacts, public_key_b64=public_key)
