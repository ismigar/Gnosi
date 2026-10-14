"""Verify earlier remote checks before reusing them for this PR's CI-only repair."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Mapping
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
RECORD = ".github/pr181-reused-checks.json"
REPOSITORY = "ismigar/Gnosi"
BRANCH = "feat/parity-calendar-integration"
REUSED_JOBS = {
    "native-smoke": {"run_id": 38609225236, "job_id": 116007962773},
    "help": {"run_id": 38609225277, "job_id": 116007962244},
}
METADATA_PATHS = frozenset(
    {
        ".github/workflows/ci.yml",
        ".github/workflows/learn-quality.yml",
        RECORD,
        "desktop/release-candidate-policy.test.js",
        "scripts/ci/classify_changes.py",
        "scripts/ci/reuse_approved_ci.py",
        "pipeline/skills/technical_documentation/tests/test_ci_result_reuse.py",
        "pipeline/skills/technical_documentation/tests/test_publication.py",
    }
)


def object_map(value: object) -> dict[str, object]:
    if not isinstance(value, dict) or any(not isinstance(key, str) for key in value):
        raise ValueError("Invalid previous-check metadata")
    return value


def metadata_path(path: str) -> bool:
    parts = Path(path).parts
    return path in METADATA_PATHS or (
        len(parts) == 4
        and parts[0] == "docs"
        and parts[1] in {"engineering", "engineering-ca", "engineering-es", "engineering-fr"}
        and parts[2] == "generated"
        and parts[3].endswith(".md")
    )


def github_json(path: str) -> dict[str, object]:
    request = Request(
        "https://api.github.com/repos/" + REPOSITORY + path,
        headers={"User-Agent": "Gnosi-CI-input-reuse", "Accept": "application/vnd.github+json"},
    )
    with urlopen(request, timeout=15) as response:
        return object_map(json.load(response))


def eligible(environment: Mapping[str, str], event: dict[str, object]) -> bool:
    if (
        environment.get("GITHUB_EVENT_NAME") != "pull_request"
        or environment.get("GITHUB_REPOSITORY") != REPOSITORY
        or environment.get("GITHUB_HEAD_REF") != BRANCH
        or environment.get("CI_RELEASE_CANDIDATE") == "true"
        or event.get("number") != 181
    ):
        return False
    pull = object_map(event.get("pull_request"))
    return object_map(object_map(pull.get("head")).get("repo")).get("full_name") == REPOSITORY


def changed_inputs(record: dict[str, object]) -> list[str] | None:
    baseline = record["head_sha"]
    if baseline != "d8f8e624bcf42de535e92dc4e85a7e797afe424e":
        raise ValueError("Unexpected reuse baseline")
    subprocess.run(
        ["git", "merge-base", "--is-ancestor", str(baseline), "HEAD"],
        cwd=ROOT,
        check=True,
        timeout=10,
        capture_output=True,
    )
    changed = (
        subprocess.check_output(
            ["git", "diff", "--name-only", "--no-renames", "-z", str(baseline), "HEAD", "--"],
            cwd=ROOT,
            timeout=10,
        )
        .decode()
        .split("\0")
    )
    paths = [path for path in changed if path]
    approved = object_map(record["approved_changes"])
    for path in paths:
        if path == RECORD or not metadata_path(path):
            continue
        actual = (
            subprocess.check_output(["git", "ls-tree", "HEAD", "--", path], cwd=ROOT, timeout=10)
            .decode()
            .strip()
        )
        if not actual.startswith("100644 blob ") or actual != approved.get(path):
            raise ValueError("Unreviewed CI metadata change: " + path)
    return paths if all(metadata_path(path) for path in paths) else None


def verified_remote_job(job: str, record: dict[str, object]) -> dict[str, object]:
    reference = object_map(object_map(record["jobs"])[job])
    run_id = reference["run_id"]
    if not isinstance(run_id, int) or isinstance(run_id, bool) or run_id <= 0:
        raise ValueError("Invalid previous run")
    run = github_json(f"/actions/runs/{run_id}")
    expected_workflow = "User help quality" if job == "help" else "CI"
    if (
        run.get("head_sha") != record["head_sha"]
        or run.get("event") != "pull_request"
        or run.get("name") != expected_workflow
    ):
        raise ValueError("Previous run does not match the reviewed source")
    job_id = reference["job_id"]
    if not isinstance(job_id, int) or isinstance(job_id, bool) or job_id <= 0:
        raise ValueError("Invalid previous job")
    result = github_json(f"/actions/jobs/{job_id}")
    if (
        result.get("name") != job
        or result.get("status") != "completed"
        or result.get("conclusion") != "success"
    ):
        raise ValueError("Previous job is not an actual completed success")
    if result.get("id") != job_id or result.get("run_id") != run_id:
        raise ValueError("Previous job identity changed")
    return {"run_id": run_id, "job_id": job_id, "head_sha": record["head_sha"]}


def reuse(environment: Mapping[str, str]) -> dict[str, object]:
    event_path = environment.get("GITHUB_EVENT_PATH")
    if not event_path:
        return {"reused": False}
    event = object_map(json.loads(Path(event_path).read_text()))
    if not eligible(environment, event):
        return {"reused": False}
    job = environment.get("GITHUB_JOB", "")
    if job not in REUSED_JOBS:
        return {"reused": False}
    path = ROOT / RECORD
    if path.is_symlink() or not path.is_file():
        raise ValueError("Reuse metadata must be a committed regular file")
    tree_entry = subprocess.check_output(
        ["git", "ls-tree", "HEAD", "--", RECORD], cwd=ROOT, timeout=10
    ).decode()
    if not tree_entry.startswith("100644 blob "):
        raise ValueError("Reuse metadata must be a committed regular file")
    record = object_map(json.loads(path.read_text()))
    if object_map(record["jobs"]).get(job) != REUSED_JOBS[job]:
        raise ValueError("Previous successful job reference changed or missing")
    paths = changed_inputs(record)
    if paths is None:
        return {"reused": False}
    previous = verified_remote_job(job, record)
    return {"reused": True, "previous": previous, "checked_metadata_delta": paths}


def main() -> None:
    result = reuse(os.environ)
    if "--json" in sys.argv:
        print(json.dumps(result))
        return
    required = not result["reused"]
    with Path(os.environ["GITHUB_OUTPUT"]).open("a") as stream:
        stream.write(f"runtime_required={str(required).lower()}\n")
    message = (
        "Runtime execution required."
        if required
        else "Reused an actual successful remote check after verifying unchanged runtime inputs; "
        + json.dumps(result)
    )
    print(message)
    if summary := os.environ.get("GITHUB_STEP_SUMMARY"):
        with Path(summary).open("a") as stream:
            stream.write(message + "\n")


if __name__ == "__main__":
    main()
