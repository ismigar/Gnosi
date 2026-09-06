"""Keep CI scheduling bounded and native setup independent of remote caches."""

from pathlib import Path

import pytest
import yaml


REPOSITORY = Path(__file__).resolve().parents[2]


def _mapping(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    assert all(isinstance(key, str) for key in value)
    return value


@pytest.fixture
def workflow() -> dict[str, object]:
    source = (REPOSITORY / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    document: object = yaml.safe_load(source)
    assert isinstance(document, dict)
    # PyYAML interprets the unquoted Actions event key "on" as a YAML 1.1 bool.
    return _mapping({key: value for key, value in document.items() if key is not True})


def test_only_pull_requests_cancel_older_runs(workflow: dict[str, object]) -> None:
    concurrency = _mapping(workflow["concurrency"])
    assert concurrency["cancel-in-progress"] == "${{ github.event_name == 'pull_request' }}"


def test_concurrency_is_unique_by_workflow_and_pr_or_non_pr_run(
    workflow: dict[str, object],
) -> None:
    concurrency = _mapping(workflow["concurrency"])
    assert concurrency["group"] == (
        "gnosi-ci-${{ github.workflow }}-"
        "${{ github.event_name == 'pull_request' && "
        "github.event.pull_request.number || github.run_id }}"
    )
    # The reusable workflow must not collide with the release caller's lock.
    release = _mapping(yaml.safe_load(
        (REPOSITORY / ".github/workflows/build-release.yml").read_text(encoding="utf-8"),
    )["concurrency"])
    assert release == {"group": "release-${{ github.ref }}", "cancel-in-progress": False}


def test_backend_hosted_capacity_is_limited_to_public_prs(
    workflow: dict[str, object],
) -> None:
    backend = _mapping(_mapping(workflow["jobs"])["backend"])
    assert backend["runs-on"] == (
        "${{ fromJSON(github.event_name == 'pull_request' && "
        "github.event.repository.visibility == 'public' && "
        "'[\"ubuntu-24.04-arm\"]' || '[\"self-hosted\", \"Linux\", \"ARM64\"]') }}"
    )
    assert "needs" not in backend


@pytest.mark.parametrize("job_name", ["native-smoke", "docker"])
def test_local_linux_jobs_keep_their_dedicated_runner(
    workflow: dict[str, object], job_name: str,
) -> None:
    job = _mapping(_mapping(workflow["jobs"])[job_name])
    assert job["runs-on"] == ["self-hosted", "Linux", "ARM64"]


def test_all_gates_and_bounded_native_order_are_preserved(
    workflow: dict[str, object],
) -> None:
    jobs = _mapping(workflow["jobs"])
    assert set(jobs) == {"backend", "frontend", "native-smoke", "docker", "documentation"}
    assert _mapping(jobs["frontend"])["needs"] == "backend"
    assert _mapping(jobs["docker"])["needs"] == "frontend"
    assert "needs" not in _mapping(jobs["native-smoke"])
    for name in ("frontend", "docker"):
        assert "!cancelled()" in str(_mapping(jobs[name])["if"])


def test_extra_capacity_does_not_expand_permissions_or_fork_access(
    workflow: dict[str, object],
) -> None:
    assert workflow["permissions"] == {"contents": "read"}
    backend = _mapping(_mapping(workflow["jobs"])["backend"])
    assert backend["if"] == (
        "github.event_name != 'pull_request' || "
        "github.event.pull_request.head.repo.full_name == github.repository"
    )
    steps = backend["steps"]
    assert isinstance(steps, list)
    checkout = _mapping(steps[0])
    assert _mapping(checkout["with"])["persist-credentials"] is False
    assert _mapping(checkout["with"])["ref"] == "${{ github.sha }}"
    assert {"run": "uv run pytest"} in steps


def test_self_hosted_frontend_disables_remote_package_cache(
    workflow: dict[str, object],
) -> None:
    frontend = _mapping(_mapping(workflow["jobs"])["frontend"])
    assert frontend["runs-on"] == ["self-hosted", "macOS", "ARM64"]
    steps = frontend["steps"]
    assert isinstance(steps, list)
    node_steps = [
        _mapping(step) for step in steps
        if str(_mapping(step).get("uses", "")).startswith("actions/setup-node@")
    ]
    assert len(node_steps) == 1
    node_inputs = _mapping(node_steps[0]["with"])
    assert node_inputs["node-version"] == "22.22.2"
    assert not node_inputs.get("cache")
    assert node_inputs["package-manager-cache"] is False
    assert not any(
        str(_mapping(step).get("uses", "")).startswith("actions/cache")
        for step in steps
    )


def test_frontend_without_remote_cache_keeps_frozen_install_and_all_checks(
    workflow: dict[str, object],
) -> None:
    frontend = _mapping(_mapping(workflow["jobs"])["frontend"])
    steps = frontend["steps"]
    assert isinstance(steps, list)
    commands = {
        str(_mapping(step)["run"]): _mapping(step)
        for step in steps if "run" in _mapping(step)
    }
    required_commands = {
        "pnpm install --frozen-lockfile",
        "uv sync --frozen",
        "pnpm check:api-client",
        "pnpm guardrails:frontend",
        "pnpm lint:frontend",
        "pnpm --filter @gnosi/frontend typecheck",
        "pnpm test:e2e:contracts",
        "pnpm test:frontend",
        "pnpm build:frontend",
        "pnpm test:desktop",
        "pnpm --filter @gnosi/desktop typecheck:ipc",
    }
    assert required_commands <= commands.keys()
    for command in required_commands:
        assert "if" not in commands[command]
        assert not commands[command].get("continue-on-error")
