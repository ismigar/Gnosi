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


def test_ci_documentation_gate_runs_on_every_pr_only(ci_workflow: WorkflowMapping) -> None:
    """Implementation PRs need the gate even when no docs file changes."""
    # PyYAML's YAML 1.1 loader interprets the GitHub Actions key `on` as True.
    events = workflow_mapping(ci_workflow.get("on", ci_workflow.get(True)))
    assert "pull_request" in events
    assert events["pull_request"] in (None, {})
    assert "pull_request_target" not in events
    assert workflow_mapping(events["push"])["branches"] == ["main"]
    job = workflow_job(ci_workflow, "documentation")
    assert job["if"] == "github.event_name == 'pull_request'"
    assert not job.get("continue-on-error", False)
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


def test_ci_documentation_gate_fetches_the_exact_base(ci_workflow: WorkflowMapping) -> None:
    """Full history must make an arbitrary PR base available for Git diff."""
    steps = workflow_steps(workflow_job(ci_workflow, "documentation"))
    checkout = next(
        step for step in steps
        if workflow_text(step.get("uses", "")).startswith("actions/checkout@")
    )
    checkout_settings = workflow_mapping(checkout["with"])
    assert checkout_settings["fetch-depth"] == 0
    assert checkout_settings["persist-credentials"] is False
    assert "ref" not in checkout_settings
    gate = next(step for step in steps if "pre_pr.py" in workflow_text(step.get("run", "")))
    assert workflow_mapping(gate["env"])["PR_BASE_SHA"] == "${{ github.event.pull_request.base.sha }}"
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
    assert len(commands) == 2
    assert commands[0] == "uv sync --frozen --group docs"
    assert shlex.split(commands[1].splitlines()[-1]) == [
        "uv",
        "run",
        "--frozen",
        "--group",
        "docs",
        "python",
        "pipeline/skills/technical_documentation/scripts/pre_pr.py",
        "--check-only",
        "--base-ref",
        "$PR_BASE_SHA",
    ]
    assert all("if" not in step for step in steps)


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
    assert "uv sync --frozen --group docs" in source
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
