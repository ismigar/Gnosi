"""The pre-PR entry point must reuse complete CI gates and fail closed."""

from __future__ import annotations

import json
import logging
import platform
import shlex
import subprocess
import sys
from pathlib import Path
from typing import Mapping, Sequence

import pytest
import yaml

from scripts.ci import pre_pr
from scripts.ci.pre_pr_commands import DOCS, Step, build_steps

ROOT = Path(__file__).resolve().parents[2]


def test_root_entrypoint_uses_the_frozen_existing_python_environment() -> None:
    scripts = json.loads((ROOT / "package.json").read_text())["scripts"]
    assert scripts.get("check:pre-pr") == ("uv run --frozen --no-sync python scripts/ci/pre_pr.py")


def _ci_validations(workflow: str) -> set[tuple[str, ...]]:
    jobs = yaml.safe_load(workflow)["jobs"]
    commands = set()
    for job in ("backend", "frontend"):
        for step in jobs[job]["steps"]:
            for line in step.get("run", "").splitlines():
                if line.startswith(("pnpm ", "uv run ")):
                    if line.startswith(("pnpm install ", "uv run --frozen --no-sync python -c")):
                        continue
                    commands.add(tuple(shlex.split(line)))
    return commands


def test_full_plan_contains_every_existing_frontend_and_backend_ci_validation() -> None:
    workflow = (ROOT / ".github/workflows/ci.yml").read_text()
    expected = _ci_validations(workflow)
    assert len(expected) >= 20
    actual = {step.arguments for step in build_steps(ROOT, "a" * 40, quick=False)}
    assert expected <= actual
    # A new CI command cannot be silently absent from the local full gate.
    changed = workflow.replace("- run: uv run pytest", "- run: uv run python extra_gate.py")
    assert not _ci_validations(changed) <= actual


def test_full_plan_keeps_complete_suites_build_and_updating_docs_gate() -> None:
    arguments = [step.arguments for step in build_steps(ROOT, "b" * 40, quick=False)]
    for command in (
        ("uv", "run", "pytest"),
        ("pnpm", "test:frontend"),
        ("pnpm", "test:desktop"),
        ("pnpm", "build:frontend"),
    ):
        assert arguments.count(command) == 1
    assert arguments[-1] == (
        "uv",
        "run",
        "python",
        f"{DOCS}/pre_pr.py",
        "--base-ref",
        "b" * 40,
    )
    assert ("pnpm", "--filter", "@gnosi/desktop", "typecheck:ipc") in arguments


def test_quick_plan_is_explicitly_a_subset_and_never_updates_docs() -> None:
    steps = build_steps(ROOT, "c" * 40, quick=True)
    arguments = [step.arguments for step in steps]
    assert ("uv", "run", "pytest") not in arguments
    assert ("pnpm", "test:frontend") not in arguments
    assert ("pnpm", "test:desktop") not in arguments
    assert not any("build:frontend" in args or f"{DOCS}/pre_pr.py" in args for args in arguments)
    assert ("uv", "run", "python", f"{DOCS}/generate.py", "--check") in arguments
    assert ("uv", "run", "python", f"{DOCS}/localize.py", "--check") in arguments
    ci_step = next(step for step in steps if step.name == "CI and pre-PR regressions")
    for path in (ROOT / "backend/tests").glob("test_ci_*.py"):
        assert path.relative_to(ROOT).as_posix() in ci_step.arguments


@pytest.mark.parametrize("quick", [False, True])
def test_plan_never_starts_live_services_builds_containers_or_mutates_git(quick: bool) -> None:
    commands = [step.arguments for step in build_steps(ROOT, "d" * 40, quick=quick)]
    forbidden = {
        "docker",
        "uvicorn",
        "push",
        "merge",
        "checkout",
        "fetch",
        "install",
        "sync",
        "test:e2e:smoke",
        "dev:frontend",
        "dev:backend",
    }
    for arguments in commands:
        if arguments[:2] == ("uv", "sync"):
            assert arguments == (
                "uv",
                "sync",
                "--frozen",
                "--check",
                "--inexact",
                "--group",
                "docs-ci",
            )
        else:
            assert not forbidden.intersection(arguments)
    assert pre_pr.REMOTE_GATES == ("documentation", "backend", "frontend", "native-smoke", "docker")


def test_missing_ci_test_collection_fails_closed(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="empty"):
        build_steps(tmp_path, "a" * 40, quick=True)


def test_environment_contains_no_live_credentials_or_user_runtime_selectors(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    parent = {
        "HOME": "/synthetic/home",
        "CODEX_HOME": "/synthetic/codex",
        "PATH": "/synthetic/bin",
        "GNOSI_DATA_DIR": "/real-data",
        "DIGITAL_BRAIN_VAULT_PATH": "/real-vault",
        "GNOSI_RUN_LIVE_E2E": "1",
        "GNOSI_API_TOKEN": "must-not-leak",
        "GNOSI_UNEXPECTED_PATH": "/real-private-data",
        "OPENAI_API_KEY": "must-not-leak",
        "GNOSI_TEST_PASSWORD": "must-not-leak",
        "GITHUB_TOKEN": "must-not-leak",
        "GNOSI_SHARED_ENV_FILE": "/real.env",
        "UV_NO_SYNC": "0",
        "UV_FROZEN": "0",
        "NODE_OPTIONS": "--max-old-space-size=9999",
        "pnpm_config_verify_deps_before_run": "install",
        "GNOSI_VITEST_MAX_WORKERS": "20",
    }
    original = dict(parent)
    environment = pre_pr.isolated_environment(parent, tmp_path)
    assert parent == original
    assert environment["HOME"] == parent["HOME"]
    assert environment["CODEX_HOME"] == parent["CODEX_HOME"]
    assert "must-not-leak" not in environment.values()
    assert "GITHUB_TOKEN" not in environment
    assert "GNOSI_UNEXPECTED_PATH" not in environment
    assert environment["GNOSI_API_TOKEN"] == ""
    assert environment["GNOSI_RUN_LIVE_E2E"] == "0"
    assert environment["GNOSI_BACKEND_URL"] == "http://127.0.0.1:9"
    assert environment["GNOSI_BASE_URL"] == "http://127.0.0.1:9"
    assert environment["GNOSI_DISABLE_SCHEDULER"] == "1"
    assert environment["UV_NO_SYNC"] == environment["UV_FROZEN"] == "1"
    assert environment["pnpm_config_verify_deps_before_run"] == "error"
    assert environment["NODE_OPTIONS"] == "--max-old-space-size=4096"
    assert environment["GNOSI_VITEST_MAX_WORKERS"] == "1"
    for name in (
        "GNOSI_VALIDATION_ROOT",
        "GNOSI_DATA_DIR",
        "DIGITAL_BRAIN_VAULT_PATH",
        "VAULT_HOST_PATH",
        "HOME_HOST_PATH",
    ):
        monkeypatch.setenv(name, environment[name])
    from backend.config.validation_runtime import validation_runtime_enabled

    assert validation_runtime_enabled()
    assert not Path(environment["GNOSI_SHARED_ENV_FILE"]).exists()
    assert not Path(environment["GNOSI_TEST_STORAGE_STATE"]).exists()


@pytest.mark.parametrize("failure_at", [None, 0, 1, 2])
def test_runner_preserves_order_and_first_failure_without_retry(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    failure_at: int | None,
) -> None:
    steps = [Step(f"phase-{index}", ("synthetic", str(index))) for index in range(3)]
    calls: list[tuple[str, ...]] = []
    environment = {"SYNTHETIC": "value"}

    def run(
        args: Sequence[str], *, cwd: Path, env: Mapping[str, str], check: bool, **kwargs: object
    ) -> subprocess.CompletedProcess[str]:
        assert cwd == tmp_path and env == environment
        assert check is False and "shell" not in kwargs
        calls.append(tuple(args))
        status = 23 if len(calls) - 1 == failure_at else 0
        return subprocess.CompletedProcess(args, status)

    monkeypatch.setattr(subprocess, "run", run)
    status = pre_pr.run_steps(tmp_path, steps, environment)
    assert status == (0 if failure_at is None else 23)
    assert calls == [
        step.arguments for step in steps[: None if failure_at is None else failure_at + 1]
    ]


@pytest.mark.parametrize(
    ("error", "status"), [(FileNotFoundError(), 127), (KeyboardInterrupt(), 130)]
)
def test_runner_does_not_continue_after_missing_tool_or_interruption(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    error: BaseException,
    status: int,
) -> None:
    calls = []

    def fail(*args: object, **kwargs: object) -> None:
        calls.append(args)
        raise error

    monkeypatch.setattr(subprocess, "run", fail)
    assert (
        pre_pr.run_steps(tmp_path, [Step("first", ("missing",)), Step("later", ("unused",))], {})
        == status
    )
    assert len(calls) == 1


@pytest.fixture
def git_repository(tmp_path: Path) -> Path:
    def git(*arguments: str) -> None:
        subprocess.run(("git", *arguments), cwd=tmp_path, check=True, capture_output=True)

    git("init", "--quiet")
    (tmp_path / "source.txt").write_text("synthetic\n")
    git("add", "source.txt")
    git(
        "-c",
        "user.name=Synthetic Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--quiet",
        "-m",
        "Synthetic fixture",
    )
    return tmp_path


def test_ref_is_pinned_without_mutating_checkout(git_repository: Path) -> None:
    before = pre_pr.resolve_commit(git_repository, "HEAD")
    assert pre_pr.resolve_commit(git_repository, before) == before
    pre_pr.check_checkout(git_repository)
    (git_repository / "source.txt").write_text("tracked edits are allowed\n")
    pre_pr.check_checkout(git_repository)
    assert pre_pr.resolve_commit(git_repository, "HEAD") == before
    (git_repository / "new-test.py").touch()
    with pytest.raises(ValueError, match="untracked"):
        pre_pr.check_checkout(git_repository)


def test_fingerprint_ignores_catalog_refresh_but_detects_source_edits(git_repository: Path) -> None:
    catalog = git_repository / "docs/engineering/generated/tests.md"
    catalog.parent.mkdir(parents=True)
    catalog.write_text("generated fixture\n")
    subprocess.run(
        ("git", "add", "docs/engineering/generated/tests.md"),
        cwd=git_repository,
        check=True,
        capture_output=True,
    )
    before = pre_pr.source_fingerprint(git_repository)
    catalog.write_text("updated generated fixture\n")
    assert pre_pr.source_fingerprint(git_repository) == before
    (git_repository / "source.txt").write_text("changed source\n")
    assert pre_pr.source_fingerprint(git_repository) != before


@pytest.mark.parametrize("reference", ["", "--all", "bad ref", "HEAD\nbad"])
def test_unsafe_base_ref_is_rejected_before_git(tmp_path: Path, reference: str) -> None:
    with pytest.raises(ValueError):
        pre_pr.resolve_commit(tmp_path, reference)


def test_unknown_base_ref_does_not_fall_back(git_repository: Path) -> None:
    with pytest.raises(subprocess.CalledProcessError):
        pre_pr.resolve_commit(git_repository, "missing-base")


def test_unmerged_index_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pre_pr, "_git", lambda *_args: "unmerged fixture")
    with pytest.raises(ValueError, match="merge conflicts"):
        pre_pr.check_checkout(ROOT)


@pytest.mark.parametrize(
    ("machine", "node_arch", "matches"),
    [
        ("arm64", "arm64", True),
        ("aarch64", "arm64", True),
        ("x86_64", "x64", True),
        ("AMD64", "x64", True),
        ("x86_64", "arm64", False),
    ],
)
def test_python_and_node_must_use_the_same_architecture(
    monkeypatch: pytest.MonkeyPatch,
    machine: str,
    node_arch: str,
    matches: bool,
) -> None:
    monkeypatch.setattr(sys, "version_info", (3, 11))
    monkeypatch.setattr(platform, "machine", lambda: machine)
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(args, 0, stdout=node_arch),
    )
    if matches:
        pre_pr.check_python_architecture()
    else:
        with pytest.raises(ValueError, match="architectures differ"):
            pre_pr.check_python_architecture()


def test_other_python_version_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sys, "version_info", (3, 12))
    with pytest.raises(ValueError, match="3.11"):
        pre_pr.check_python_architecture()


@pytest.mark.parametrize(
    "mode", ["list", "quick", "full", "failure", "changed-source", "changed-head"]
)
def test_cli_reports_scope_and_cleans_only_its_disposable_runtime(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    mode: str,
) -> None:
    caplog.set_level(logging.INFO)
    monkeypatch.setattr(pre_pr, "ROOT", tmp_path)
    monkeypatch.setattr(pre_pr, "resolve_commit", lambda *_args: "a" * 40)
    monkeypatch.setattr(pre_pr, "check_checkout", lambda *_args: None)
    monkeypatch.setattr(pre_pr, "check_python_architecture", lambda: None)
    monkeypatch.setattr(
        pre_pr, "build_steps", lambda *args, **kwargs: [Step("fixture", ("fixture",))]
    )
    fingerprints = iter(
        [
            ("b" * 40 if mode == "changed-head" else "a" * 40, "before"),
            ("a" * 40, "after" if mode == "changed-source" else "before"),
        ]
    )
    monkeypatch.setattr(pre_pr, "source_fingerprint", lambda *_args: next(fingerprints))
    runtime_roots: list[Path] = []

    def run(root: Path, steps: Sequence[Step], environment: Mapping[str, str]) -> int:
        assert root == tmp_path and len(steps) == 1
        runtime_roots.append(Path(environment["GNOSI_VALIDATION_ROOT"]))
        assert runtime_roots[-1].is_dir()
        return 23 if mode == "failure" else 0

    monkeypatch.setattr(pre_pr, "run_steps", run)
    arguments = ["--base-ref", "fixture"]
    if mode in {"list", "quick"}:
        arguments.append("--" + mode)
    expected = 23 if mode == "failure" else 2 if mode.startswith("changed-") else 0
    assert pre_pr.main(arguments) == expected
    assert all(not path.exists() for path in runtime_roots)
    if mode == "list":
        assert not runtime_roots and "no checks have passed" in caplog.text
    elif mode in {"failure", "changed-source", "changed-head"}:
        assert "checks passed" not in caplog.text
    else:
        assert "GitHub still must pass all five checks" in caplog.text
        assert ("QUICK SUBSET" in caplog.text) == (mode == "quick")
