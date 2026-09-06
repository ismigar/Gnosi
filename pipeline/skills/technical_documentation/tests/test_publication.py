"""Publication contracts for the canonical Gnosi repository."""

from pathlib import Path
import shlex
from typing import TypeAlias

import pytest
import yaml


APP_ROOT = Path(__file__).resolve().parents[4]
CI_WORKFLOW = APP_ROOT / ".github/workflows/ci.yml"
PAGES_WORKFLOW = APP_ROOT / ".github/workflows/documentation-pages.yml"
RELEASE_WORKFLOW = APP_ROOT / ".github/workflows/build-release.yml"
SIDEBAR_SOURCE = APP_ROOT / "frontend/src/app/navigation/sidebar/appSidebarModel.ts"
CANONICAL_URL = "https://gnosi.temenosismael.org/engineering/"
WorkflowMapping: TypeAlias = dict[str | bool, object]
TRUSTED_PR_IF = (
    "github.event_name != 'pull_request' || "
    "github.event.pull_request.head.repo.full_name == github.repository"
)
DOCUMENTATION_IF = (
    "(github.event_name == 'pull_request' && "
    "github.event.pull_request.head.repo.full_name == github.repository) || "
    "inputs.release_candidate"
)
CI_COMMANDS = {
    "documentation": [
        "python scripts/ci/prepare_python_environment.py",
        "uv sync --frozen --only-group docs-ci",
        'test -n "$PR_BASE_SHA"',
        'git cat-file -e "${PR_BASE_SHA}^{commit}"',
        "uv run --frozen --only-group docs-ci python "
        "pipeline/skills/technical_documentation/scripts/pre_pr.py "
        '--check-only --base-ref "$PR_BASE_SHA"',
    ],
    "frontend": [
        "python scripts/ci/prepare_python_environment.py",
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
    ],
    "backend": [
        "python scripts/ci/prepare_python_environment.py",
        "uv sync --frozen",
        "uv run python scripts/check_public_pipeline.py",
        "uv run python scripts/check_public_pipeline.py --structure",
        "uv run python scripts/check_public_runtime.py",
        "uv run ruff check backend pipeline scripts extensions/mcp/drupal-proxy",
        "uv run python scripts/check-source-guardrails.py --require-pruned",
        "uv run mypy --strict --exclude '^backend/tests/' backend",
        "uv run python scripts/check_public_pipeline.py --typecheck",
        "uv run ruff check --select E,F,I desktop/scripts/backend_resources.py "
        "desktop/tests/test_backend_resources.py",
        "uv run mypy --strict --explicit-package-bases desktop/scripts/backend_resources.py "
        "desktop/tests/test_backend_resources.py",
        "uv run python desktop/scripts/backend_resources.py check-source --repository .",
        "uv run python -m compileall -q backend pipeline scripts extensions",
        "uv run pytest",
    ],
    "native-smoke": [
        "npm install --global --ignore-scripts --no-audit --no-fund pnpm@11.19.0",
        "python scripts/ci/prepare_python_environment.py",
        "pnpm install --frozen-lockfile",
        "uv sync --frozen",
        "pnpm test:e2e:install",
        *r'''uv run --frozen --no-sync python -m uvicorn backend.server:app --host 127.0.0.1 --port 5002 > "${RUNNER_TEMP}/gnosi-backend.log" 2>&1 &
pnpm dev:frontend --host 127.0.0.1 > "${RUNNER_TEMP}/gnosi-frontend.log" 2>&1 &
if ! python scripts/ci/wait_native_services.py; then
  tail -n 200 "${RUNNER_TEMP}/gnosi-backend.log" || true
  tail -n 200 "${RUNNER_TEMP}/gnosi-frontend.log" || true
  exit 1
fi'''.splitlines(),
        "pnpm test:e2e:smoke",
    ],
    "docker": [
        "python3 scripts/ci/prepare_docker_runner.py",
        "docker compose config --quiet",
        "python3 scripts/ci/build_container_image.py --dockerfile Dockerfile.frontend "
        "--tag gnosi-frontend:ci --context .",
        "python3 scripts/ci/build_container_image.py --dockerfile Dockerfile.backend "
        "--tag gnosi-backend:ci --context .",
        "scripts/smoke_docker.sh",
        "docker system prune --all --force --volumes",
    ],
}


def workflow_mapping(value: object) -> WorkflowMapping:
    """Validate YAML mappings without dropping unknown contract fields."""
    if not isinstance(value, dict):
        raise TypeError("Expected a workflow mapping")
    entries: dict[object, object] = value
    result: WorkflowMapping = {}
    for key, item in entries.items():
        if not isinstance(key, (str, bool)):
            raise TypeError("Expected a string or YAML boolean mapping key")
        result[key] = item
    return result


def workflow_text(value: object) -> str:
    """Reject non-text commands instead of coercing invalid YAML values."""
    if not isinstance(value, str):
        raise TypeError("Expected workflow text")
    return value


def workflow_job(workflow: WorkflowMapping, name: str) -> WorkflowMapping:
    """Read a required job without supplying defaults for missing contracts."""
    return workflow_mapping(workflow_mapping(workflow["jobs"])[name])


def workflow_steps(job: WorkflowMapping) -> list[WorkflowMapping]:
    """Validate every step, including unexpected ones checked by the tests."""
    value = job["steps"]
    if not isinstance(value, list):
        raise TypeError("Expected a workflow steps list")
    entries: list[object] = value
    return [workflow_mapping(step) for step in entries]


@pytest.fixture
def ci_workflow() -> WorkflowMapping:
    """Read the CI contract without importing application runtime modules."""
    return workflow_mapping(yaml.safe_load(CI_WORKFLOW.read_text(encoding="utf-8")))


@pytest.mark.parametrize("job_name", ["documentation", "backend", "frontend", "native-smoke"])
@pytest.mark.parametrize(
    ("name", "expected"),
    [("UV_CONCURRENT_DOWNLOADS", "4"), ("UV_HTTP_TIMEOUT", "180"), ("UV_HTTP_RETRIES", "5")],
)
def test_ci_python_downloads_have_bounded_network_policy(
    ci_workflow: WorkflowMapping, job_name: str, name: str, expected: str,
) -> None:
    """Cold installs tolerate short network stalls without changing test limits."""
    assert workflow_mapping(ci_workflow["env"])[name] == expected
    job = workflow_job(ci_workflow, job_name)
    assert name not in workflow_mapping(job.get("env", {}))
    for step in workflow_steps(job):
        assert name not in workflow_mapping(step.get("env", {}))


def test_ci_documentation_gate_runs_on_every_pr_and_candidate(
    ci_workflow: WorkflowMapping,
) -> None:
    """Reusable CI retains its caller event, so candidate docs need an explicit input."""
    # PyYAML's YAML 1.1 loader interprets the GitHub Actions key `on` as True.
    events = workflow_mapping(ci_workflow.get("on", ci_workflow.get(True)))
    assert "pull_request" in events
    assert events["pull_request"] in (None, {})
    assert "pull_request_target" not in events
    assert workflow_mapping(events["push"])["branches"] == ["main"]
    call = workflow_mapping(events["workflow_call"])
    assert "secrets" not in call
    inputs = workflow_mapping(call["inputs"])
    assert set(inputs) == {"release_candidate"}
    candidate = workflow_mapping(inputs["release_candidate"])
    assert candidate["type"] == "boolean"
    assert candidate["default"] is False
    assert candidate.get("required", False) is False
    job = workflow_job(ci_workflow, "documentation")
    assert job["if"] == DOCUMENTATION_IF
    assert "continue-on-error" not in job
    assert "needs" not in job


def test_ci_documentation_gate_has_no_write_authority(ci_workflow: WorkflowMapping) -> None:
    """Fork PR validation must not gain secrets or publication permissions."""
    job = workflow_job(ci_workflow, "documentation")
    steps = workflow_steps(job)
    assert ci_workflow["permissions"] == {"contents": "read"}
    assert job["permissions"] == {"contents": "read"}
    assert "environment" not in job
    assert "secrets" not in yaml.safe_dump(job)
    actions = {
        workflow_text(step["uses"]).split("@", 1)[0] for step in steps if "uses" in step
    }
    assert actions == {
        "actions/checkout",
        "actions/setup-python",
        "astral-sh/setup-uv",
    }
    assert all("${{" not in workflow_text(step.get("run", "")) for step in steps)
    assert all(not step.get("continue-on-error", False) for step in steps)


def test_ci_documentation_gate_fetches_the_exact_base_or_candidate_sha(
    ci_workflow: WorkflowMapping,
) -> None:
    """PRs use their exact base; tag/manual candidates check catalogs at their own SHA."""
    steps = workflow_steps(workflow_job(ci_workflow, "documentation"))
    checkout = next(
        step for step in steps
        if workflow_text(step.get("uses", "")).startswith("actions/checkout@")
    )
    checkout_settings = workflow_mapping(checkout["with"])
    assert checkout_settings["fetch-depth"] == 0
    assert checkout_settings["persist-credentials"] is False
    assert checkout_settings["ref"] == "${{ github.sha }}"
    gate = next(step for step in steps if "pre_pr.py" in workflow_text(step.get("run", "")))
    assert workflow_mapping(gate["env"])["PR_BASE_SHA"] == (
        "${{ github.event.pull_request.base.sha || github.sha }}"
    )
    commands = workflow_text(gate["run"]).splitlines()
    assert commands[:2] == [
        'test -n "$PR_BASE_SHA"',
        'git cat-file -e "${PR_BASE_SHA}^{commit}"',
    ]
    assert commands[-1].endswith('--base-ref "$PR_BASE_SHA"')


def test_ci_documentation_gate_uses_frozen_docs_and_check_only(
    ci_workflow: WorkflowMapping,
) -> None:
    """CI must keep docs dependencies and reject stale catalogs without repairs."""
    steps = workflow_steps(workflow_job(ci_workflow, "documentation"))
    python = next(
        step for step in steps
        if workflow_text(step.get("uses", "")).startswith("actions/setup-python@")
    )
    uv = next(
        step for step in steps
        if workflow_text(step.get("uses", "")).startswith("astral-sh/setup-uv@")
    )
    assert workflow_mapping(python["with"])["python-version"] == "3.11"
    assert workflow_mapping(uv["with"])["version"] == "0.9.15"
    commands = [workflow_text(step["run"]) for step in steps if "run" in step]
    assert len(commands) == 3
    assert commands[:2] == [
        "python scripts/ci/prepare_python_environment.py",
        "uv sync --frozen --only-group docs-ci",
    ]
    assert shlex.split(commands[2].splitlines()[-1]) == [
        "uv",
        "run",
        "--frozen",
        "--only-group",
        "docs-ci",
        "python",
        "pipeline/skills/technical_documentation/scripts/pre_pr.py",
        "--check-only",
        "--base-ref",
        "$PR_BASE_SHA",
    ]
    assert all("if" not in step for step in steps)


def test_ci_preserves_all_five_jobs_commands_and_fatal_gates(
    ci_workflow: WorkflowMapping,
) -> None:
    """The reusable entry point must retain the existing CI checks, in order."""
    jobs = workflow_mapping(ci_workflow["jobs"])
    assert set(jobs) == set(CI_COMMANDS)
    for name, expected_commands in CI_COMMANDS.items():
        job = workflow_job(ci_workflow, name)
        assert "uses" not in job
        predecessor = {"frontend": "backend", "docker": "frontend"}.get(name)
        if predecessor:
            assert job.get("needs") == predecessor
        else:
            assert "needs" not in job
        assert "continue-on-error" not in job
        assert job.get("if") == (
            DOCUMENTATION_IF if name == "documentation" else
            f"!cancelled() && ({TRUSTED_PR_IF})" if predecessor else TRUSTED_PR_IF
        )
        steps = workflow_steps(job)
        assert all("continue-on-error" not in step for step in steps)
        conditional_steps = [step for step in steps if "if" in step]
        if name == "docker":
            assert conditional_steps == [steps[-1]]
            assert steps[-1]["if"] == "always()"
        else:
            assert conditional_steps == []
        commands = [
            line for step in steps if "run" in step
            for line in workflow_text(step["run"]).splitlines()
        ]
        assert commands == expected_commands, name


def test_ci_checks_out_caller_sha_without_credentials_in_every_job(
    ci_workflow: WorkflowMapping,
) -> None:
    """All five checks validate the caller source, including manual and tag builds."""
    assert set(workflow_mapping(ci_workflow["jobs"])) == set(CI_COMMANDS)
    for name in CI_COMMANDS:
        steps = workflow_steps(workflow_job(ci_workflow, name))
        checkouts = [
            step for step in steps
            if workflow_text(step.get("uses", "")).startswith("actions/checkout@")
        ]
        assert len(checkouts) == 1, name
        assert checkouts[0] == steps[0], name
        settings = workflow_mapping(checkouts[0]["with"])
        assert settings["ref"] == "${{ github.sha }}", name
        assert settings["persist-credentials"] is False, name
        if name == "documentation":
            assert settings["fetch-depth"] == 0
        else:
            assert settings["submodules"] == "recursive", name


@pytest.mark.parametrize("condition", [
    "github.event_name == 'pull_request'",
    "github.event_name == 'pull_request' || github.event_name == 'workflow_call'",
    "github.event_name == 'pull_request' || github.event_name == 'push'",
    "inputs.release_candidate",
    "always()",
])
def test_candidate_documentation_rejects_caller_event_shortcuts(
    ci_workflow: WorkflowMapping, condition: str,
) -> None:
    """workflow_call is a declaration, not the event seen by a reused workflow."""
    test_ci_documentation_gate_runs_on_every_pr_and_candidate(ci_workflow)
    jobs = workflow_mapping(ci_workflow["jobs"])
    job = workflow_job(ci_workflow, "documentation")
    job["if"] = condition
    jobs["documentation"] = job
    ci_workflow["jobs"] = jobs
    with pytest.raises(AssertionError):
        test_ci_documentation_gate_runs_on_every_pr_and_candidate(ci_workflow)


@pytest.mark.parametrize("name", CI_COMMANDS)
@pytest.mark.parametrize("condition", [
    None,
    "github.event_name == 'pull_request'",
    "github.event_name != 'pull_request'",
    "github.event.pull_request.head.repo.full_name == github.repository",
    "always()",
])
def test_ci_rejects_fork_guard_removal_or_weakening(
    ci_workflow: WorkflowMapping, name: str, condition: str | None,
) -> None:
    """Public fork code must never reach an owner self-hosted runner."""
    test_ci_preserves_all_five_jobs_commands_and_fatal_gates(ci_workflow)
    job = workflow_job(ci_workflow, name)
    if condition is None:
        del job["if"]
    else:
        job["if"] = condition
    jobs = workflow_mapping(ci_workflow["jobs"])
    jobs[name] = job
    ci_workflow["jobs"] = jobs
    with pytest.raises(AssertionError):
        test_ci_preserves_all_five_jobs_commands_and_fatal_gates(ci_workflow)


@pytest.mark.parametrize("base", [
    "${{ github.event.pull_request.base.sha }}",
    "${{ github.sha }}",
    "${{ github.event.pull_request.base.sha || inputs.tag }}",
    "origin/main",
])
def test_candidate_documentation_rejects_missing_or_moving_base(
    ci_workflow: WorkflowMapping, base: str,
) -> None:
    """Neither candidate builds nor PRs may lose their exact comparison source."""
    test_ci_documentation_gate_fetches_the_exact_base_or_candidate_sha(ci_workflow)
    job = workflow_job(ci_workflow, "documentation")
    steps = workflow_steps(job)
    gate = next(step for step in steps if "pre_pr.py" in workflow_text(step.get("run", "")))
    gate["env"] = {"PR_BASE_SHA": base}
    job["steps"] = steps
    jobs = workflow_mapping(ci_workflow["jobs"])
    jobs["documentation"] = job
    ci_workflow["jobs"] = jobs
    with pytest.raises(AssertionError):
        test_ci_documentation_gate_fetches_the_exact_base_or_candidate_sha(ci_workflow)


@pytest.mark.parametrize("name", CI_COMMANDS)
@pytest.mark.parametrize("field,value", [
    ("ref", "${{ inputs.tag }}"),
    ("ref", "main"),
    ("ref", "${{ github.event.pull_request.head.sha }}"),
    ("persist-credentials", True),
])
def test_ci_rejects_checkout_source_or_credential_regressions(
    ci_workflow: WorkflowMapping, name: str, field: str, value: object,
) -> None:
    """Every CI checkout must reject tag/branch drift and retained credentials."""
    test_ci_checks_out_caller_sha_without_credentials_in_every_job(ci_workflow)
    job = workflow_job(ci_workflow, name)
    steps = workflow_steps(job)
    settings = workflow_mapping(steps[0]["with"])
    settings[field] = value
    steps[0]["with"] = settings
    job["steps"] = steps
    jobs = workflow_mapping(ci_workflow["jobs"])
    jobs[name] = job
    ci_workflow["jobs"] = jobs
    with pytest.raises(AssertionError):
        test_ci_checks_out_caller_sha_without_credentials_in_every_job(ci_workflow)


@pytest.mark.parametrize("name", CI_COMMANDS)
def test_ci_rejects_removed_or_softened_commands(
    ci_workflow: WorkflowMapping, name: str,
) -> None:
    """A missing check or a swallowed exit status is not equivalent validation."""
    test_ci_preserves_all_five_jobs_commands_and_fatal_gates(ci_workflow)
    original_steps = workflow_steps(workflow_job(ci_workflow, name))
    for index, step in enumerate(original_steps):
        if "run" not in step:
            continue
        for replacement in (None, workflow_text(step["run"]).rstrip() + " || true"):
            changed_steps = [dict(entry) for entry in original_steps]
            if replacement is None:
                del changed_steps[index]
            else:
                changed_steps[index]["run"] = replacement
            job = workflow_job(ci_workflow, name)
            job["steps"] = changed_steps
            jobs = workflow_mapping(ci_workflow["jobs"])
            jobs[name] = job
            ci_workflow["jobs"] = jobs
            with pytest.raises(AssertionError):
                test_ci_preserves_all_five_jobs_commands_and_fatal_gates(ci_workflow)


@pytest.mark.parametrize("field,value", [
    ("permissions", {"contents": "write"}),
    ("environment", "production"),
    ("new-setting", {"value": "${{ secrets.FIXTURE_TOKEN }}"}),
])
def test_typed_workflow_keeps_unsafe_job_fields_visible(
    ci_workflow: WorkflowMapping, field: str, value: object,
) -> None:
    """Typed fixture views must not filter away publication security violations."""
    job = workflow_job(ci_workflow, "documentation")
    job[field] = value
    ci_workflow["jobs"] = {"documentation": job}

    with pytest.raises(AssertionError):
        test_ci_documentation_gate_has_no_write_authority(ci_workflow)


@pytest.mark.parametrize("step", [
    {"uses": "unapproved/action@v1"},
    {"run": "echo ${{ github.event.pull_request.title }}"},
    {"run": "exit 1", "continue-on-error": True},
])
def test_typed_workflow_keeps_every_step_for_security_checks(
    ci_workflow: WorkflowMapping, step: WorkflowMapping,
) -> None:
    """Unexpected steps cannot disappear during conversion to typed mappings."""
    job = workflow_job(ci_workflow, "documentation")
    job["steps"] = [*workflow_steps(job), step]
    ci_workflow["jobs"] = {"documentation": job}

    with pytest.raises(AssertionError):
        test_ci_documentation_gate_has_no_write_authority(ci_workflow)


@pytest.mark.parametrize("value", [
    None,
    {"run": "echo fixture"},
    [None],
    [{42: "unexpected key"}],
    [{"uses": 42}],
    [{"run": False}],
])
def test_typed_workflow_rejects_malformed_security_inputs(
    ci_workflow: WorkflowMapping, value: object,
) -> None:
    """Invalid YAML must fail validation rather than be coerced or skipped."""
    job = workflow_job(ci_workflow, "documentation")
    job["steps"] = [*workflow_steps(job), *value] if isinstance(value, list) else value
    ci_workflow["jobs"] = {"documentation": job}

    with pytest.raises(TypeError):
        test_ci_documentation_gate_has_no_write_authority(ci_workflow)


def test_pages_workflow_publishes_from_the_canonical_root() -> None:
    """Documentation is built directly from Gnosi, without a mirror path."""
    source = PAGES_WORKFLOW.read_text(encoding="utf-8")
    workflow = workflow_mapping(yaml.safe_load(source))

    assert "apps/gnosi" not in source
    assert "monorepo" not in source
    assert "uv sync --frozen --only-group docs" in source
    assert "uv run --frozen --only-group docs" in source
    assert workflow["permissions"] == {
        "contents": "read",
        "pages": "write",
        "id-token": "write",
    }
    assert workflow_job(workflow, "deploy")["needs"] == "build"
    upload_step = next(
        step
        for step in workflow_steps(workflow_job(workflow, "build"))
        if workflow_text(step.get("uses", "")).startswith("actions/upload-pages-artifact@")
    )
    assert workflow_mapping(upload_step["with"])["path"] == "site"


def test_pages_localization_check_is_fatal_read_only_and_precedes_builds() -> None:
    """Publishing must reject stale translations before creating its artifact."""
    workflow = workflow_mapping(yaml.safe_load(PAGES_WORKFLOW.read_text(encoding="utf-8")))
    job = workflow_job(workflow, "build")
    assert "if" not in job and "continue-on-error" not in job
    steps = workflow_steps(job)
    checks = [
        (index, step) for index, step in enumerate(steps)
        if "localize.py" in workflow_text(step.get("run", ""))
    ]
    assert len(checks) == 1
    index, check = checks[0]
    assert "if" not in check and "continue-on-error" not in check
    assert workflow_text(check["run"]) == (
        "uv run --frozen --only-group docs python "
        "pipeline/skills/technical_documentation/scripts/localize.py --check"
    )
    builds = [
        position for position, step in enumerate(steps)
        if "mkdocs build" in workflow_text(step.get("run", ""))
    ]
    assert builds and all(index < position for position in builds)
    uploads = [
        position for position, step in enumerate(steps)
        if workflow_text(step.get("uses", "")).startswith("actions/upload-pages-artifact@")
    ]
    assert len(uploads) == 1 and max(builds) < uploads[0]


def test_sidebar_uses_the_canonical_public_url() -> None:
    """The in-app entry and MkDocs canonical URL remain aligned."""
    mkdocs_config = (APP_ROOT / "mkdocs.yml").read_text(encoding="utf-8")
    sidebar_source = SIDEBAR_SOURCE.read_text(encoding="utf-8")

    assert f"site_url: {CANONICAL_URL}" in mkdocs_config
    assert CANONICAL_URL in sidebar_source


def test_release_uses_frozen_toolchains_and_desktop_paths() -> None:
    """Release jobs package the canonical commit with pnpm and uv locks."""
    source = RELEASE_WORKFLOW.read_text(encoding="utf-8")
    workflow = workflow_mapping(yaml.safe_load(source))

    assert "apps/gnosi" not in source
    assert "monorepo" not in source
    assert "electron/dist" not in source
    assert "desktop/dist/latest-mac.yml" in source
    assert "desktop/dist/latest-linux-arm64.yml" in source
    assert "desktop/dist/latest.yml" in source
    assert "pnpm install --frozen-lockfile" in source
    assert "node-version: '22.22.2'" in source
    assert "uses: astral-sh/setup-uv@v10" in source
    assert workflow_mapping(workflow_job(workflow, "build-macos")["strategy"])["max-parallel"] == 1
    windows_needs = workflow_job(workflow, "build-windows")["needs"]
    if not isinstance(windows_needs, (str, list)):
        raise TypeError("Expected a job name or list of job names")
    assert "build-macos" in windows_needs
