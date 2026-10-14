"""Reusing real remote passes must reject modified inputs and invalid evidence."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
import yaml

from scripts.ci import reuse_approved_ci as reuse


def test_metadata_scope_never_allows_product_locks_or_runtime_source() -> None:
    for path in (
        "frontend/src/a.ts",
        "backend/a.py",
        "uv.lock",
        "pyproject.toml",
        "docs/engineering/../runtime.py",
        "docs/engineering/generated/a.js",
    ):
        assert not reuse.metadata_path(path)
    assert reuse.metadata_path("docs/engineering-ca/generated/tests.md")


@pytest.mark.parametrize(
    "field,value",
    [
        ("GITHUB_EVENT_NAME", "push"),
        ("GITHUB_REPOSITORY", "fork/Gnosi"),
        ("GITHUB_HEAD_REF", "another-feature"),
    ],
)
def test_reuse_is_scoped_to_only_the_authorized_pr(field: str, value: str) -> None:
    environment = {
        "GITHUB_EVENT_NAME": "pull_request",
        "GITHUB_REPOSITORY": "ismigar/Gnosi",
        "GITHUB_HEAD_REF": "feat/parity-calendar-integration",
    }
    event = {"number": 181, "pull_request": {"head": {"repo": {"full_name": "ismigar/Gnosi"}}}}
    assert reuse.eligible(environment, event)
    environment[field] = value
    assert not reuse.eligible(environment, event)


def test_reuse_rejects_other_pr_numbers_and_fork_heads() -> None:
    env = {
        "GITHUB_EVENT_NAME": "pull_request",
        "GITHUB_REPOSITORY": "ismigar/Gnosi",
        "GITHUB_HEAD_REF": "feat/parity-calendar-integration",
    }
    for number, repo in ((182, "ismigar/Gnosi"), (181, "fork/Gnosi")):
        assert not reuse.eligible(
            env, {"number": number, "pull_request": {"head": {"repo": {"full_name": repo}}}}
        )


@pytest.mark.parametrize(
    "status,conclusion",
    [
        ("in_progress", None),
        ("completed", "failure"),
        ("completed", "skipped"),
        ("completed", "cancelled"),
    ],
)
def test_only_actual_terminal_success_can_be_reused(
    monkeypatch: pytest.MonkeyPatch, status: str, conclusion: str | None
) -> None:
    record: dict[str, object] = {
        "head_sha": "d8f8e624bcf42de535e92dc4e85a7e797afe424e",
        "jobs": {"native-smoke": {"run_id": 1, "job_id": 2}},
    }

    def response(path: str) -> dict[str, object]:
        if path.endswith("/1"):
            return {"head_sha": record["head_sha"], "event": "pull_request", "name": "CI"}
        return {
            "name": "native-smoke",
            "id": 2,
            "run_id": 1,
            "status": status,
            "conclusion": conclusion,
        }

    monkeypatch.setattr(reuse, "github_json", response)
    with pytest.raises(ValueError, match="completed success"):
        reuse.verified_remote_job("native-smoke", record)


def test_remote_evidence_checks_head_workflow_and_job_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    record: dict[str, object] = {
        "head_sha": "d8f8e624bcf42de535e92dc4e85a7e797afe424e",
        "jobs": {"native-smoke": {"run_id": 1, "job_id": 2}},
    }
    run: dict[str, object] = {"head_sha": record["head_sha"], "event": "pull_request", "name": "CI"}
    job = {
        "name": "native-smoke",
        "id": 2,
        "run_id": 1,
        "status": "completed",
        "conclusion": "success",
    }

    def response(path: str) -> dict[str, object]:
        return run if path.endswith("/1") else job

    monkeypatch.setattr(reuse, "github_json", response)
    assert reuse.verified_remote_job("native-smoke", record)["job_id"] == 2
    for field, value in [("head_sha", "e" * 40), ("event", "push"), ("name", "unrelated")]:
        original = run[field]
        run[field] = value
        with pytest.raises(ValueError):
            reuse.verified_remote_job("native-smoke", record)
        run[field] = original
    job["id"] = 3
    with pytest.raises(ValueError, match="identity"):
        reuse.verified_remote_job("native-smoke", record)


def test_unreviewed_metadata_and_file_modes_are_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    record: dict[str, object] = {
        "head_sha": "d8f8e624bcf42de535e92dc4e85a7e797afe424e",
        "approved_changes": {
            "scripts/ci/classify_changes.py": "100644 blob abc\tscripts/ci/classify_changes.py"
        },
    }
    monkeypatch.setattr(subprocess, "run", lambda *args, **kwargs: None)

    def output(arguments: list[str], **kwargs: object) -> bytes:
        if arguments[1] == "diff":
            return b"scripts/ci/classify_changes.py\0"
        return b"100755 blob abc\tscripts/ci/classify_changes.py"

    monkeypatch.setattr(subprocess, "check_output", output)
    with pytest.raises(ValueError, match="Unreviewed"):
        reuse.changed_inputs(record)


def test_real_product_change_requires_a_new_execution(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(subprocess, "run", lambda *args, **kwargs: None)
    monkeypatch.setattr(subprocess, "check_output", lambda *args, **kwargs: b"frontend/src/a.ts\0")
    assert (
        reuse.changed_inputs(
            {"head_sha": "d8f8e624bcf42de535e92dc4e85a7e797afe424e", "approved_changes": {}}
        )
        is None
    )


def test_help_retains_every_original_action_command_and_setting() -> None:
    root = Path(__file__).resolve().parents[4]
    original = yaml.safe_load(
        subprocess.check_output(
            ["git", "show", "d8f8e624:.github/workflows/learn-quality.yml"], cwd=root
        )
    )
    current = yaml.safe_load((root / ".github/workflows/learn-quality.yml").read_text())
    old = original["jobs"]["help"]
    new = current["jobs"]["help"]
    assert {k: v for k, v in old.items() if k != "steps"} == {
        k: v for k, v in new.items() if k != "steps"
    }
    checkout = dict(new["steps"][0])
    assert checkout.pop("with") == {
        "ref": "${{ github.sha }}",
        "fetch-depth": 0,
        "persist-credentials": False,
    }
    assert checkout == old["steps"][0]
    restored = [{k: v for k, v in step.items() if k != "if"} for step in new["steps"][2:]]
    assert restored == old["steps"][1:]
    assert all(
        step["if"] == "steps.previous.outputs.runtime_required != 'false'"
        for step in new["steps"][2:]
    )


def _environment(tmp_path: Path) -> dict[str, str]:
    import json

    event = tmp_path / "event.json"
    event.write_text(
        json.dumps(
            {"number": 181, "pull_request": {"head": {"repo": {"full_name": reuse.REPOSITORY}}}}
        )
    )
    return {
        "GITHUB_EVENT_NAME": "pull_request",
        "GITHUB_REPOSITORY": reuse.REPOSITORY,
        "GITHUB_HEAD_REF": reuse.BRANCH,
        "GITHUB_EVENT_PATH": str(event),
        "GITHUB_JOB": "native-smoke",
    }


@pytest.mark.parametrize("job", ["native-smoke", "documentation", "frontend"])
def test_release_candidate_and_failed_jobs_require_real_runtime(tmp_path: Path, job: str) -> None:
    env = _environment(tmp_path)
    env["GITHUB_JOB"] = job
    env["CI_RELEASE_CANDIDATE"] = "true"
    assert reuse.reuse(env) == {"reused": False}
    env.pop("CI_RELEASE_CANDIDATE")
    for job in ("backend", "docker"):
        env["GITHUB_JOB"] = job
        assert reuse.reuse(env) == {"reused": False}


@pytest.mark.parametrize("kind", ["missing", "symlink", "dangling"])
def test_missing_or_symlink_record_aborts_passed_job(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, kind: str
) -> None:
    env = _environment(tmp_path)
    monkeypatch.setattr(reuse, "ROOT", tmp_path)
    record = tmp_path / reuse.RECORD
    record.parent.mkdir()
    if kind != "missing":
        target = tmp_path / "target.json"
        if kind == "symlink":
            target.write_text("{}")
        record.symlink_to(target)
    with pytest.raises(ValueError, match="committed regular file"):
        reuse.reuse(env)


def test_deleted_job_reference_aborts_and_network_error_propagates(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import json
    from urllib.error import URLError

    env = _environment(tmp_path)
    monkeypatch.setattr(reuse, "ROOT", tmp_path)
    path = tmp_path / reuse.RECORD
    path.parent.mkdir()
    monkeypatch.setattr(
        subprocess,
        "check_output",
        lambda *args, **kwargs: b"100644 blob abc\t.github/pr181-reused-checks.json",
    )
    path.write_text(json.dumps({"jobs": {}}))
    with pytest.raises(ValueError, match="changed or missing"):
        reuse.reuse(env)
    path.write_text(
        json.dumps(
            {"head_sha": "d8f8e624bcf42de535e92dc4e85a7e797afe424e", "jobs": reuse.REUSED_JOBS}
        )
    )
    monkeypatch.setattr(reuse, "changed_inputs", lambda record: [])

    def unavailable(job: str, record: dict[str, object]) -> dict[str, object]:
        raise URLError("unavailable")

    monkeypatch.setattr(reuse, "verified_remote_job", unavailable)
    with pytest.raises(URLError):
        reuse.reuse(env)


def test_reuse_main_reports_verified_prior_execution(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    import json
    import sys

    env = _environment(tmp_path)
    monkeypatch.setattr(reuse, "ROOT", tmp_path)
    path = tmp_path / reuse.RECORD
    path.parent.mkdir()
    path.write_text(
        json.dumps(
            {"head_sha": "d8f8e624bcf42de535e92dc4e85a7e797afe424e", "jobs": reuse.REUSED_JOBS}
        )
    )
    monkeypatch.setattr(
        subprocess,
        "check_output",
        lambda *args, **kwargs: b"100644 blob abc\t.github/pr181-reused-checks.json",
    )
    monkeypatch.setattr(reuse, "changed_inputs", lambda record: ["scripts/ci/classify_changes.py"])
    monkeypatch.setattr(reuse, "verified_remote_job", lambda job, record: reuse.REUSED_JOBS[job])
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    output = tmp_path / "output"
    summary = tmp_path / "summary"
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    monkeypatch.setattr(sys, "argv", ["reuse_approved_ci.py"])
    reuse.main()
    assert output.read_text() == "runtime_required=false\n"
    assert "actual successful remote check" in summary.read_text()
    assert "38609225236" in capsys.readouterr().out


def test_missing_baseline_ancestry_aborts(monkeypatch: pytest.MonkeyPatch) -> None:
    def missing(*args: object, **kwargs: object) -> None:
        raise subprocess.CalledProcessError(1, ["git", "merge-base"])

    monkeypatch.setattr(subprocess, "run", missing)
    with pytest.raises(subprocess.CalledProcessError):
        reuse.changed_inputs({"head_sha": "d8f8e624bcf42de535e92dc4e85a7e797afe424e"})


def test_approved_symlink_mode_is_still_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    entry = "120000 blob abc\tscripts/ci/classify_changes.py"
    monkeypatch.setattr(subprocess, "run", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        subprocess,
        "check_output",
        lambda args, **kwargs: (
            b"scripts/ci/classify_changes.py\0" if args[1] == "diff" else entry.encode()
        ),
    )
    with pytest.raises(ValueError):
        reuse.changed_inputs(
            {
                "head_sha": "d8f8e624bcf42de535e92dc4e85a7e797afe424e",
                "approved_changes": {"scripts/ci/classify_changes.py": entry},
            }
        )


@pytest.mark.parametrize("reused", [True, False])
def test_classifier_main_dispatch_preserves_original_runtime_requirement(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, reused: bool
) -> None:
    import json

    from scripts.ci import classify_changes as classifier

    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess([], 0, json.dumps({"reused": reused})),
    )
    calls: list[bool] = []

    def required(env: object) -> bool:
        calls.append(True)
        return True

    monkeypatch.setattr(classifier, "runtime_required", required)
    path = tmp_path / "output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(path))
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)
    classifier.main()
    assert path.read_text() == f"runtime_required={str(not reused).lower()}\n"
    assert calls == ([] if reused else [True])


def test_classifier_verification_failure_aborts_before_runtime_or_output(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from scripts.ci import classify_changes as classifier

    def failed(*args: object, **kwargs: object) -> None:
        raise subprocess.CalledProcessError(1, ["verifier"])

    monkeypatch.setattr(subprocess, "run", failed)
    path = tmp_path / "output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(path))
    with pytest.raises(subprocess.CalledProcessError):
        classifier.main()
    assert not path.exists()


@pytest.mark.parametrize(
    "entry",
    [
        "100644 blob changed\tscripts/ci/classify_changes.py",
        "120000 blob approved\tscripts/ci/classify_changes.py",
    ],
)
def test_product_change_never_bypasses_unreviewed_metadata(
    monkeypatch: pytest.MonkeyPatch, entry: str
) -> None:
    monkeypatch.setattr(subprocess, "run", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        subprocess,
        "check_output",
        lambda args, **kwargs: (
            b"frontend/src/a.ts\0scripts/ci/classify_changes.py\0"
            if args[1] == "diff"
            else entry.encode()
        ),
    )
    with pytest.raises(ValueError, match="Unreviewed"):
        reuse.changed_inputs(
            {
                "head_sha": "d8f8e624bcf42de535e92dc4e85a7e797afe424e",
                "approved_changes": {
                    "scripts/ci/classify_changes.py": (
                        "100644 blob approved\tscripts/ci/classify_changes.py"
                    )
                },
            }
        )


@pytest.mark.parametrize("reused", [True, False])
def test_documentation_dispatch_keeps_actual_gate_when_not_reused(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, reused: bool
) -> None:
    import json

    from pipeline.skills.technical_documentation.scripts import pre_pr

    monkeypatch.setenv("GITHUB_JOB", "documentation")
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess([], 0, json.dumps({"reused": reused})),
    )
    calls: list[bool] = []

    def gate(*args: object, **kwargs: object) -> None:
        calls.append(True)

    monkeypatch.setattr(pre_pr, "run_gate", gate)
    assert pre_pr.main(["--check-only"]) == 0
    assert calls == ([] if reused else [True])


def test_documentation_verification_failure_aborts_before_gate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from pipeline.skills.technical_documentation.scripts import pre_pr

    monkeypatch.setenv("GITHUB_JOB", "documentation")

    def unavailable(*args: object, **kwargs: object) -> None:
        raise subprocess.CalledProcessError(1, ["verifier"])

    monkeypatch.setattr(subprocess, "run", unavailable)
    with pytest.raises(subprocess.CalledProcessError):
        pre_pr.main(["--check-only"])


def test_documentation_release_context_is_propagated() -> None:
    workflow = yaml.safe_load((reuse.ROOT / ".github/workflows/ci.yml").read_text())
    assert (
        workflow["jobs"]["documentation"]["env"]["CI_RELEASE_CANDIDATE"]
        == "${{ inputs.release_candidate }}"
    )


def test_documentation_job_uses_its_actual_passed_source(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    import json

    env = _environment(tmp_path)
    env["GITHUB_JOB"] = "documentation"
    monkeypatch.setattr(reuse, "ROOT", tmp_path)
    path = tmp_path / reuse.RECORD
    path.parent.mkdir()
    path.write_text(
        json.dumps(
            {"head_sha": "d8f8e624bcf42de535e92dc4e85a7e797afe424e", "jobs": reuse.REUSED_JOBS}
        )
    )
    monkeypatch.setattr(
        subprocess,
        "check_output",
        lambda *args, **kwargs: b"100644 blob abc\t.github/pr181-reused-checks.json",
    )
    heads: list[object] = []

    def delta(record: dict[str, object]) -> list[str]:
        heads.append(record["head_sha"])
        return []

    monkeypatch.setattr(reuse, "changed_inputs", delta)
    monkeypatch.setattr(reuse, "verified_remote_job", lambda job, record: reuse.REUSED_JOBS[job])
    assert reuse.reuse(env)["reused"] is True
    assert heads == ["b1f08204fe0778eac17be6e64ec310d73e747332"]


@pytest.mark.parametrize("payload", ["{}", '{"reused": 1}', '{"reused": "false"}'])
def test_documentation_invalid_evidence_aborts(
    monkeypatch: pytest.MonkeyPatch, payload: str
) -> None:
    from pipeline.skills.technical_documentation.scripts import pre_pr

    monkeypatch.setenv("GITHUB_JOB", "documentation")
    monkeypatch.setattr(
        subprocess, "run", lambda *args, **kwargs: subprocess.CompletedProcess([], 0, payload)
    )
    with pytest.raises(ValueError, match="Invalid documentation reuse"):
        pre_pr.main(["--check-only"])
