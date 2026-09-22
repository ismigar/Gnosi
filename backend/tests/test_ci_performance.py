"""Cache damage must trigger clean installs; docs-only routing must fail open."""
from __future__ import annotations

import base64
import hashlib
import io
from pathlib import Path
import subprocess
import tarfile

import pytest

from scripts.ci import classify_changes, python_cache
from scripts.ci.prepare_analysis_cache import prepare


def wheel(cache: Path) -> Path:
    root = cache / "archive-v0" / "fixture"
    info = root / "fixture-1.dist-info"
    info.mkdir(parents=True)
    payload = root / "fixture.py"
    payload.write_bytes(b"complete-package")
    checksum = base64.urlsafe_b64encode(hashlib.sha256(payload.read_bytes()).digest()).rstrip(b"=").decode()
    (info / "RECORD").write_text(f"fixture.py,sha256={checksum},16\nfixture-1.dist-info/RECORD,,\n")
    return payload


def test_sealed_snapshot_restores_independent_verified_files(tmp_path: Path) -> None:
    source, destination = tmp_path / "source", tmp_path / "destination"
    original = wheel(source)
    snapshot = tmp_path / "packages.tar.gz"
    python_cache.save(snapshot, source)
    original.write_text("damaged mutable cache")
    assert python_cache.restore(snapshot, destination)
    assert (destination / "archive-v0/fixture/fixture.py").read_bytes() == b"complete-package"


@pytest.mark.parametrize("damage", ["missing", "changed", "record"])
def test_partial_packages_are_never_sealed(tmp_path: Path, damage: str) -> None:
    payload = wheel(tmp_path / "cache")
    if damage == "missing":
        payload.unlink()
    elif damage == "changed":
        payload.write_text("corrupt")
    else:
        (payload.parent / "fixture-1.dist-info/RECORD").unlink()
    with pytest.raises(ValueError):
        python_cache.save(tmp_path / "snapshot.tar.gz", tmp_path / "cache")
    assert not (tmp_path / "snapshot.tar.gz").exists()


def test_corrupt_snapshot_is_a_cold_miss(tmp_path: Path) -> None:
    wheel(tmp_path / "source")
    snapshot = tmp_path / "snapshot.tar.gz"
    python_cache.save(snapshot, tmp_path / "source")
    snapshot.write_bytes(b"truncated")
    assert not python_cache.restore(snapshot, tmp_path / "destination")
    assert not (tmp_path / "destination").exists()


def test_even_checksummed_archive_cannot_escape_destination(tmp_path: Path) -> None:
    snapshot = tmp_path / "snapshot.tar.gz"
    with tarfile.open(snapshot, "w:gz") as archive:
        member = tarfile.TarInfo("../outside")
        member.size = 1
        archive.addfile(member, io.BytesIO(b"x"))
    snapshot.with_suffix(".sha256").write_text(python_cache.digest(snapshot))
    assert not python_cache.restore(snapshot, tmp_path / "destination")
    assert not (tmp_path / "outside").exists()


def test_restore_does_not_remove_an_existing_destination(tmp_path: Path) -> None:
    source = tmp_path / "source"
    wheel(source)
    snapshot = tmp_path / "snapshot.tar.gz"
    python_cache.save(snapshot, source)
    assert not python_cache.restore(snapshot, source)
    assert (source / "archive-v0/fixture/fixture.py").exists()


def test_analyzer_cache_is_reused_until_tools_change(tmp_path: Path) -> None:
    project = tmp_path / "project"
    project.mkdir()
    (project / "uv.lock").write_text("version one")
    environment = {"RUNNER_TOOL_CACHE": str(tmp_path)}
    first = prepare(environment, project)
    Path(first["GNOSI_ESLINT_CACHE"]).write_text("cached analysis")
    assert prepare(environment, project) == first
    (project / "uv.lock").write_text("version two")
    assert prepare(environment, project) != first


@pytest.fixture
def trusted() -> dict[str, str]:
    return {"CI_EVENT": "pull_request", "GITHUB_REPOSITORY": "owner/repo",
            "CI_HEAD_REPOSITORY": "owner/repo", "CI_BASE_SHA": "a" * 40, "CI_HEAD_SHA": "b" * 40}


@pytest.mark.parametrize("paths,required", [
    (["docs/engineering/domains/ai-agent.md", "docs/engineering-ca/generated/tests.md"], False),
    (["docs/engineering/a.md", "backend/a.py"], True),
    (["docs/user-guide.md"], True),
    (["docs/engineering/a.js"], True),
    (["frontend/src/a.ts"], True),
    ([".github/workflows/ci.yml"], True),
    (["scripts/ci/classify_changes.py"], True),
    (["uv.lock"], True),
    (["docs/engineering/../code.md"], True),
    ([], True),
])
def test_only_portal_prose_omits_runtime_checks(monkeypatch, trusted, paths, required):
    def changed(command, **_kwargs):
        assert "--no-renames" in command
        assert command[-1] == "--"
        return "\0".join(paths).encode()
    monkeypatch.setattr(subprocess, "check_output", changed)
    assert classify_changes.runtime_required(trusted) is required


@pytest.mark.parametrize("field,value", [
    ("CI_EVENT", "push"), ("CI_RELEASE_CANDIDATE", "true"),
    ("CI_HEAD_REPOSITORY", "fork/repo"), ("CI_HEAD_SHA", "--unsafe"), ("CI_BASE_SHA", ""),
])
def test_release_push_and_unknown_inputs_keep_full_validation(trusted, field, value):
    assert classify_changes.runtime_required({**trusted, field: value})


def test_git_failure_keeps_full_validation(monkeypatch, trusted):
    def unavailable(*_args, **_kwargs):
        raise subprocess.CalledProcessError(128, "git")
    monkeypatch.setattr(subprocess, "check_output", unavailable)
    assert classify_changes.runtime_required(trusted)


def test_snapshot_key_tracks_platform_uv_lock_and_scope(tmp_path, monkeypatch):
    (tmp_path / "uv.lock").write_text("lock one")
    (tmp_path / "pyproject.toml").write_text("project")
    environment = {"RUNNER_TOOL_CACHE": str(tmp_path), "GITHUB_JOB": "backend"}
    monkeypatch.setattr(subprocess, "check_output", lambda *_args, **_kwargs: "uv 0.10.0")
    first = python_cache.snapshot_path(environment, tmp_path)
    assert python_cache.snapshot_path({**environment, "GITHUB_JOB": "native-smoke"}, tmp_path) == first
    assert python_cache.snapshot_path({**environment, "GITHUB_JOB": "documentation"}, tmp_path) != first
    (tmp_path / "uv.lock").write_text("lock two")
    second = python_cache.snapshot_path(environment, tmp_path)
    assert second != first
    monkeypatch.setattr(python_cache.platform, "machine", lambda: "other-architecture")
    third = python_cache.snapshot_path(environment, tmp_path)
    assert third != second
    monkeypatch.setattr(subprocess, "check_output", lambda *_args, **_kwargs: "uv 0.11.0")
    assert python_cache.snapshot_path(environment, tmp_path) != third


def test_snapshot_store_prunes_oldest_without_removing_current(tmp_path, monkeypatch):
    monkeypatch.setattr(python_cache, "MAX_STORE_BYTES", 5)
    old, current = tmp_path / "old.tar.gz", tmp_path / "current.tar.gz"
    for path in (old, current):
        path.write_bytes(b"1234")
        path.with_suffix(".sha256").write_text("checksum")
    python_cache.prune(current)
    assert current.exists()
    assert not old.exists()
    assert not old.with_suffix(".sha256").exists()


def test_real_git_diff_keeps_runtime_when_code_is_moved_into_docs(tmp_path, monkeypatch, trusted):
    monkeypatch.chdir(tmp_path)
    def git(*arguments):
        return subprocess.check_output(["git", *arguments], text=True).strip()
    git("init", "-q")
    git("config", "user.email", "fixture@example.invalid")
    git("config", "user.name", "CI fixture")
    (tmp_path / "code.py").write_text("important runtime code")
    git("add", ".")
    git("commit", "-qm", "base")
    base = git("rev-parse", "HEAD")
    portal = tmp_path / "docs/engineering"
    portal.mkdir(parents=True)
    (portal / "guide.md").write_text("documentation")
    git("add", ".")
    git("commit", "-qm", "docs only")
    environment = {**trusted, "CI_BASE_SHA": base, "CI_HEAD_SHA": git("rev-parse", "HEAD")}
    assert not classify_changes.runtime_required(environment)
    (tmp_path / "code.py").rename(portal / "moved.md")
    git("add", "-A")
    git("commit", "-qm", "move runtime source")
    assert classify_changes.runtime_required({**environment, "CI_HEAD_SHA": git("rev-parse", "HEAD")})


def test_docker_can_release_optional_snapshots_without_touching_other_data(tmp_path, monkeypatch):
    from scripts.ci import prepare_docker_runner as docker
    store = tmp_path / "gnosi-sealed-uv-v1"
    store.mkdir()
    archive = store / "snapshot.tar.gz"
    archive.write_bytes(b"regenerable")
    archive.with_suffix(".sha256").write_text("checksum")
    unrelated = tmp_path / "other-cache.tar.gz"
    unrelated.write_bytes(b"preserve")
    monkeypatch.setattr(docker, "_free_bytes", lambda _path: 0 if archive.exists() else 100)
    docker._release_optional_snapshots({"RUNNER_TOOL_CACHE": str(tmp_path)}, tmp_path, 100)
    assert not archive.exists()
    assert not archive.with_suffix(".sha256").exists()
    assert unrelated.read_bytes() == b"preserve"



def test_typed_lint_invalidates_dependents_but_preserves_mypy(tmp_path):
    project = tmp_path / "project"
    project.mkdir()
    subprocess.run(["git", "init", "-q", str(project)], check=True)
    source = project / "frontend/src"
    source.mkdir(parents=True)
    dependency = source / "types.ts"
    dependency.write_text("export type Value = string")
    environment = {"RUNNER_TOOL_CACHE": str(tmp_path)}
    paths = prepare(environment, project)
    cache = Path(paths["GNOSI_ESLINT_CACHE"])
    cache.write_text("typed result")
    mypy = Path(paths["MYPY_CACHE_DIR"])
    mypy.mkdir()
    (mypy / "result").write_text("incremental result")
    prepare(environment, project)
    assert cache.read_text() == "typed result"
    dependency.write_text("export type Value = number")
    prepare(environment, project)
    assert not cache.exists()
    assert (mypy / "result").read_text() == "incremental result"
    cache.write_text("typed result")
    external = project / "desktop"
    external.mkdir()
    (external / "help-links.json").write_text('{"shared": "typed data"}')
    prepare(environment, project)
    assert not cache.exists()
