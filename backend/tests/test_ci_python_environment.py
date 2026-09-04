from __future__ import annotations

from pathlib import Path
import subprocess
import sys

import pytest
import yaml

from scripts.ci.prepare_python_environment import (
    CACHE_PREFIX,
    ENVIRONMENT_PREFIX,
    cache_path,
    environment_path,
    prepare,
)


REPOSITORY = Path(__file__).resolve().parents[2]
PREPARE_STEP = "Prepare isolated Python environment"


def ci_environment(tmp_path: Path) -> dict[str, str]:
    github_env = tmp_path / "github-env"
    github_env.touch()
    return {
        "RUNNER_TEMP": str(tmp_path),
        "GITHUB_ENV": str(github_env),
        "GITHUB_RUN_ID": "33809468788",
        "GITHUB_RUN_ATTEMPT": "2",
        "GITHUB_JOB": "backend",
    }


def test_prepare_removes_only_the_job_environment_and_exports_path(tmp_path: Path) -> None:
    environment = ci_environment(tmp_path)
    candidate = environment_path(environment)
    cache = cache_path(environment)
    candidate.mkdir()
    (candidate / "stale-python").write_text("old", encoding="utf-8")
    cache.mkdir()
    (cache / "partial-wheel").write_text("broken", encoding="utf-8")
    neighbour = tmp_path / "keep-me"
    neighbour.mkdir()

    assert prepare(environment) == candidate

    assert not candidate.exists()
    assert not cache.exists()
    assert neighbour.is_dir()
    assert Path(environment["GITHUB_ENV"]).read_text(encoding="utf-8") == (
        f"UV_PROJECT_ENVIRONMENT={candidate}\n"
        f"UV_CACHE_DIR={cache}\n"
        "UV_LINK_MODE=copy\n"
    )


def test_prepare_unlinks_environment_symlink_without_following_it(tmp_path: Path) -> None:
    environment = ci_environment(tmp_path)
    candidate = environment_path(environment)
    target = tmp_path / "target-to-preserve"
    target.mkdir()
    (target / "sentinel").write_text("safe", encoding="utf-8")
    candidate.symlink_to(target, target_is_directory=True)

    prepare(environment)

    assert not candidate.exists()
    assert (target / "sentinel").read_text(encoding="utf-8") == "safe"


def test_prepare_unlinks_cache_symlink_without_following_it(tmp_path: Path) -> None:
    environment = ci_environment(tmp_path)
    cache = cache_path(environment)
    target = tmp_path / "cache-target-to-preserve"
    target.mkdir()
    (target / "sentinel").write_text("safe", encoding="utf-8")
    cache.symlink_to(target, target_is_directory=True)

    prepare(environment)

    assert not cache.exists()
    assert (target / "sentinel").read_text(encoding="utf-8") == "safe"


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("GITHUB_RUN_ID", "../outside"),
        ("GITHUB_RUN_ATTEMPT", "/absolute"),
        ("GITHUB_JOB", "backend/other"),
        ("GITHUB_JOB", ".."),
        ("GITHUB_JOB", ""),
    ],
)
def test_environment_path_rejects_unsafe_identifiers(tmp_path: Path, name: str, value: str) -> None:
    environment = ci_environment(tmp_path)
    environment[name] = value

    with pytest.raises(ValueError, match=name):
        environment_path(environment)


def test_cli_is_idempotent_and_uses_only_runner_temp(tmp_path: Path) -> None:
    environment = ci_environment(tmp_path)
    command = [sys.executable, str(REPOSITORY / "scripts/ci/prepare_python_environment.py")]

    subprocess.run(command, env=environment, check=True)
    subprocess.run(command, env=environment, check=True)

    exported = Path(environment["GITHUB_ENV"]).read_text(encoding="utf-8").splitlines()
    assert len(exported) == 6
    assert exported[:3] == exported[3:]
    assert exported[0].startswith(f"UV_PROJECT_ENVIRONMENT={tmp_path / ENVIRONMENT_PREFIX}")
    assert exported[1].startswith(f"UV_CACHE_DIR={tmp_path / CACHE_PREFIX}")
    assert exported[2] == "UV_LINK_MODE=copy"


def test_python_workflows_prepare_every_uv_project_environment() -> None:
    workflow_paths = sorted((REPOSITORY / ".github/workflows").glob("*.yml"))
    assert workflow_paths

    for workflow_path in workflow_paths:
        document = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))
        assert isinstance(document, dict)
        jobs = document.get("jobs", {})
        assert isinstance(jobs, dict)
        for job_name, job in jobs.items():
            if not isinstance(job, dict):
                continue
            steps = job.get("steps", [])
            if not isinstance(steps, list):
                continue
            uv_project_steps = [
                index
                for index, step in enumerate(steps)
                if isinstance(step, dict)
                and isinstance(step.get("run"), str)
                and ("uv sync" in step["run"] or "uv run" in step["run"])
            ]
            if not uv_project_steps:
                continue
            prepare_steps = [
                index
                for index, step in enumerate(steps)
                if isinstance(step, dict) and step.get("name") == PREPARE_STEP
            ]
            assert len(prepare_steps) == 1, f"{workflow_path.name}:{job_name}"
            prepare_index = prepare_steps[0]
            assert prepare_index < min(uv_project_steps), f"{workflow_path.name}:{job_name}"
            prepare_step = steps[prepare_index]
            assert prepare_step.get("run") == "python scripts/ci/prepare_python_environment.py"


def test_ci_requires_relocatable_uv_managed_python() -> None:
    workflow = yaml.safe_load((REPOSITORY / ".github/workflows/ci.yml").read_text(encoding="utf-8"))
    assert isinstance(workflow, dict)
    environment = workflow.get("env")
    assert isinstance(environment, dict)
    assert environment.get("UV_MANAGED_PYTHON") == "1"


def test_job_scoped_uv_caches_are_not_uploaded_by_setup_uv() -> None:
    """A disposable cache cannot be restored and must not stall post-job upload."""
    for workflow_path in sorted((REPOSITORY / ".github/workflows").glob("*.yml")):
        document = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))
        assert isinstance(document, dict)
        jobs = document.get("jobs", {})
        assert isinstance(jobs, dict)
        for job_name, raw_job in jobs.items():
            if not isinstance(raw_job, dict):
                continue
            steps = raw_job.get("steps", [])
            if not isinstance(steps, list):
                continue
            for step in steps:
                if not isinstance(step, dict) or step.get("uses") != "astral-sh/setup-uv@v10.0.1":
                    continue
                settings = step.get("with", {})
                assert isinstance(settings, dict)
                assert settings.get("enable-cache") is False, (
                    workflow_path.name,
                    job_name,
                )
