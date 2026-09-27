from __future__ import annotations

import hashlib
import io
import json
import re
import uuid
import zipfile
from pathlib import Path

import pytest

from backend.services import plugin_signing, vault_templates
from extensions.marketplace.build_vault_templates import (
    _additional_packages,
    _starter_package,
    build,
)
from extensions.marketplace.reviewed_templates import reviewed_packages, validate_reviewed


def review_fixture(tmp_path: Path, text: str = "# Original public note") -> tuple[bytes, dict]:
    source = tmp_path / "source"
    source.mkdir(exist_ok=True)
    (source / "Wiki").mkdir(exist_ok=True)
    (source / "Wiki" / "Note.md").write_text(text)
    package, _ = vault_templates.build_package(source, {
        "id": "community-template", "version": "1.0.0", "name": "Community template",
        "author": "Contributor", "license": "CC-BY-4.0",
    }, acknowledge_findings=True)
    receipt = {
        "schemaVersion": 1, "submissionId": str(uuid.uuid4()), "status": "approved",
        "kind": "vault-template", "sha256": hashlib.sha256(package).hexdigest(),
        "filename": "community-template-1.0.0.gnosi-vault.zip", "sizeBytes": len(package),
        "metadata": {"id": "community-template", "version": "1.0.0"},
        "reviewedAt": "2026-09-26T10:00:00Z", "reviewedBy": "maintainer",
    }
    return package, receipt


def stage(directory: Path, package: bytes, receipt: dict) -> None:
    directory.mkdir()
    (directory / receipt["filename"]).write_bytes(package)
    (directory / "community-template-1.0.0.review.json").write_text(json.dumps(receipt))


def test_approved_package_enters_signed_catalog(tmp_path, monkeypatch):
    package, receipt = review_fixture(tmp_path)
    directory = tmp_path / "reviewed"
    stage(directory, package, receipt)
    key = plugin_signing.generate_keypair()
    monkeypatch.setenv("GNOSI_PLUGIN_SIGNING_KEY", key["private"])
    out = tmp_path / "candidate"
    result = build(out, "https://example.test/v1", reviewed_dir=directory, expected_public_key=key["public"])
    assert result["templates"] == 4
    index = json.loads((out / "vault-templates-index.json").read_bytes())
    entry = index["vaultTemplates"][-1]
    assert entry["id"] == "community-template"
    assert plugin_signing.verify(key["public"], entry["signature"], package)


@pytest.mark.parametrize(("field", "value"), [
    ("status", "quarantined"), ("status", "rejected"), ("kind", "plugin"),
    ("sha256", "0" * 64), ("sizeBytes", 1), ("reviewedBy", ""),
    ("reviewedAt", "invalid"), ("submissionId", "invalid"),
    ("metadata", {"id": "other", "version": "1.0.0"}),
    ("filename", "../other.zip"),
])
def test_unapproved_or_mismatched_receipt_is_rejected(tmp_path, field, value):
    package, receipt = review_fixture(tmp_path)
    receipt[field] = value
    with pytest.raises(ValueError):
        validate_reviewed(receipt, package)


def test_review_cannot_override_secret_detection(tmp_path):
    package, receipt = review_fixture(tmp_path, "api_key = 'private-credential-value'")
    with pytest.raises(ValueError, match="possible credential"):
        validate_reviewed(receipt, package)


def test_unpaired_and_symlink_inputs_are_rejected(tmp_path):
    package, receipt = review_fixture(tmp_path)
    directory = tmp_path / "reviewed"
    stage(directory, package, receipt)
    extra = directory / "unreviewed.zip"
    extra.write_bytes(package)
    with pytest.raises(ValueError, match="unpaired"):
        reviewed_packages(directory)
    extra.unlink()
    (directory / receipt["filename"]).unlink()
    (tmp_path / "external.zip").write_bytes(package)
    (directory / receipt["filename"]).symlink_to(tmp_path / "external.zip")
    with pytest.raises(ValueError, match="symbolic link"):
        reviewed_packages(directory)


def test_all_official_templates_are_deterministic_multilingual_and_linked():
    first = [_starter_package(), *_additional_packages()]
    second = [_starter_package(), *_additional_packages()]
    assert first == second
    assert len(first) == 3
    for package, _ in first:
        manifest, _ = vault_templates.validate_package(package)
        assert set(manifest["languages"]) == {"ca", "es", "en", "fr"}
        assert manifest["preview"]
        with zipfile.ZipFile(io.BytesIO(package)) as archive:
            pages = {Path(name).stem for name in archive.namelist() if name.endswith(".md")}
            for name in archive.namelist():
                if not name.endswith(".md"):
                    continue
                for link in re.findall(r"\[\[([^]|]+)(?:\|[^]]+)?\]\]", archive.read(name).decode()):
                    assert link in pages, (manifest["id"], name, link)


def test_invalid_review_fails_before_signing_or_output(tmp_path, monkeypatch):
    package, receipt = review_fixture(tmp_path)
    receipt["status"] = "quarantined"
    directory = tmp_path / "reviewed"
    stage(directory, package, receipt)
    monkeypatch.delenv("GNOSI_PLUGIN_SIGNING_KEY", raising=False)
    with pytest.raises(ValueError, match="approved"):
        build(tmp_path / "candidate", "https://example.test", reviewed_dir=directory)
    assert not (tmp_path / "candidate").exists()
