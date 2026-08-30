"""Publication contracts for the canonical Gnosi repository."""

from pathlib import Path
import shlex

import pytest
import yaml


APP_ROOT = Path(__file__).resolve().parents[4]
CI_WORKFLOW = APP_ROOT / ".github/workflows/ci.yml"
PAGES_WORKFLOW = APP_ROOT / ".github/workflows/documentation-pages.yml"
RELEASE_WORKFLOW = APP_ROOT / ".github/workflows/build-release.yml"
SIDEBAR_SOURCE = APP_ROOT / "frontend/src/app/navigation/sidebar/appSidebarModel.ts"
CANONICAL_URL = "https://gnosi.temenosismael.org/engineering/"


@pytest.fixture
def ci_workflow() -> dict:
    """Read the CI contract without importing application runtime modules."""
    return yaml.safe_load(CI_WORKFLOW.read_text(encoding="utf-8"))


def test_ci_documentation_gate_runs_on_every_pr_only(ci_workflow: dict) -> None:
    """Implementation PRs need the gate even when no docs file changes."""
    # PyYAML's YAML 1.1 loader interprets the GitHub Actions key `on` as True.
    events = ci_workflow.get("on", ci_workflow.get(True))
    assert "pull_request" in events
    assert events["pull_request"] in (None, {})
    assert "pull_request_target" not in events
    assert events["push"]["branches"] == ["main"]
    job = ci_workflow["jobs"]["documentation"]
    assert job["if"] == "github.event_name == 'pull_request'"
    assert not job.get("continue-on-error", False)
    assert "needs" not in job


def test_ci_documentation_gate_has_no_write_authority(ci_workflow: dict) -> None:
    """Fork PR validation must not gain secrets or publication permissions."""
    job = ci_workflow["jobs"]["documentation"]
    assert ci_workflow["permissions"] == {"contents": "read"}
    assert job["permissions"] == {"contents": "read"}
    assert "environment" not in job
    assert "secrets" not in yaml.safe_dump(job)
    actions = {
        step["uses"].split("@", 1)[0] for step in job["steps"] if "uses" in step
    }
    assert actions == {
        "actions/checkout",
        "actions/setup-python",
        "astral-sh/setup-uv",
    }
    assert all("${{" not in step.get("run", "") for step in job["steps"])
    assert all(not step.get("continue-on-error", False) for step in job["steps"])


def test_ci_documentation_gate_fetches_the_exact_base(ci_workflow: dict) -> None:
    """Full history must make an arbitrary PR base available for Git diff."""
    steps = ci_workflow["jobs"]["documentation"]["steps"]
    checkout = next(
        step for step in steps if step.get("uses", "").startswith("actions/checkout@")
    )
    assert checkout["with"]["fetch-depth"] == 0
    assert checkout["with"]["persist-credentials"] is False
    assert "ref" not in checkout["with"]
    gate = next(step for step in steps if "pre_pr.py" in step.get("run", ""))
    assert gate["env"]["PR_BASE_SHA"] == "${{ github.event.pull_request.base.sha }}"
    commands = gate["run"].splitlines()
    assert commands[:2] == [
        'test -n "$PR_BASE_SHA"',
        'git cat-file -e "${PR_BASE_SHA}^{commit}"',
    ]
    assert commands[-1].endswith('--base-ref "$PR_BASE_SHA"')


def test_ci_documentation_gate_uses_frozen_docs_and_check_only(ci_workflow: dict) -> None:
    """CI must keep docs dependencies and reject stale catalogs without repairs."""
    steps = ci_workflow["jobs"]["documentation"]["steps"]
    python = next(
        step for step in steps if step.get("uses", "").startswith("actions/setup-python@")
    )
    uv = next(
        step for step in steps if step.get("uses", "").startswith("astral-sh/setup-uv@")
    )
    assert python["with"]["python-version"] == "3.11"
    assert uv["with"]["version"] == "0.9.15"
    commands = [step["run"] for step in steps if "run" in step]
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


def test_pages_workflow_publishes_from_the_canonical_root() -> None:
    """Documentation is built directly from Gnosi, without a mirror path."""
    source = PAGES_WORKFLOW.read_text(encoding="utf-8")
    workflow = yaml.safe_load(source)

    assert "apps/gnosi" not in source
    assert "monorepo" not in source
    assert "uv sync --frozen --group docs" in source
    assert workflow["permissions"] == {
        "contents": "read",
        "pages": "write",
        "id-token": "write",
    }
    assert workflow["jobs"]["deploy"]["needs"] == "build"
    upload_step = next(
        step
        for step in workflow["jobs"]["build"]["steps"]
        if step.get("uses", "").startswith("actions/upload-pages-artifact@")
    )
    assert upload_step["with"]["path"] == "site"


def test_sidebar_uses_the_canonical_public_url() -> None:
    """The in-app entry and MkDocs canonical URL remain aligned."""
    mkdocs_config = (APP_ROOT / "mkdocs.yml").read_text(encoding="utf-8")
    sidebar_source = SIDEBAR_SOURCE.read_text(encoding="utf-8")

    assert f"site_url: {CANONICAL_URL}" in mkdocs_config
    assert CANONICAL_URL in sidebar_source


def test_release_uses_frozen_toolchains_and_desktop_paths() -> None:
    """Release jobs package the canonical commit with pnpm and uv locks."""
    source = RELEASE_WORKFLOW.read_text(encoding="utf-8")
    workflow = yaml.safe_load(source)

    assert "apps/gnosi" not in source
    assert "monorepo" not in source
    assert "electron/dist" not in source
    assert "desktop/dist/latest-mac.yml" in source
    assert "desktop/dist/latest-linux-arm64.yml" in source
    assert "desktop/dist/latest.yml" in source
    assert "pnpm install --frozen-lockfile" in source
    assert "node-version: '22.22.2'" in source
    assert "uses: astral-sh/setup-uv@v10" in source
    assert workflow["jobs"]["build-macos"]["strategy"]["max-parallel"] == 1
    assert "build-macos" in workflow["jobs"]["build-windows"]["needs"]
