"""Publication contract tests for the public engineering portal."""

from pathlib import Path

import yaml


APP_ROOT = Path(__file__).resolve().parents[4]
PUBLIC_REPOSITORY_ROOT = APP_ROOT.parents[1]
PAGES_WORKFLOW = (
    PUBLIC_REPOSITORY_ROOT / ".github" / "workflows" / "documentation-pages.yml"
)
SIDEBAR_SOURCE = APP_ROOT / "frontend" / "src" / "components" / "AppSidebar.jsx"
CANONICAL_URL = "https://gnosi.temenosismael.org/engineering/"


def test_pages_workflow_publishes_the_engineering_subdirectory():
    """The synchronized public workflow must preserve the canonical URL path."""
    workflow = yaml.safe_load(PAGES_WORKFLOW.read_text(encoding="utf-8"))

    assert workflow["permissions"] == {
        "contents": "read",
        "pages": "write",
        "id-token": "write",
    }
    assert workflow["jobs"]["deploy"]["needs"] == "build"

    build_steps = workflow["jobs"]["build"]["steps"]
    upload_step = next(
        step for step in build_steps if step.get("uses", "").startswith(
            "actions/upload-pages-artifact@"
        )
    )
    assert upload_step["with"]["path"] == "apps/gnosi/site"


def test_sidebar_uses_the_canonical_public_url():
    """The application access point and MkDocs canonical URL must not drift."""
    mkdocs_config = (APP_ROOT / "mkdocs.yml").read_text(encoding="utf-8")
    sidebar_source = SIDEBAR_SOURCE.read_text(encoding="utf-8")

    assert f"site_url: {CANONICAL_URL}" in mkdocs_config
    assert CANONICAL_URL in sidebar_source
