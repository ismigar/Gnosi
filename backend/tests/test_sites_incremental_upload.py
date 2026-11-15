"""Incremental transport executed against disposable PHP server trees."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

from backend.domains.sites import runtime
from backend.domains.sites.incremental_upload import output_manifest
from backend.domains.sites.models import SiteTarget, TargetConnection
from backend.tests.test_sites import website as website


@pytest.fixture
def transport(website, tmp_path, monkeypatch):
    if shutil.which("php") is None:
        pytest.skip("PHP is required")
    remote = tmp_path / "account/public_html/_gnosi-incremental"
    target = SiteTarget(id="incremental", adapter="ssh", environment="staging", base_url="https://example.invalid/current", enabled=True)
    site = website.site.model_copy(deep=True)
    site.targets.append(target)
    site = website.store.save(site)
    runtime.save_connection(website.store, site.id, target.id, TargetConnection(
        host="test.invalid", username="test", remote_root=str(remote), document_root=str(remote.parent)))
    payloads = []

    def local_ssh(settings, command, payload=None, timeout=45):
        if '$daemon=gnosi_service_script("daemon.php")' in command:
            return b'{"started":true}'
        payloads.append(payload)
        result = subprocess.run(["/bin/sh", "-c", command], input=payload, capture_output=True, timeout=timeout)
        if result.returncode:
            raise RuntimeError(result.stderr.decode())
        return result.stdout

    monkeypatch.setattr(runtime, "_ssh", local_ssh)
    output = tmp_path / "output"
    output.mkdir()

    def publish(identity, parent):
        runtime.upload_release(website.store, site, target, identity, output, parent)

    return output, remote, publish, payloads, site, target


def test_only_changed_payloads_transfer_and_releases_have_independent_bytes(transport, monkeypatch):
    output, remote, publish, payloads, _, _ = transport
    unchanged = b"LARGE UNCHANGED ASSET" * 10000
    (output / "asset.bin").write_bytes(unchanged)
    (output / "index.html").write_bytes(b"old article")
    (output / "withdrawn.html").write_bytes(b"withdraw me")
    publish("first", None)
    payloads.clear()
    (output / "index.html").write_bytes(b"edited article")
    (output / "translated.html").write_bytes(b"new translation")
    (output / "withdrawn.html").unlink()
    original_read = Path.read_bytes

    def forbid_asset_buffer(path):
        assert path != output / "asset.bin", "Unchanged asset must only be streamed for hashing"
        return original_read(path)

    monkeypatch.setattr(Path, "read_bytes", forbid_asset_buffer)
    publish("second", "first")
    assert unchanged not in payloads
    assert b"edited article" in payloads
    assert b"new translation" in payloads
    current = remote / "releases/second"
    assert not (current / "withdrawn.html").exists()
    assert (current / "asset.bin").read_bytes() == unchanged
    assert (current / "asset.bin").stat().st_ino != (remote / "releases/first/asset.bin").stat().st_ino
    assert (current / "asset.bin").stat().st_nlink == 1
    # Editing old bytes cannot silently mutate the independently copied release.
    (remote / "releases/first/asset.bin").write_bytes(b"old release changed")
    assert (current / "asset.bin").read_bytes() == unchanged


@pytest.mark.parametrize("hostile", ["tampered", "symlink", "hardlink", "extra"])
def test_unverified_parent_cannot_supply_reused_files(transport, tmp_path, hostile):
    output, remote, publish, _, _, _ = transport
    (output / "index.html").write_bytes(b"stable")
    publish("first", None)
    parent = remote / "releases/first/index.html"
    if hostile == "tampered":
        parent.write_bytes(b"tampered")
    elif hostile in {"symlink", "hardlink"}:
        alias = tmp_path / "outside"
        alias.write_bytes(b"stable")
        parent.unlink()
        if hostile == "symlink":
            parent.symlink_to(alias)
        else:
            os.link(alias, parent)
    else:
        (parent.parent / "unreviewed").write_bytes(b"extra")
    with pytest.raises(RuntimeError):
        publish("second", "first")
    assert (remote / "current").readlink() == Path("releases/first")
    assert not (remote / "releases/second/index.html").exists()


def test_stale_parent_rejected_before_candidate_is_created(transport):
    output, remote, publish, _, _, _ = transport
    (output / "index.html").write_bytes(b"stable")
    publish("first", None)
    with pytest.raises(RuntimeError, match="Parent changed"):
        publish("second", None)
    assert not (remote / "releases/second").exists()


def test_htaccess_changes_are_transferred_and_private_config_is_refreshed(transport):
    output, remote, publish, payloads, site, target = transport
    (output / "index.html").write_bytes(b"stable")
    (output / ".htaccess").write_text("Options -Indexes\n")
    publish("first", None)
    payloads.clear()
    (output / ".htaccess").write_text("Options -Indexes\n# changed rules\n")
    site.languages = ["ca", "es"]
    publish("second", "first")
    assert "# changed rules" in (remote / "releases/second/.htaccess").read_text()
    assert any(payload and b"# changed rules" in payload and b"SetEnv GNOSI_SITES_SERVICE_CONFIG" in payload for payload in payloads)
    configs = [json.loads(p) for p in payloads if p and p.startswith(b'{"schema_version":')]
    assert configs and configs[0]["test_mode"] is True
    assert configs[0]["allow_delivery"] is False
    assert configs[0]["languages"] == ["ca", "es"]


@pytest.mark.parametrize("hostile", ["symlink", "directory-symlink", "fifo", "hardlink", "backslash"])
def test_local_manifest_rejects_unsafe_entries(tmp_path, hostile):
    output = tmp_path / "output"
    output.mkdir()
    outside = tmp_path / "outside"
    outside.write_bytes(b"external")
    entry = output / "entry"
    if hostile == "symlink":
        entry.symlink_to(outside)
    elif hostile == "directory-symlink":
        entry.symlink_to(tmp_path, target_is_directory=True)
    elif hostile == "fifo":
        os.mkfifo(entry)
    elif hostile == "hardlink":
        os.link(outside, entry)
    else:
        (output / "invalid\\name").write_bytes(b"invalid")
    with pytest.raises(ValueError):
        output_manifest(output)
