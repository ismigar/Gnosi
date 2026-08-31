"""The public pipeline boundary audits Git metadata, never secret file contents."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from scripts.check_public_pipeline import (
    RETIRED_FILES,
    IndexedFile,
    indexed_files,
    typecheck_pipeline,
    violations,
)


@pytest.mark.parametrize(
    "name",
    [
        "pipeline/private_skills/tool/SKILL.md",
        "pipeline/backup_agents/host.plist",
        "pipeline/skills/backup_projectes/scripts/backup.py",
        "pipeline/brain/orchestrator.py",
        "pipeline/skills/autonomous_loop/SKILL.md",
        "pipeline/skills/auto_improver/scripts/auto_improver.py",
        "pipeline/skills/proves_dataset/scripts/build_proves_dataset.py",
        "pipeline/skills/publisher/SKILL.md",
        "pipeline/skills/release_preflight/scripts/release_preflight.py",
        "pipeline/skills/vault_ai_assistant/SKILL.md",
        "pipeline/scripts/migrate_progres_to_virtual.py",
        "pipeline/skills/host_open_helper/com.gnosi.host-open-helper.plist",
        "pipeline/sandbox/scratch.py",
        "pipeline/.tmp/output.json",
        "pipeline/utils/__pycache__/cache.pyc",
        "pipeline/node_modules/dependency/index.js",
        "pipeline/skills/tool/package.egg-info/PKG-INFO",
        "pipeline/local_data/state.json",
        "pipeline/secrets/opaque.json",
        "pipeline/.env_shared",
        "pipeline/tool/.env.local",
        "pipeline/tool/state.sqlite3",
        "pipeline/tool/runtime.log",
    ],
)
def test_forbidden_tracked_paths(name: str) -> None:
    assert violations([IndexedFile("100644", name)])


def test_portable_source_and_documented_templates_remain_public() -> None:
    entries = [
        IndexedFile("100644", name)
        for name in (
            "pipeline/skills/host_open_helper/scripts/host_open_helper.py",
            "pipeline/skills/translate_page/SKILL.md",
            "pipeline/skills/zotero_schema/schema.json",
            "pipeline/tests/test_public_pipeline.py",
            "pipeline/skills/portable/.env.example",
        )
    ]
    assert not violations(entries)
    assert not violations([IndexedFile("100755", "pipeline/skills/tool/run.sh")])


@pytest.mark.parametrize("mode", ["120000", "160000"])
def test_pipeline_cannot_link_to_external_source(mode: str) -> None:
    assert violations([IndexedFile(mode, "pipeline/skills/linked")])


def test_real_git_index_catches_ignored_source_even_when_worktree_file_is_missing(
    tmp_path: Path,
) -> None:
    def git(*args: str) -> None:
        subprocess.run(["git", "-C", str(tmp_path), *args], check=True, capture_output=True)

    git("init", "-q")
    (tmp_path / ".gitignore").write_text("pipeline/private_skills/\n", encoding="utf-8")
    name = "pipeline/private_skills/fixture/config.txt"
    source = tmp_path / name
    source.parent.mkdir(parents=True)
    source.write_bytes(b"synthetic opaque bytes")
    git("add", "--force", name)
    source.unlink()
    entries = indexed_files(tmp_path)
    assert entries == [IndexedFile("100644", name)]
    assert violations(entries)
    git("add", "--update", "pipeline")
    assert indexed_files(tmp_path) == []


def test_other_repository_trees_are_not_silently_audited() -> None:
    with pytest.raises(ValueError, match="outside pipeline"):
        violations([IndexedFile("100644", "private-project/tool.py")])


@pytest.mark.parametrize("name", sorted(RETIRED_FILES))
def test_retired_implementations_cannot_return_to_public_source(name: str) -> None:
    assert violations([IndexedFile("100644", name)])


def test_typecheck_passes_every_indexed_python_source_and_propagates_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    names = [
        "pipeline/legacy/new_portable.py",
        "pipeline/skills/portable/scripts/tool.py",
        "pipeline/tests/test_portable.py",
    ]
    for name in names:
        source = tmp_path / name
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_text("value: int = 1\n", encoding="utf-8")
    calls: list[list[str]] = []

    def run(args: list[str], *, cwd: Path, check: bool) -> subprocess.CompletedProcess[str]:
        assert cwd == tmp_path.resolve()
        assert check is False
        calls.append(args)
        return subprocess.CompletedProcess(args, 1)

    monkeypatch.setattr(subprocess, "run", run)
    entries = [IndexedFile("100644", name) for name in reversed(names)]
    entries.append(IndexedFile("100644", "pipeline/README.md"))
    assert typecheck_pipeline(tmp_path, entries) == 1
    assert calls == [[
        sys.executable, "-m", "mypy", "--strict", "--explicit-package-bases", *sorted(names),
    ]]


def test_typecheck_rejects_empty_missing_and_external_sources(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="empty"):
        typecheck_pipeline(tmp_path, [IndexedFile("100644", "pipeline/README.md")])
    entry = IndexedFile("100644", "pipeline/tool.py")
    with pytest.raises(ValueError, match="Missing or external"):
        typecheck_pipeline(tmp_path, [entry])
    external = tmp_path / "external.py"
    external.write_text("value = 1\n", encoding="utf-8")
    (tmp_path / "pipeline").mkdir()
    (tmp_path / entry.path).symlink_to(external)
    with pytest.raises(ValueError, match="Missing or external"):
        typecheck_pipeline(tmp_path, [entry])
    with pytest.raises(ValueError, match="boundary violations"):
        typecheck_pipeline(tmp_path, [IndexedFile("100644", "pipeline/sandbox/scratch.py")])


def test_boundary_is_wired_into_ci_and_root_command() -> None:
    root = Path(__file__).resolve().parents[2]
    workflow = (root / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    backend_job = workflow.split("\n  backend:\n", 1)[1].split("\n  native-smoke:\n", 1)[0]
    command = "uv run python scripts/check_public_pipeline.py"
    assert backend_job.index(command) < backend_job.index("uv run ruff check")
    manifest = json.loads((root / "package.json").read_text(encoding="utf-8"))
    assert manifest["scripts"]["check:pipeline"] == command
    assert manifest["scripts"]["typecheck:pipeline"] == command + " --typecheck"
    assert command + " --typecheck" in backend_job
