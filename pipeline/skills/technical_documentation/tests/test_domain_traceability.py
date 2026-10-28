"""Regression guards for explicit frontend feature documentation ownership."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pipeline.skills.technical_documentation.scripts.domain_coverage import (
    DomainCoverage,
    load_domains,
    matches_for_globs,
    untraced_frontend_features,
)
from pipeline.skills.technical_documentation.scripts.generate import build_coverage_catalog
from pipeline.skills.technical_documentation.scripts.validate import validate_domains

APP_ROOT = Path(__file__).resolve().parents[4]


def write_file(root: Path, relative: str, content: str = "export const value = 1;\n") -> Path:
    """Create an inert owned-source or documentation fixture."""
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path


@pytest.mark.parametrize("ancestor", ["", "tests", "vendor", ".tmp"])
def test_new_feature_requires_production_source_ownership(
    tmp_path: Path, ancestor: str,
) -> None:
    """A previously covered catalog must reject a newly unowned feature module."""
    root = tmp_path / ancestor / "app"
    write_file(root, "backend/server.py", "raise RuntimeError('never import runtime')\n")
    write_file(root, "docs/engineering/domains/core.md", "# Core\n")
    domain: DomainCoverage = {
        "id": "core", "name": "Core", "guide": "docs/engineering/domains/core.md",
        "source_globs": ["backend/server.py"], "test_globs": [], "directives": [],
    }
    config = write_file(root, "domains.json", json.dumps([domain]))
    catalog = build_coverage_catalog(root, root, config)
    assert "**covered**" in catalog
    assert "File presence proves traceability, not behavior." in catalog
    assert validate_domains(config, root) == []

    source = write_file(root, "frontend/src/features/future/Screen.tsx")
    test = write_file(root, "frontend/src/features/future/Screen.test.tsx")
    domain["source_globs"].append(test.relative_to(root).as_posix())
    config.write_text(json.dumps([domain]), encoding="utf-8")
    assert untraced_frontend_features(root, [domain]) == ["future"]
    with pytest.raises(ValueError, match="missing domain source traceability: future"):
        build_coverage_catalog(root, root, config)
    assert any(
        "features/future has no production source" in error
        for error in validate_domains(config, root)
    )

    domain["source_globs"].append(source.relative_to(root).as_posix())
    domain["test_globs"].append(test.relative_to(root).as_posix())
    config.write_text(json.dumps([domain]), encoding="utf-8")
    assert untraced_frontend_features(root, [domain]) == []
    assert validate_domains(config, root) == []
    assert "**covered**" in build_coverage_catalog(root, root, config)


def test_feature_inventory_ignores_tests_assets_and_local_artifacts(tmp_path: Path) -> None:
    """Scratch files and test-only directories never invent production features."""
    for relative in (
        "frontend/src/features/tests-only/Screen.test.tsx",
        "frontend/src/features/assets-only/README.md",
        "frontend/src/features/vendor/Screen.tsx",
        "frontend/src/features/sandbox/Screen.tsx",
        "frontend/src/features/.venv-relocated/Screen.tsx",
        "frontend/src/features/future/.tmp/Screen.tsx",
        "frontend/src/features/future/dist/Screen.tsx",
    ):
        write_file(tmp_path, relative)
    assert untraced_frontend_features(tmp_path, []) == []


def test_curated_domains_trace_every_owned_frontend_feature() -> None:
    """Real domain configuration must keep up with the source module inventory."""
    config = APP_ROOT / "pipeline/skills/technical_documentation/domains.json"
    domains = load_domains(config)
    assert untraced_frontend_features(APP_ROOT, domains) == []
    expected_owners = {
        "agent-learning": ("ai-agent", "frontend/src/features/agent-learning/ConversationLearning.test.tsx"),
        "booking": ("calendar-meetings", "frontend/src/features/booking/BookingPage.test.tsx"),
        "forms": ("auth-workspaces-sharing", "frontend/src/features/forms/FormsManager.test.tsx"),
        "genograms": ("genograms", "frontend/src/features/genograms/export.test.ts"),
        "offline": ("foundation-runtime", "tests/e2e/tests/disposable/offline-companion.spec.ts"),
        "websites": ("integrations-plugins", "frontend/src/features/websites/WebsitesPage.test.tsx"),
    }
    by_id = {domain["id"]: domain for domain in domains}
    for feature, (owner, test) in expected_owners.items():
        domain = by_id[owner]
        feature_root = APP_ROOT / "frontend/src/features" / feature
        assert any(
            feature_root in path.parents
            for path in matches_for_globs(APP_ROOT, domain["source_globs"])
        ), feature
        assert APP_ROOT / test in matches_for_globs(APP_ROOT, domain["test_globs"]), feature


def test_domain_validation_does_not_count_local_artifacts_as_source(tmp_path: Path) -> None:
    """Validation and generation apply identical owned-source exclusions."""
    write_file(tmp_path, "docs/engineering/domains/core.md", "# Core\n")
    write_file(tmp_path, "desktop/.venv-relocated/runtime.py")
    config = write_file(tmp_path, "domains.json", json.dumps([{
        "id": "core", "name": "Core", "guide": "docs/engineering/domains/core.md",
        "source_globs": ["desktop/**/*"], "test_globs": [], "directives": [],
    }]))
    assert any("source patterns match no files" in error for error in validate_domains(config, tmp_path))
