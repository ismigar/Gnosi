"""Exercise resumable release ownership and fail-closed cleanup with synthetic releases."""

import base64
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
from types import SimpleNamespace

import pytest

SPEC = importlib.util.spec_from_file_location(
    "release_session", Path(__file__).resolve().parents[1] / "scripts/release-session.py"
)
assert SPEC and SPEC.loader
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)

IDENTITY = {"commit": "a" * 40, "tree": "b" * 40, "locks": {"uv.lock": "c" * 64}}


@pytest.fixture
def session(tmp_path, monkeypatch):
    monkeypatch.setattr(release, "source_identity", lambda version: copy.deepcopy(IDENTITY))
    path = tmp_path / "release"
    release.initialize(path, "3.3.0", 0)
    return path, release.read(path / "session.json")


def ready(path, state):
    for group in release.GROUPS:
        directory = path / "scratch/groups" / group
        directory.mkdir()
        (directory / "installer.bin").write_bytes(group.encode())
        state["groups"][group] = release.inventory(directory)
    public = path / "scratch/public"
    public.mkdir()
    (public / "Gnosi.bin").write_bytes(b"synthetic installer")
    state["public"] = release.inventory(public)
    release.retain_json(path, state, "public-manifest.json", state["public"])
    state["assembled"] = True
    for group in release.GROUPS:
        for mode in ("fresh", "upgrade"):
            file = path / "evidence" / f"{group}-{mode}.txt"
            file.write_text("Actual synthetic installation evidence")
            receipt = path / "evidence" / f"{group}-{mode}" / "receipt.json"
            receipt.parent.mkdir()
            release.write(receipt, {"source": state["source"], "group": group, "mode": mode,
                                    "status": "passed", "artifacts": state["groups"][group],
                                    "evidence": [file.name]})
            state["acceptance"][f"{group}-{mode}"] = [{
                "kind": "proof", "path": file.relative_to(path).as_posix(), "bytes": file.stat().st_size,
                "sha256": release.digest(file),
            }, {
                "kind": "receipt", "path": receipt.relative_to(path).as_posix(),
                "bytes": receipt.stat().st_size, "sha256": release.digest(receipt),
            }]
    release.save(path, state)


def remote_documents(state):
    return {
        "releases/tags/v3.3.0": {
            "tag_name": "v3.3.0", "draft": False, "prerelease": False, "published_at": "2026-10-22",
            "assets": [{"name": Path(asset["path"]).name, "state": "uploaded", "size": asset["bytes"],
                        "digest": "sha256:" + asset["sha256"]} for asset in state["public"]],
        },
        "git/ref/tags/v3.3.0": {"object": {"type": "tag", "sha": "tag-object"}},
        "git/tags/tag-object": {"object": {"type": "commit", "sha": IDENTITY["commit"]}},
        "pulls/200": {"merged": True, "base": {"ref": "main"}, "merge_commit_sha": "merge",
                      "head": {"sha": "promotion-head", "repo": {"full_name": release.REPO}}},
        f"compare/{IDENTITY['commit']}...merge": {
            "merge_base_commit": {"sha": IDENTITY["commit"]},
            "files": [{"filename": "CHANGELOG.md", "status": "modified"},
                      {"filename": "frontend/src/features/control-center/releases/releases.json", "status": "modified"}],
        },
        "contents/frontend/src/features/control-center/releases/releases.json?ref=merge": {
            "content": base64.b64encode(json.dumps([{
                "version": "3.3.0", "channel": "stable",
                "downloadUrl": f"https://github.com/{release.REPO}/releases/tag/v3.3.0",
            }]).encode()).decode(),
        },
        "commits/promotion-head/check-runs?per_page=100": {"check_runs": [
            {"name": name, "conclusion": "success", "head_sha": "promotion-head",
             "app": {"slug": "github-actions"}} for name in release.CHECKS
        ]},
    }


def test_cleanup_preserves_evidence_external_files_and_supports_repeated_finalization(session, monkeypatch):
    path, state = session
    ready(path, state)
    external = path.parent / "personal-data.txt"
    external.write_text("Keep this")
    documents = remote_documents(state)
    requests = []

    def github(endpoint):
        requests.append(endpoint)
        return copy.deepcopy(documents[endpoint])

    monkeypatch.setattr(release, "github", github)
    with release.session(path) as (root, current):
        release.finalize(root, current, 200)
    assert not (path / "scratch").exists()
    assert external.read_text() == "Keep this"
    assert len(list((path / "evidence").glob("*.txt"))) == 8
    assert release.read(path / "session.json")["cleaned"]
    with release.session(path) as (root, current):
        release.finalize(root, current, 200)
    assert requests.count("releases/tags/v3.3.0") == 2
    assert len(list((path / "evidence").glob("publication-*.json"))) == 2


@pytest.mark.parametrize("failure", [
    "draft", "prerelease", "missing-asset", "extra-asset", "wrong-digest", "wrong-size",
    "tag-moved", "unmerged", "foreign-pr", "source-changed", "wrong-ancestor",
    "wrong-catalog", "failed-check", "missing-check", "foreign-check", "wrong-check-sha",
    "renamed-source", "deleted-metadata", "added-metadata",
])
def test_remote_failure_never_deletes_scratch(session, monkeypatch, failure):
    path, state = session
    ready(path, state)
    documents = remote_documents(state)
    public = documents["releases/tags/v3.3.0"]
    pr = documents["pulls/200"]
    compare = documents[f"compare/{IDENTITY['commit']}...merge"]
    checks = documents["commits/promotion-head/check-runs?per_page=100"]["check_runs"]
    if failure in {"draft", "prerelease"}:
        public[failure] = True
    elif failure == "missing-asset":
        public["assets"] = []
    elif failure == "extra-asset":
        public["assets"].append({"name": "unexpected"})
    elif failure == "wrong-digest":
        public["assets"][0]["digest"] = "sha256:wrong"
    elif failure == "wrong-size":
        public["assets"][0]["size"] += 1
    elif failure == "tag-moved":
        documents["git/tags/tag-object"]["object"]["sha"] = "elsewhere"
    elif failure == "unmerged":
        pr["merged"] = False
    elif failure == "foreign-pr":
        pr["head"]["repo"]["full_name"] = "someone/fork"
    elif failure == "source-changed":
        compare["files"].append({"filename": "backend/server.py"})
    elif failure == "wrong-ancestor":
        compare["merge_base_commit"]["sha"] = "older-source"
    elif failure == "wrong-catalog":
        documents["contents/frontend/src/features/control-center/releases/releases.json?ref=merge"][
            "content"] = base64.b64encode(b"[]").decode()
    elif failure == "failed-check":
        checks[0]["conclusion"] = "failure"
    elif failure == "missing-check":
        checks.pop()
    elif failure == "foreign-check":
        checks[0]["app"]["slug"] = "external-app"
    elif failure == "wrong-check-sha":
        checks[0]["head_sha"] = "old-sha"
    elif failure == "renamed-source":
        compare["files"][0].update(status="renamed", previous_filename="backend/server.py")
    elif failure == "deleted-metadata":
        compare["files"][0]["status"] = "removed"
    elif failure == "added-metadata":
        compare["files"][0]["status"] = "added"
    monkeypatch.setattr(release, "github", lambda endpoint: copy.deepcopy(documents[endpoint]))
    with pytest.raises(ValueError):
        release.finalize(path, state, 200)
    assert (path / "scratch/public/Gnosi.bin").read_bytes() == b"synthetic installer"
    assert not state["cleaned"]


@pytest.mark.parametrize("failure", ["missing-acceptance", "changed-evidence", "changed-group",
                                     "changed-public", "extra-scratch", "extra-group", "symlink", "interrupted",
                                     "missing-receipt", "changed-receipt", "empty-public-dir", "empty-group-dir",
                                     "missing-manifest", "changed-manifest", "missing-ci", "changed-publication",
                                     "internal-evidence-symlink"])
def test_local_failure_preserves_scratch(session, monkeypatch, failure):
    path, state = session
    ready(path, state)
    documents = remote_documents(state)
    monkeypatch.setattr(release, "github", lambda endpoint: copy.deepcopy(documents[endpoint]))
    if failure == "missing-acceptance":
        state["acceptance"].pop(next(iter(state["acceptance"])))
    elif failure == "changed-evidence":
        (path / "evidence/macos-arm64-fresh.txt").write_text("Changed")
    elif failure == "changed-group":
        (path / "scratch/groups/macos-arm64/installer.bin").write_text("Changed")
    elif failure == "changed-public":
        (path / "scratch/public/Gnosi.bin").write_text("Changed")
    elif failure == "extra-scratch":
        (path / "scratch/notes.txt").write_text("Do not infer this is disposable")
    elif failure == "extra-group":
        (path / "scratch/groups/personal-notes").mkdir()
    elif failure == "symlink":
        (path / "scratch/public/link").symlink_to(path / "evidence/macos-arm64-fresh.txt")
    elif failure == "interrupted":
        state["cleanup_started"] = True
    elif failure == "missing-receipt":
        (path / "evidence/macos-arm64-fresh/receipt.json").unlink()
    elif failure == "changed-receipt":
        (path / "evidence/macos-arm64-fresh/receipt.json").write_text('{"status":"failed"}')
    elif failure == "empty-public-dir":
        (path / "scratch/public/unrecognized-mountpoint").mkdir()
    elif failure == "empty-group-dir":
        (path / "scratch/groups/macos-arm64/unrecognized-mountpoint").mkdir()
    elif failure == "missing-manifest":
        (path / "evidence/public-manifest.json").unlink()
    elif failure == "changed-manifest":
        (path / "evidence/public-manifest.json").write_text("[]")
    elif failure == "missing-ci":
        release.retain_json(path, state, "source-ci-100.json", {"run": "synthetic"})
        (path / "evidence/source-ci-100.json").unlink()
    elif failure == "changed-publication":
        release.retain_json(path, state, "published-release.json", {"id": "synthetic"})
        (path / "evidence/published-release.json").write_text("{}")
    elif failure == "internal-evidence-symlink":
        receipt_dir = path / "evidence/macos-arm64-fresh"
        relocated = path / "evidence/relocated-receipt"
        receipt_dir.rename(relocated)
        receipt_dir.symlink_to(relocated, target_is_directory=True)
    with pytest.raises(ValueError):
        release.finalize(path, state, 200)
    assert (path / "scratch").is_dir()


def test_import_reuses_identical_group_without_rewriting_and_rejects_changed_bytes(session, monkeypatch):
    path, state = session
    source = path.parent / "builder-output"
    source.mkdir()
    original = source / "Gnosi.dmg"
    original.write_bytes(b"verified fixture")
    monkeypatch.setattr(release, "command", lambda *args, **kwargs: "")
    release.import_group(path, state, "macos-arm64", source)
    imported = path / "scratch/groups/macos-arm64/Gnosi.dmg"
    before = imported.stat().st_mtime_ns
    release.import_group(path, state, "macos-arm64", source)
    assert imported.stat().st_mtime_ns == before
    assert original.stat().st_ino != imported.stat().st_ino
    original.write_bytes(b"different fixture")
    with pytest.raises(ValueError, match="changed"):
        release.import_group(path, state, "macos-arm64", source)
    assert imported.read_bytes() == b"verified fixture"


def test_import_rejects_destination_parent_symlink_before_any_external_write(session, monkeypatch):
    path, _ = session
    source = path.parent / "builder"
    source.mkdir()
    (source / "installer.bin").write_bytes(b"Synthetic installer")
    external = path.parent / "preserved-builds"
    external.mkdir()
    (path / "scratch/groups").rmdir()
    (path / "scratch/groups").symlink_to(external, target_is_directory=True)
    monkeypatch.setattr(release, "command", lambda *args, **kwargs: "")
    with release.session(path) as (root, current):
        with pytest.raises(ValueError, match="Symlink"):
            release.import_group(root, current, "macos-arm64", source)
        assert current["groups"] == {}
    assert list(external.iterdir()) == []
    assert (source / "installer.bin").read_bytes() == b"Synthetic installer"


def test_cleanup_rechecks_ownership_after_remote_verification(session, monkeypatch):
    path, state = session
    ready(path, state)
    documents = remote_documents(state)

    def github(endpoint):
        if endpoint.startswith("commits/"):
            (path / "scratch/.release-owner").write_text("changed-owner")
        return copy.deepcopy(documents[endpoint])

    monkeypatch.setattr(release, "github", github)
    with pytest.raises(ValueError, match="ownership"):
        release.finalize(path, state, 200)
    assert (path / "scratch/public/Gnosi.bin").exists()


def test_session_refuses_existing_directories_source_changes_and_replaced_ownership(session, monkeypatch):
    path, state = session
    with pytest.raises(ValueError, match="already exists"):
        release.initialize(path, "3.3.0", 0)
    (path / "scratch/.release-owner").write_text("not-our-session")
    with pytest.raises(ValueError, match="ownership"):
        with release.session(path):
            pytest.fail("unsafe session opened")
    assert not (path / ".session-lock").exists()
    monkeypatch.setattr(release, "source_identity", lambda version: {"commit": "different"})
    with pytest.raises(ValueError, match="source or locks changed"):
        with release.session(path):
            pytest.fail("changed source opened")


def test_busy_session_does_not_remove_another_process_lock(session):
    path, _ = session
    (path / ".session-lock").mkdir()
    with pytest.raises(ValueError, match="busy"):
        with release.session(path):
            pytest.fail("busy session opened")
    assert (path / ".session-lock").is_dir()


@pytest.mark.parametrize("kind", ["file", "dangling-symlink"])
def test_generated_receipt_never_overwrites_unregistered_evidence(session, kind):
    path, state = session
    existing = path / "evidence/source-ci-100.json"
    if kind == "file":
        existing.write_text("Operator notes to preserve")
    else:
        existing.symlink_to(path.parent / "absent-target")
    with pytest.raises(ValueError, match="Unregistered evidence|Symlink"):
        release.retain_json(path, state, existing.name, {"run": 100})
    if kind == "file":
        assert existing.read_text() == "Operator notes to preserve"
    else:
        assert existing.is_symlink()


def test_session_symlink_parent_and_evidence_links_are_rejected(session):
    path, _ = session
    link = path.parent / "alias"
    link.symlink_to(path, target_is_directory=True)
    with pytest.raises(ValueError, match="Symlink"):
        with release.session(link):
            pytest.fail("symlink session opened")
    (path / "evidence").rmdir()
    (path / "evidence").symlink_to(path.parent, target_is_directory=True)
    with pytest.raises(ValueError, match="Symlink"):
        with release.session(path):
            pytest.fail("symlink evidence opened")


def test_low_space_does_not_create_session_or_run_toolchain(tmp_path, monkeypatch):
    monkeypatch.setattr(release, "source_identity", lambda version: copy.deepcopy(IDENTITY))
    monkeypatch.setattr(release.shutil, "disk_usage", lambda path: SimpleNamespace(free=1))
    with pytest.raises(ValueError, match="24 GiB"):
        release.initialize(tmp_path / "new-release", "3.3.0", 24)
    assert not (tmp_path / "new-release").exists()
    monkeypatch.setattr(release, "command", lambda *args, **kwargs: pytest.fail("unexpected command"))
    with pytest.raises(ValueError, match="24 GiB"):
        release.doctor(24, signing=True)


def test_acceptance_copies_proofs_outside_scratch_and_requires_current_source(session):
    path, state = session
    ready(path, state)
    state["acceptance"] = {}
    shutil.rmtree(path / "evidence/macos-arm64-fresh")
    proof = path.parent / "ui-proof.txt"
    proof.write_text("Saved and reopened a synthetic note")
    receipt = path.parent / "receipt.json"
    document = {"source": IDENTITY, "group": "macos-arm64", "mode": "fresh", "status": "passed",
                "artifacts": state["groups"]["macos-arm64"], "evidence": [proof.name]}
    release.write(receipt, {**document, "source": {"commit": "older-source"}})
    with pytest.raises(ValueError, match="bind"):
        release.acceptance(path, state, "macos-arm64", "fresh", receipt)
    release.write(receipt, document)
    release.acceptance(path, state, "macos-arm64", "fresh", receipt)
    proof.unlink()
    retained = path / state["acceptance"]["macos-arm64-fresh"][0]["path"]
    assert retained.read_text() == "Saved and reopened a synthetic note"
    with pytest.raises(ValueError, match="already exists"):
        release.acceptance(path, state, "macos-arm64", "fresh", receipt)


@pytest.mark.parametrize("alias", ["receipt-leaf", "receipt-parent", "proof-parent",
                                  "proof-parent-traversal", "receipt-parent-traversal"])
def test_acceptance_rejects_input_symlinks_before_creating_destination(session, alias):
    path, state = session
    ready(path, state)
    state["acceptance"] = {}
    destination = path / "evidence/macos-arm64-fresh"
    shutil.rmtree(destination)
    inputs = path.parent / "inputs"
    inputs.mkdir()
    proof = inputs / "proof.txt"
    proof.write_text("Installation proof")
    receipt = inputs / "receipt.json"
    document = {"source": IDENTITY, "group": "macos-arm64", "mode": "fresh", "status": "passed",
                "artifacts": state["groups"]["macos-arm64"], "evidence": [proof.name]}
    if alias == "receipt-leaf":
        release.write(inputs / "real.json", document)
        receipt.symlink_to(inputs / "real.json")
    elif alias == "receipt-parent":
        release.write(receipt, document)
        alias_dir = path.parent / "receipt-alias"
        alias_dir.symlink_to(inputs, target_is_directory=True)
        receipt = alias_dir / "receipt.json"
    elif alias == "proof-parent":
        (inputs / "proof-alias").symlink_to(inputs, target_is_directory=True)
        release.write(receipt, {**document, "evidence": ["proof-alias/proof.txt"]})
    else:
        outside = path.parent / "outside"
        (outside / "nested").mkdir(parents=True)
        (outside / "proof.txt").write_text("Unintended proof")
        release.write(outside / "receipt.json", document)
        (inputs / "alias").symlink_to(outside / "nested", target_is_directory=True)
        if alias == "proof-parent-traversal":
            release.write(receipt, {**document, "evidence": ["alias/../proof.txt"]})
        else:
            receipt = inputs / "alias/../receipt.json"
    with pytest.raises(ValueError, match="unsafe|Symlink"):
        release.acceptance(path, state, "macos-arm64", "fresh", receipt)
    assert not destination.exists()
    assert proof.read_text() == "Installation proof"


def test_assembly_missing_key_or_architecture_never_creates_candidate(session, monkeypatch):
    path, state = session
    with pytest.raises(ValueError, match="four architecture"):
        release.assemble(path, state)
    ready(path, state)
    state["assembled"] = False
    shutil = release.shutil
    shutil.rmtree(path / "scratch/public")

    def failed_signer(*args, **kwargs):
        raise ValueError("missing official signing key")

    monkeypatch.setattr(release, "command", failed_signer)
    with pytest.raises(ValueError, match="signing key"):
        release.assemble(path, state)
    assert not (path / "scratch/public").exists()


@pytest.mark.parametrize("existing", ["absent", "partial-draft", "complete-public"])
def test_publication_resumes_upload_without_overwriting_and_keeps_scratch(session, monkeypatch, existing):
    path, state = session
    ready(path, state)
    (path / "scratch/public/release-notes.md").write_text("Release notes")
    state["assembled"] = False
    state["public"] = release.inventory(path / "scratch/public")
    release.retain_json(path, state, "public-manifest.json", state["public"])
    state["assembled"] = True
    documents = remote_documents(state)
    remote = documents["releases/tags/v3.3.0"]
    remote["body"] = "Release notes"
    expected = copy.deepcopy(remote["assets"])
    remote["draft"] = existing != "complete-public"
    if existing == "partial-draft":
        remote["assets"] = remote["assets"][:1]
    elif existing == "absent":
        remote["assets"] = []
    documents["releases?per_page=100"] = [] if existing == "absent" else [remote]
    documents["actions/runs/100"] = {
        "head_sha": IDENTITY["commit"], "conclusion": "success", "path": ".github/workflows/ci.yml",
        "repository": {"full_name": release.REPO},
    }
    documents["actions/runs/100/jobs?per_page=100"] = {"jobs": [
        {"name": name, "conclusion": "success"} for name in release.CHECKS
    ]}
    monkeypatch.setattr(release, "github", lambda endpoint: copy.deepcopy(documents[endpoint]))
    calls = []

    def command(*args, **kwargs):
        calls.append(args)
        assert args[:2] == ("gh", "release")
        if args[2] == "upload":
            assert "--clobber" not in args
            name = Path(args[4]).name
            assert name not in {item["name"] for item in remote["assets"]}
            remote["assets"] += [item for item in expected if item["name"] == name]
        elif args[2] == "edit":
            remote["draft"] = False
            remote["published_at"] = "2026-10-22"
        return ""

    monkeypatch.setattr(release, "command", command)
    release.publish(path, state, 100)
    assert not remote["draft"]
    assert (path / "scratch").exists()
    assert release.read(path / "evidence/published-release.json")["assets"] == remote["assets"]
    if existing == "complete-public":
        assert calls == []
    else:
        assert calls[-1][2] == "edit"
        assert sum(call[2] == "upload" for call in calls) == (2 if existing == "absent" else 1)


@pytest.mark.parametrize("failure", ["failed-ci", "wrong-source", "missing-job", "draft-conflict",
                                     "wrong-notes", "missing-proof"])
def test_publication_failure_never_changes_github(session, monkeypatch, failure):
    path, state = session
    ready(path, state)
    (path / "scratch/public/release-notes.md").write_text("Release notes")
    state["assembled"] = False
    state["public"] = release.inventory(path / "scratch/public")
    release.retain_json(path, state, "public-manifest.json", state["public"])
    state["assembled"] = True
    documents = remote_documents(state)
    remote = documents["releases/tags/v3.3.0"]
    remote.update(draft=True, body="Release notes")
    documents["releases?per_page=100"] = [remote]
    documents["actions/runs/100"] = {
        "head_sha": IDENTITY["commit"], "conclusion": "success", "path": ".github/workflows/ci.yml",
        "repository": {"full_name": release.REPO},
    }
    documents["actions/runs/100/jobs?per_page=100"] = {"jobs": [
        {"name": name, "conclusion": "success"} for name in release.CHECKS
    ]}
    if failure == "failed-ci":
        documents["actions/runs/100"]["conclusion"] = "failure"
    elif failure == "wrong-source":
        documents["actions/runs/100"]["head_sha"] = "older-source"
    elif failure == "missing-job":
        documents["actions/runs/100/jobs?per_page=100"]["jobs"].pop()
    elif failure == "draft-conflict":
        remote["assets"][0]["digest"] = "sha256:wrong"
    elif failure == "wrong-notes":
        remote["body"] = "Different release"
    elif failure == "missing-proof":
        state["acceptance"].clear()
    monkeypatch.setattr(release, "github", lambda endpoint: copy.deepcopy(documents[endpoint]))
    monkeypatch.setattr(release, "command", lambda *args, **kwargs: pytest.fail("unexpected mutation"))
    with pytest.raises(ValueError):
        release.publish(path, state, 100)
    assert (path / "scratch/public/Gnosi.bin").exists()


def test_actual_collection_signing_and_assembly_in_disposable_tagged_repository(tmp_path, monkeypatch):
    """Run the real composed tools offline with synthetic binaries and test-only keys."""
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    original = release.ROOT
    root = tmp_path / "source"
    root.mkdir()
    archive = subprocess.check_output(["git", "archive", "HEAD"], cwd=original)
    with tarfile.open(fileobj=io.BytesIO(archive)) as source:
        source.extractall(root, filter="data")
    shutil.copyfile(original / "desktop/scripts/release-session.py", root / "desktop/scripts/release-session.py")
    (root / "desktop/node_modules").symlink_to(original / "desktop/node_modules", target_is_directory=True)
    (root / ".venv").symlink_to(Path(sys.executable).parent.parent, target_is_directory=True)
    plugin = Ed25519PrivateKey.generate()
    sparkle = Ed25519PrivateKey.generate()
    plugin_public = base64.b64encode(plugin.public_key().public_bytes_raw()).decode()
    sparkle_public = base64.b64encode(sparkle.public_key().public_bytes_raw()).decode()
    (root / "backend/security/plugin_trust_root.py").write_text(
        f'OFFICIAL_PLUGIN_PUBLIC_KEY_B64 = "{plugin_public}"\n'
    )
    (root / "desktop/sparkle-config.json").write_text(json.dumps({"publicKey": sparkle_public}))
    catalog_path = root / "frontend/src/features/control-center/releases/releases.json"
    catalog = json.loads(catalog_path.read_text())
    catalog[0]["channel"] = "prerelease"
    catalog[0].pop("downloadUrl", None)
    catalog_path.write_text(json.dumps(catalog, indent=2))
    env = {**os.environ, "GNOSI_PLUGIN_SIGNING_KEY": base64.b64encode(plugin.private_bytes_raw()).decode(),
           "SYNTHETIC_SPARKLE_KEY": base64.b64encode(sparkle.private_bytes_raw()).decode()}
    # uv must use this test invocation's installed interpreter, never download dependencies.
    env["UV_PROJECT_ENVIRONMENT"] = str(Path(sys.executable).parent.parent)
    env["UV_CACHE_DIR"] = str(tmp_path / "uv-cache")
    env["UV_OFFLINE"] = "1"
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    for args in (("init", "-q"), ("add", "."),
                 ("-c", "user.name=Release Test", "-c", "user.email=release@example.invalid",
                  "-c", "commit.gpgsign=false", "commit", "-qm", "Synthetic tagged source"),
                 ("tag", "v3.2.0")):
        subprocess.run(["git", *args], cwd=root, check=True, capture_output=True)
    incoming = tmp_path / "incoming"
    subprocess.run(["node", "-e", r'''
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {generateFeed} = require('./desktop/scripts/sparkle-appcast.cjs');
const base = process.argv[1]; fs.mkdirSync(base);
const key = crypto.createPrivateKey({key: Buffer.concat([
  Buffer.from('302e020100300506032b657004220420', 'hex'),
  Buffer.from(process.env.SYNTHETIC_SPARKLE_KEY, 'base64')]), format: 'der', type: 'pkcs8'});
const groups = {'macos-arm64': ['latest-mac.yml', 'arm64.zip', 'arm64.dmg'],
  'macos-x64': ['latest-mac.yml', 'x64.zip', 'x64.dmg'],
  'linux-arm64': ['latest-linux-arm64.yml', 'arm64.AppImage', 'arm64.deb'],
  'windows-x64': ['latest.yml', 'Setup.exe']};
(async () => {
  for (const [group, [channel, ...suffixes]] of Object.entries(groups)) {
    const directory = path.join(base, group); fs.mkdirSync(directory);
    const files = suffixes.map(suffix => {
      const url = `Gnosi-3.2.0-${suffix}`, bytes = Buffer.from(`Synthetic ${url}`);
      fs.writeFileSync(path.join(directory, url), bytes);
      return {url, size: bytes.length, sha512: crypto.createHash('sha512').update(bytes).digest('base64')};
    });
    fs.writeFileSync(path.join(directory, channel), JSON.stringify({version: '3.2.0',
      files, path: files[0].url, sha512: files[0].sha512, releaseDate: '2026-10-21T00:00:00Z'}));
    if (group.startsWith('macos-')) await generateFeed(path.join(directory, files[0].url), {
      sign: args => {
        const file = args.at(-1), bytes = fs.readFileSync(file);
        const signature = crypto.sign(null, bytes, key).toString('base64');
        if (args[0] === '-p') return signature;
        fs.appendFileSync(file, `<!-- sparkle-signatures:\nedSignature: ${signature}\nlength: ${bytes.length}\n-->\n`);
        return '';
      }
    });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
''', str(incoming)], cwd=root, env=env, check=True, capture_output=True, text=True)
    monkeypatch.setattr(release, "ROOT", root)
    directory = tmp_path / "session"
    release.initialize(directory, "3.2.0", 0)
    with release.session(directory) as (path, state):
        for group in release.GROUPS:
            release.import_group(path, state, group, incoming / group)
        release.assemble(path, state)
        manifest = copy.deepcopy(state["public"])
        assert any(item["path"] == "plugins/plugins-index.sig" for item in manifest)
        assert any(item["path"] == "vault-templates/vault-templates-index.sig" for item in manifest)
        assert "_2026-10-21 · Stable_" in (path / "scratch/public/release-notes.md").read_text()
        assert json.loads(catalog_path.read_text())[0]["channel"] == "prerelease"
        release.assemble(path, state)
        assert state["public"] == manifest
        assert (path / "evidence/public-manifest.json").is_file()
    assert all((incoming / group).is_dir() for group in release.GROUPS)
