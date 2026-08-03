"""Publication contract tests for the public engineering portal."""

from pathlib import Path

import yaml


APP_ROOT = Path(__file__).resolve().parents[4]
PUBLIC_REPOSITORY_ROOT = APP_ROOT.parents[1]
PRIVATE_REPOSITORY_ROOT = PUBLIC_REPOSITORY_ROOT.parent
PAGES_WORKFLOW = (
    PUBLIC_REPOSITORY_ROOT / ".github" / "workflows" / "documentation-pages.yml"
)
DOCUMENTATION_CI_WORKFLOW = (
    PRIVATE_REPOSITORY_ROOT / ".github" / "workflows" / "documentation.yml"
)
SIDEBAR_SOURCE = APP_ROOT / "frontend" / "src" / "components" / "AppSidebar.jsx"
CANONICAL_URL = "https://gnosi.temenosismael.org/engineering/"
ENGINEERING_CSS = APP_ROOT / "docs" / "engineering" / "assets" / "engineering.css"
MERMAID_INIT = APP_ROOT / "docs" / "engineering" / "assets" / "mermaid-init.js"
LANGUAGE_SWITCHER = (
    APP_ROOT / "docs" / "engineering" / "assets" / "language-switcher.js"
)
SITE_SHELL_TEMPLATE = APP_ROOT / "docs" / "engineering-overrides" / "main.html"


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
    step_names = {step.get("name") for step in build_steps}
    assert "Verify generated reference" not in step_names
    assert "Validate traceability and links" in step_names
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


def test_engineering_portal_uses_gnosi_brand_tokens():
    """The standalone portal keeps Gnosi's primary and muted visual language."""
    css = ENGINEERING_CSS.read_text(encoding="utf-8")
    mermaid = MERMAID_INIT.read_text(encoding="utf-8")

    assert "--md-primary-fg-color: #3b82f6" in css
    assert 'primaryColor: "#f3f4f6"' in mermaid
    assert 'primaryColor: "#27272a"' in mermaid


def test_engineering_portal_reuses_the_localized_public_site_shell():
    """Every locale must render the shared Gnosi header and footer override."""
    template = SITE_SHELL_TEMPLATE.read_text(encoding="utf-8")
    switcher = LANGUAGE_SWITCHER.read_text(encoding="utf-8")

    for config_name in ("mkdocs.yml", "mkdocs-ca.yml", "mkdocs-es.yml"):
        config = (APP_ROOT / config_name).read_text(encoding="utf-8")
        assert "custom_dir: docs/engineering-overrides" in config

    assert 'class="gnosi-site-header"' in template
    assert 'class="gnosi-site-footer"' in template
    assert '"en": {' in template
    assert '"ca": {' in template
    assert '"es": {' in template
    assert "--gnosi-site-bg: #f6f3ec" in template
    assert '"Iowan Old Style"' in template
    assert '.gnosi-site-header__languages' in switcher


def test_engineering_portal_keeps_wide_content_and_navigation_responsive():
    """Compact layouts keep navigation reachable and wide content contained."""
    template = SITE_SHELL_TEMPLATE.read_text(encoding="utf-8")

    assert "min-height: 2.75rem" in template
    assert "min-width: 2.75rem" in template
    assert "overscroll-behavior-inline: contain" in template
    assert ".md-typeset__table" in template
    assert ".md-typeset .mermaid" in template
    assert "--gnosi-site-header-height: 7rem" in template
    assert "@media (prefers-reduced-motion: reduce)" in template


def test_private_ci_validates_public_workflow_changes():
    """Pages workflow edits must trigger the private documentation checks."""
    private_workflow = DOCUMENTATION_CI_WORKFLOW.read_text(encoding="utf-8")

    assert '"monorepo/.github/workflows/documentation-pages.yml"' in private_workflow
