"""Execute remote publication/retention PHP against disposable server trees."""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess

import pytest

from backend.domains.sites import pangea, runtime


pytestmark = pytest.mark.skipif(shutil.which("php") is None, reason="PHP is required")


@pytest.fixture(params=[False, True], ids=["ssh", "pangea"])
def server(tmp_path, request):
    legacy = request.param
    public = tmp_path / "public" / "_gnosi-site"
    private = tmp_path / "private"
    for path in (public, private, private / "pending-releases", private / "service"):
        path.mkdir(parents=True, exist_ok=True)
    if legacy:
        for path in (public, private):
            (path / ".gnosi-owner").write_text("synthetic-owner")
    releases = (private if legacy else public) / "releases"
    releases.mkdir()
    (private / "manifests").mkdir()
    sentinel = private / "service" / "state.sqlite"
    sentinel.write_bytes(b"private user data must survive")

    class Server:
        def __init__(self):
            self.root, self.private, self.legacy = releases, private, legacy

        def php(self, bridge, code):
            return subprocess.run([shutil.which("php"), "-r", code], capture_output=True,
                                  text=True, check=True).stdout

        def release(self, name, *, pending=False):
            path = releases / name
            body = path / "public" if legacy else path
            body.mkdir(parents=True)
            (body / "index.html").write_text(name)
            manifest = {"index.html": hashlib.sha256(name.encode()).hexdigest()}
            manifest_path = path / "checksums.json" if legacy else private / "manifests" / (name + ".json")
            manifest_path.write_text(json.dumps(manifest))
            if pending:
                (private / "pending-releases" / name).write_text("uploading")

        def activate(self, name, parent, *, retain=True):
            if legacy:
                response = pangea._activate(self, None, str(public), str(private), name,
                                            parent, "synthetic-owner", retain=retain)
            else:
                response = self.php(None, runtime.activation_program(
                    str(public), str(private), name, parent, verify_manifest=True, retain=retain))
            assert sentinel.read_bytes() == b"private user data must survive"
            return json.loads(response)

        def current(self):
            return (public / "current").resolve().parent.name if legacy else (public / "current").resolve().name

        def versions(self):
            return {path.name for path in releases.iterdir()}

    return Server()


def test_successive_publications_keep_current_and_actual_predecessor_after_rollback(server):
    first, second, third, fourth = (letter * 32 for letter in "abcd")
    for name, parent in ((first, None), (second, first), (third, second)):
        server.release(name, pending=True)
        result = server.activate(name, parent)
        assert result["retention_error"] is None
        assert server.current() == name
        assert server.versions() == ({name, parent} if parent else {name})
        assert not (server.private / "pending-releases" / name).exists()
    server.activate(second, third, retain=False)
    server.release(fourth, pending=True)
    assert server.activate(fourth, second)["retention_error"] is None
    assert server.versions() == {second, fourth}
    if not server.legacy:
        assert {p.stem for p in (server.private / "manifests").iterdir()} == {second, fourth}


def test_pending_upload_is_not_deleted_and_can_publish_after_competing_activation(server):
    first, second, third, pending = (letter * 32 for letter in "abcd")
    server.release(first, pending=True)
    server.activate(first, None)
    server.release(second, pending=True)
    server.activate(second, first)
    server.release(pending, pending=True)
    server.release(third, pending=True)
    server.activate(third, second)
    assert server.versions() == {second, third, pending}
    assert (server.private / "pending-releases" / pending).is_file()
    server.activate(pending, third)
    assert server.versions() == {third, pending}


def test_previous_activated_upload_receipt_is_reconciled_before_later_pruning(server):
    first, second, third = (letter * 32 for letter in "abc")
    server.release(first, pending=True)
    server.activate(first, None)
    # A lost activation response may leave a receipt for an already active tree.
    (server.private / "pending-releases" / first).write_text("uploading")
    server.release(second, pending=True)
    server.activate(second, first)
    assert not (server.private / "pending-releases" / first).exists()
    server.release(third, pending=True)
    server.activate(third, second)
    assert server.versions() == {second, third}


@pytest.mark.parametrize("failure", ["parent", "integrity"])
def test_failed_activation_does_not_prune_existing_versions(server, failure):
    first, second, third = (letter * 32 for letter in "abc")
    server.release(first, pending=True)
    server.activate(first, None)
    server.release(second, pending=True)
    server.activate(second, first)
    server.release(third, pending=True)
    if failure == "integrity":
        body = server.root / third / "public" if server.legacy else server.root / third
        (body / "index.html").write_text("corrupt")
    with pytest.raises(subprocess.CalledProcessError):
        server.activate(third, first if failure == "parent" else second)
    assert server.current() == second
    assert server.versions() == {first, second, third}


@pytest.mark.parametrize("failure", ["symlink", "corruption"])
def test_unsafe_obsolete_tree_is_preserved_and_cleanup_warning_keeps_new_release_active(server, failure):
    first, second, third = (letter * 32 for letter in "abc")
    server.release(first, pending=True)
    server.activate(first, None)
    server.release(second, pending=True)
    server.activate(second, first)
    body = server.root / first / "public" if server.legacy else server.root / first
    if failure == "symlink":
        (body / "foreign").symlink_to(server.private / "service", target_is_directory=True)
    else:
        (body / "index.html").write_text("corrupt")
    server.release(third, pending=True)
    assert server.activate(third, second)["retention_error"] == "release_retention_pending"
    assert server.current() == third
    assert server.versions() == {first, second, third}


def test_unknown_incomplete_upload_is_never_swept_as_a_published_version(server):
    orphan = server.root / ("d" * 32)
    orphan.mkdir()
    (orphan / "upload.tar.gz").write_bytes(b"unknown incomplete data")
    first = "a" * 32
    server.release(first, pending=True)
    server.activate(first, None)
    assert (orphan / "upload.tar.gz").read_bytes() == b"unknown incomplete data"
