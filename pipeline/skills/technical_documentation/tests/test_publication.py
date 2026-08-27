"""Publication contracts for the canonical Gnosi repository."""

from pathlib import Path

import yaml


APP_ROOT = Path(__file__).resolve().parents[4]
PAGES_WORKFLOW = APP_ROOT / ".github/workflows/documentation-pages.yml"
RELEASE_WORKFLOW = APP_ROOT / ".github/workflows/build-release.yml"
SIDEBAR_SOURCE = APP_ROOT / "frontend/src/components/AppSidebar.jsx"
CANONICAL_URL = "https://gnosi.temenosismael.org/engineering/"


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
    assert "desktop/dist/latest-linux.yml" in source
    assert "desktop/dist/latest.yml" in source
    assert "pnpm install --frozen-lockfile" in source
    assert "node-version: '22.22.2'" in source
    assert "uses: astral-sh/setup-uv@v10" in source
    assert workflow["jobs"]["build-macos"]["strategy"]["max-parallel"] == 1
    assert "build-macos" in workflow["jobs"]["build-windows"]["needs"]
