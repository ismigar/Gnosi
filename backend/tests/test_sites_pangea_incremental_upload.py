"""Actual legacy adapter delta archives against isolated PHP server trees."""
from __future__ import annotations

import contextlib
import json
import os
import shutil
import subprocess
import tarfile
from pathlib import Path

import pytest

from backend.domains.sites import pangea
from backend.domains.sites.models import ServiceSettings, SiteTarget
from backend.domains.sites.private_service import service_root
from backend.domains.sites.storage import private_json
from backend.tests.test_sites import website as website


@pytest.fixture(params=["staging", "production"])
def legacy_transport(website, tmp_path, monkeypatch, request):
    if shutil.which("php") is None:
        pytest.skip("PHP is required")
    environment = request.param
    site = website.site.model_copy(deep=True)
    target = SiteTarget(id="pangea-production" if environment == "production" else "pangea", adapter="legacy-pangea", environment=environment, enabled=True, base_url="https://temenosismael.org" if environment == "production" else "https://temenosismael.org/_gnosi-proves/webs/" + site.id + "/current")
    site.targets.append(target)
    site = website.store.save(site)
    if environment == "production":
        settings = ServiceSettings(test_mode=False, delivery_transport="smtp", smtp_host="smtp.example.invalid", smtp_username="site", sender_email="site@example.invalid")
        root = service_root(website.store, site.id, target.id)
        private_json(root / "settings.json", settings.model_dump(mode="json"))
        private_json(root / "production-registration.json", {"site_id": site.id, "scope": website.store.private_root.name, "target_id": target.id, "base_url": target.base_url})
    remote = tmp_path / "account"
    marker = remote / "web/_gnosi-proves/.gnosi-staging-marker"
    marker.parent.mkdir(parents=True)
    marker.write_text("Synthetic staging owner")
    archives = []

    class LocalBridge:
        def run(self, command):
            return subprocess.run(command, shell=True, capture_output=True, text=True, check=True).stdout

    class LocalDriver:
        REMOTE_ROOT = str(remote)
        CONFIG = tmp_path / "unused.json"

        @contextlib.contextmanager
        def bridge(self):
            yield LocalBridge()

        def php(self, bridge, code):
            return subprocess.run([shutil.which("php"), "-r", code], capture_output=True, text=True, check=True).stdout

        def put(self, bridge, source, destination):
            assert Path(destination).stat().st_mode & 0o777 == 0o600
            if source.name == "release.tar.gz":
                with tarfile.open(source) as archive:
                    archives.append({member.name: archive.extractfile(member).read() for member in archive.getmembers() if member.isfile()})
            shutil.copyfile(source, destination)

    monkeypatch.setattr(pangea, "driver", lambda store: LocalDriver())
    monkeypatch.setattr(pangea, "_start_worker", lambda *args: None)
    output = tmp_path / "output"
    output.mkdir()

    def publish(identity, parent):
        pangea.upload_release(website.store, site, target, identity, output, parent)

    public, private = map(Path, pangea.paths(LocalDriver(), site, target))
    return output, public, private, publish, archives, site


def test_legacy_pangea_transfers_only_changed_files_and_preserves_complete_releases(legacy_transport, monkeypatch):
    output, public, private, publish, archives, site = legacy_transport
    unchanged = b"UNCHANGED LARGE PDF ASSET" * 10000
    (output / "asset.pdf").write_bytes(unchanged)
    (output / "index.html").write_bytes(b"old article")
    (output / "withdrawn.html").write_bytes(b"withdraw me")
    first, second, third = "a" * 32, "b" * 32, "c" * 32
    publish(first, None)
    (output / "index.html").write_bytes(b"edited article")
    (output / "translation.html").write_bytes(b"new translation")
    (output / "withdrawn.html").unlink()
    (output / ".htaccess").write_text("Options -Indexes\n# edited rules\n")
    site.languages = ["ca", "es"]
    original_read = Path.read_bytes

    def forbid_unchanged_asset_buffer(path):
        assert path != output / "asset.pdf"
        return original_read(path)

    monkeypatch.setattr(Path, "read_bytes", forbid_unchanged_asset_buffer)
    publish(second, first)
    delta = archives[-1]
    assert {name for name in delta if name.startswith("public/")} == {"public/index.html", "public/translation.html", "public/.htaccess"}
    assert delta["public/index.html"] == b"edited article"
    assert json.loads(delta["service/config.json"])["languages"] == ["ca", "es"]
    current = private / "releases" / second / "public"
    assert (public / "current").resolve() == current
    assert (current / "asset.pdf").read_bytes() == unchanged
    assert not (current / "withdrawn.html").exists()
    assert "# edited rules" in (current / ".htaccess").read_text()
    assert (current / "asset.pdf").stat().st_nlink == 1
    assert (current / "asset.pdf").stat().st_ino != (private / "releases" / first / "public/asset.pdf").stat().st_ino
    checks = json.loads((current.parent / "checksums.json").read_text())
    assert set(checks) == {"asset.pdf", "index.html", "translation.html", ".htaccess"}
    publish(third, second)
    assert not any(name.startswith("public/") for name in archives[-1])
    assert (public / "current/asset.pdf").read_bytes() == unchanged
    # Retention still keeps exactly current and its actual predecessor.
    assert {path.name for path in (private / "releases").iterdir()} == {second, third}


@pytest.mark.parametrize("hostile", ["tampered", "symlink", "hardlink", "extra", "stale-parent"])
def test_legacy_pangea_rejects_unverified_or_stale_parent(legacy_transport, tmp_path, hostile):
    output, public, private, publish, archives, _ = legacy_transport
    (output / "index.html").write_bytes(b"stable")
    first, second = "a" * 32, "b" * 32
    publish(first, None)
    parent = private / "releases" / first / "public/index.html"
    if hostile == "tampered":
        parent.write_bytes(b"modified")
    elif hostile in {"symlink", "hardlink"}:
        alias = tmp_path / "outside"
        alias.write_bytes(b"stable")
        parent.unlink()
        if hostile == "symlink":
            parent.symlink_to(alias)
        else:
            os.link(alias, parent)
    elif hostile == "extra":
        (parent.parent / "unreviewed").write_bytes(b"unexpected")
    with pytest.raises(subprocess.CalledProcessError):
        publish(second, None if hostile == "stale-parent" else first)
    assert len(archives) == 1
    assert (public / "current").readlink() == parent.parent
    assert not (private / "releases" / second).exists()


def test_legacy_pangea_rejects_corrupted_control_manifest(legacy_transport, website, monkeypatch):
    output, public, _, publish, archives, _ = legacy_transport
    (output / "index.html").write_bytes(b"stable")
    driver = pangea.driver(website.store)
    original_put = driver.put

    def corrupt_manifest(bridge, source, destination):
        original_put(bridge, source, destination)
        if source.name == "checksums.json":
            with Path(destination).open("ab") as stream:
                stream.write(b"CORRUPTED")

    monkeypatch.setattr(driver, "put", corrupt_manifest)
    monkeypatch.setattr(pangea, "driver", lambda store: driver)
    with pytest.raises(subprocess.CalledProcessError):
        publish("a" * 32, None)
    assert not archives
    assert not (public / "current").exists()


def test_unchanged_attachment_is_not_rehashed_at_every_pointer_check(legacy_transport, website, tmp_path, monkeypatch):
    output, public, _, publish, _, _ = legacy_transport
    attachment = b"large unchanged attachment\n" * 10000
    (output / "asset.pdf").write_bytes(attachment)
    (output / "index.html").write_bytes(b"article")
    first, second, third = "a" * 32, "b" * 32, "c" * 32
    publish(first, None)
    publish(second, first)
    driver = pangea.driver(website.store)
    original_php = driver.php
    hashes = tmp_path / "hashes.json"
    reads = []

    def measured_php(bridge, code):
        instrument = ('$hashReads=[];function measured_hash($algorithm,$path){global $hashReads;'
                      'if(filesize($path)===' + str(len(attachment)) + '){$hashReads[]=$path;}return hash_file($algorithm,$path);}'
                      'register_shutdown_function(function(){global $hashReads;file_put_contents('
                      + json.dumps(str(hashes)) + ',json_encode($hashReads));});')
        try:
            return original_php(bridge, instrument + code.replace("hash_file(", "measured_hash("))
        finally:
            reads.extend(json.loads(hashes.read_text()))

    monkeypatch.setattr(driver, "php", measured_php)
    monkeypatch.setattr(pangea, "driver", lambda store: driver)
    (output / "index.html").write_bytes(b"edited article")
    publish(third, second)
    assert (public / "current/asset.pdf").read_bytes() == attachment
    assert len(reads) <= 6, reads


@pytest.mark.parametrize("changed", ["copy-source", "activation-parent", "activation-candidate"])
def test_changes_after_initial_verification_cannot_activate(legacy_transport, website, monkeypatch, changed):
    output, public, private, publish, _, _ = legacy_transport
    (output / "index.html").write_bytes(b"stable")
    first, second = "a" * 32, "b" * 32
    publish(first, None)
    parent = private / "releases" / first / "public/index.html"
    driver = pangea.driver(website.store)
    original_php = driver.php

    def mutate(bridge, code):
        if changed == "copy-source" and "$verifiedParent=true" in code:
            code = code.replace("$missing=[];", 'file_put_contents(' + json.dumps(str(parent)) + ',"tampered");$missing=[];')
        elif changed != "copy-source" and "$tmp=$link" in code:
            path = parent if changed == "activation-parent" else private / "releases" / second / "public/index.html"
            path.write_bytes(b"tampered")
        return original_php(bridge, code)

    monkeypatch.setattr(driver, "php", mutate)
    monkeypatch.setattr(pangea, "driver", lambda store: driver)
    with pytest.raises(subprocess.CalledProcessError):
        publish(second, first)
    assert (public / "current").readlink() == parent.parent
