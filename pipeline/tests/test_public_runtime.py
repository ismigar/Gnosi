"""Public runtime checks use index-only fixtures, never installed host tools."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

from scripts.check_public_runtime import (
    RETIRED_NAMES,
    IndexedRuntimeFile,
    indexed_files,
    violations,
)

ROOT = Path(__file__).resolve().parents[2]


def git(root: Path, *args: str) -> bytes:
    return subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True).stdout


def stage(root: Path, name: str, data: bytes = b"never execute source\n") -> Path:
    target = root / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    git(root, "add", "-f", "--", name)
    return target


def invoke(root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(ROOT / "scripts/check_public_runtime.py"), "--repository", str(root)],
        capture_output=True,
        text=True,
        check=False,
    )


@pytest.fixture
def repository(tmp_path: Path) -> Path:
    git(tmp_path, "init", "-q")
    return tmp_path


@pytest.mark.parametrize("name", sorted(RETIRED_NAMES))
def test_each_retired_operation_is_rejected_even_in_subdirectory(name: str) -> None:
    for prefix in ("scripts/runtime/", "scripts/runtime/legacy/"):
        issues = violations([IndexedRuntimeFile("100755", prefix + name)])
        assert len(issues) == 1
        assert "retired operation" in issues[0]


def test_reviewed_retirement_inventory_is_complete() -> None:
    assert RETIRED_NAMES == {
        "native_watchdog.sh",
        "install_native_watchdog.sh",
        "docker_watchdog.sh",
        "install_docker_watchdog.sh",
        "install_native_startup.sh",
        "install_startup.sh",
        "install_cron.sh",
        "run_pipeline_scheduled.sh",
        "gnosi_boot.sh",
        "fix_docker_grpcfuse.sh",
        "onedrive_warmup_daemon.py",
        "start_warmup_daemon.sh",
        "install_warmup_daemon.sh",
        "install_warmup_loginitem.sh",
        "cleanup_onedrive_warmup.sh",
        "run_brain.sh",
        "run_prod.sh",
    }


@pytest.mark.parametrize(
    "name",
    [
        "run_native_dev.sh",
        "run_native_frontend.sh",
        "find_connections.sh",
        "build-zotero-reader.sh",
        "setup-https-dev.sh",
        ".env.example",
        ".env.template",
        "new-portable-wrapper.sh",
        "run_prod.sh.example",
    ],
)
def test_portable_sources_and_templates_remain_allowed(name: str) -> None:
    assert violations([IndexedRuntimeFile("100644", f"scripts/runtime/{name}")]) == []


@pytest.mark.parametrize(
    "name",
    [
        ".env",
        ".env.local",
        ".env_shared",
        "cache.pyc",
        "test.PYO",
        "cache.db",
        "state.sqlite",
        "state.sqlite3",
        "service.log",
        ".venv/file",
        "node_modules/file",
        "__pycache__/file",
        "local_data/file",
        "secrets/file",
        "pkg.egg-info/metadata",
        ".tmp/file",
        ".pytest_cache/file",
        ".ruff_cache/file",
        ".vite/file",
    ],
)
def test_force_added_local_state_is_rejected_by_name(name: str) -> None:
    assert violations([IndexedRuntimeFile("100644", f"scripts/runtime/{name}")])


@pytest.mark.parametrize("mode", ["120000", "160000", "040000"])
def test_links_and_unsupported_modes_are_rejected(mode: str) -> None:
    assert (
        "source links"
        in violations(
            [
                IndexedRuntimeFile(mode, "scripts/runtime/portable.sh"),
            ]
        )[0]
    )


def test_outside_or_unconfined_input_is_not_silently_accepted() -> None:
    for name in ("scripts/runtime-extra/file", "pipeline/file", "scripts/runtime/../secret"):
        with pytest.raises(ValueError):
            violations([IndexedRuntimeFile("100644", name)])


def test_cli_checks_staged_removal_and_preserves_ignored_secrets(repository: Path) -> None:
    stage(repository, "scripts/runtime/run_native_dev.sh")
    stage(repository, "elsewhere/native_watchdog.sh")
    retired = stage(repository, "scripts/runtime/native_watchdog.sh")
    retired.unlink()  # Unstaged deletion must not hide a file that will be published.
    assert invoke(repository).returncode == 1
    git(repository, "add", "-u", "--", "scripts/runtime")
    assert invoke(repository).returncode == 0
    secret = stage(repository, "scripts/runtime/.env", b"SYNTHETIC_SECRET_SENTINEL\n")
    result = invoke(repository)
    assert result.returncode == 1
    assert "environment values" in result.stderr
    assert "SYNTHETIC_SECRET_SENTINEL" not in result.stdout + result.stderr
    assert secret.read_bytes() == b"SYNTHETIC_SECRET_SENTINEL\n"


def test_index_reads_ignored_and_symlink_entries_without_following(repository: Path) -> None:
    stage(repository, ".gitignore", b"scripts/runtime/.env\n")
    stage(repository, "scripts/runtime/.env", b"do not read\n")
    link = repository / "scripts/runtime/portable.sh"
    link.symlink_to(repository / "nonexistent-private-target")
    git(repository, "add", "--", "scripts/runtime/portable.sh")
    entries = indexed_files(repository)
    assert {entry.path for entry in entries} == {
        "scripts/runtime/.env",
        "scripts/runtime/portable.sh",
    }
    assert len(violations(entries)) == 2
    assert link.is_symlink()
    assert not link.exists()


def test_runtime_directory_itself_cannot_be_a_link(repository: Path) -> None:
    (repository / "scripts").mkdir()
    (repository / "scripts/runtime").symlink_to(repository / "private")
    git(repository, "add", "--", "scripts/runtime")
    assert "source links" in invoke(repository).stderr


def test_index_conflicts_fail_closed(repository: Path) -> None:
    name = "scripts/runtime/run_native_dev.sh"
    stage(repository, name)
    oid = git(repository, "rev-parse", f":{name}").decode().strip()
    git(repository, "update-index", "--force-remove", "--", name)
    subprocess.run(
        ["git", "-C", str(repository), "update-index", "--index-info"],
        input=f"100644 {oid} 2\t{name}\n".encode(),
        check=True,
        capture_output=True,
    )
    with pytest.raises(ValueError, match="index conflict"):
        indexed_files(repository)
    assert invoke(repository).returncode == 1


def test_missing_repository_or_runtime_is_a_failure(tmp_path: Path, repository: Path) -> None:
    assert invoke(repository).returncode == 1
    assert invoke(tmp_path / "missing").returncode == 1
