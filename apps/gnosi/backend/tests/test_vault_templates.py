"""Vault template package, privacy, signature, and atomic installation tests."""
from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

import pytest

from backend.services import plugin_signing, vault_templates
from backend.services.marketplace_http import PublicResponse


def _metadata(**overrides):
    return {
        "id": "research-vault",
        "version": "1.0.0",
        "name": "Research Vault",
        "description": "Portable research workspace",
        "author": "Tester",
        "license": "CC-BY-4.0",
        **overrides,
    }


def test_export_filters_private_and_executable_content(tmp_path):
    (tmp_path / "Wiki").mkdir()
    (tmp_path / "Wiki" / "Note.md").write_text("# Safe", encoding="utf-8")
    (tmp_path / ".gnosi").mkdir()
    (tmp_path / ".gnosi" / "plugins.json").write_text("{}", encoding="utf-8")
    (tmp_path / "Mail").mkdir()
    (tmp_path / "Mail" / "private.md").write_text("secret", encoding="utf-8")
    (tmp_path / "unsafe.js").write_text("fetch('https://evil.example')", encoding="utf-8")

    preview = vault_templates.export_preview(tmp_path)

    assert [item["path"] for item in preview["included"]] == ["Wiki/Note.md"]
    excluded = {item["path"]: item["reason"] for item in preview["excluded"]}
    assert excluded[".gnosi/plugins.json"] == "private-root"
    assert excluded["Mail/private.md"] == "private-root"
    assert excluded["unsafe.js"] == "executable-content"


def test_export_requires_acknowledgement_for_secret_findings(tmp_path):
    (tmp_path / "Wiki").mkdir()
    (tmp_path / "Wiki" / "Config.md").write_text(
        "api_key = 'super-secret-value'", encoding="utf-8"
    )

    with pytest.raises(vault_templates.VaultTemplateError, match="acknowledged"):
        vault_templates.build_package(tmp_path, _metadata())

    package, preview = vault_templates.build_package(
        tmp_path, _metadata(), acknowledge_findings=True
    )
    assert package
    assert preview["findings"][0]["kind"] == "credential-assignment"


def test_package_is_deterministic_and_round_trips(tmp_path):
    (tmp_path / "Wiki").mkdir()
    (tmp_path / "Wiki" / "Note.md").write_text("# Note\n", encoding="utf-8")

    first, _ = vault_templates.build_package(tmp_path, _metadata())
    second, _ = vault_templates.build_package(tmp_path, _metadata())
    manifest, infos = vault_templates.validate_package(first)

    assert first == second
    assert manifest["id"] == "research-vault"
    assert [info.filename for info in infos] == ["vault/Wiki/Note.md"]


def test_package_rejects_tampered_inventory(tmp_path):
    (tmp_path / "Wiki").mkdir()
    (tmp_path / "Wiki" / "Note.md").write_text("original", encoding="utf-8")
    package, _ = vault_templates.build_package(tmp_path, _metadata())
    source = zipfile.ZipFile(io.BytesIO(package))
    manifest = json.loads(source.read("template.json"))
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("template.json", json.dumps(manifest))
        archive.writestr("vault/Wiki/Note.md", "tampered")

    with pytest.raises(vault_templates.VaultTemplateError, match="integrity"):
        vault_templates.validate_package(buffer.getvalue())


def test_install_is_staged_and_records_provenance(tmp_path):
    source = tmp_path / "source"
    root = tmp_path / "vaults"
    (source / "Wiki").mkdir(parents=True)
    (source / "Wiki" / "Note.md").write_text("hello", encoding="utf-8")
    package, _ = vault_templates.build_package(source, _metadata())

    manifest, target = vault_templates.install_package(
        package,
        vaults_root=root,
        vault_name="My Research",
        source_url="https://example.test/research.zip",
        checksum="a" * 64,
        signed_by="publisher",
    )

    assert manifest["id"] == "research-vault"
    assert (target / "Wiki" / "Note.md").read_text(encoding="utf-8") == "hello"
    provenance = json.loads((target / ".gnosi" / "template_origin.json").read_text())
    assert provenance["signedBy"] == "publisher"
    assert not list(root.glob(".gnosi-template-stage-*"))


def test_catalog_requires_trusted_detached_signature(tmp_path, monkeypatch):
    keypair = plugin_signing.generate_keypair()
    plugin_signing.add_trusted_key(tmp_path, "publisher", keypair["public"])
    index = json.dumps({
        "vaultTemplates": [{
            "id": "starter-vault",
            "version": "1.0.0",
            "name": "Starter",
            "url": "https://example.test/starter.zip",
            "sha256": "a" * 64,
            "signature": "package-signature",
        }],
    }).encode()
    signature = plugin_signing.sign(keypair["private"], index).encode()

    def fake_fetch(url, **_kwargs):
        body = signature if url.endswith(".sig") else index
        return PublicResponse(body=body, url=url, status_code=200, content_type="application/json")

    monkeypatch.setattr(vault_templates, "fetch_public_bytes", fake_fetch)
    catalog = vault_templates.load_catalog(tmp_path, "https://example.test/index.json")

    assert catalog["signedBy"] == "publisher"
    assert catalog["templates"][0]["verified"] is True


def test_catalog_rejects_untrusted_signature(tmp_path, monkeypatch):
    keypair = plugin_signing.generate_keypair()
    index = b'{"vaultTemplates": []}'
    signature = plugin_signing.sign(keypair["private"], index).encode()

    def fake_fetch(url, **_kwargs):
        body = signature if url.endswith(".sig") else index
        return PublicResponse(body=body, url=url, status_code=200, content_type="application/json")

    monkeypatch.setattr(vault_templates, "fetch_public_bytes", fake_fetch)
    with pytest.raises(vault_templates.VaultTemplateError, match="untrusted"):
        vault_templates.load_catalog(tmp_path, "https://example.test/index.json")


def test_release_builder_emits_signed_valid_starter(tmp_path, monkeypatch):
    from marketplace import build_vault_templates

    keypair = plugin_signing.generate_keypair()
    monkeypatch.setenv("GNOSI_PLUGIN_SIGNING_KEY", keypair["private"])
    output = tmp_path / "release"

    result = build_vault_templates.build(output, "https://example.test/assets")

    assert result["templates"] == 1
    index_bytes = (output / "vault-templates-index.json").read_bytes()
    signature = (output / "vault-templates-index.sig").read_text(encoding="ascii")
    assert plugin_signing.verify(keypair["public"], signature, index_bytes)
    index = json.loads(index_bytes)
    entry = index["vaultTemplates"][0]
    package = (output / result["package"]).read_bytes()
    assert plugin_signing.verify(keypair["public"], entry["signature"], package)
    manifest, _infos = vault_templates.validate_package(package)
    assert manifest["id"] == "starter-vault"
    assert manifest["version"] == "2.0.0"
    assert manifest["languages"] == ["ca", "en", "es"]
    assert manifest["categories"] == ["starter", "research", "writing"]

    archive = zipfile.ZipFile(io.BytesIO(package))
    names = set(archive.namelist())
    assert "vault/Wiki/Start here.md" in names
    assert "vault/Wiki/Comença aquí.md" in names
    assert "vault/Wiki/Empieza aquí.md" in names
    assert "vault/BD/vault_db_registry.json" in names
    assert "vault/BD/Research/Sources/Gnosi research workflow.md" in names
    registry = json.loads(archive.read("vault/BD/vault_db_registry.json"))
    source_table = registry["tables"][0]
    assert source_table["id"] == "research-sources"
    assert "Citation Key" in {
        property_["name"] for property_ in source_table["properties"]
    }
    source = archive.read(
        "vault/BD/Research/Sources/Gnosi research workflow.md"
    ).decode("utf-8")
    assert "Citation Key: gnosi2026" in source
    for path in (
        "vault/Wiki/Manuscript - First paragraph.md",
        "vault/Wiki/Manuscrit - Primer paràgraf.md",
        "vault/Wiki/Manuscrito - Primer párrafo.md",
    ):
        assert "[@gnosi2026]" in archive.read(path).decode("utf-8")
