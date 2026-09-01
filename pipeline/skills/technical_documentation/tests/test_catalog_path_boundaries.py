"""Public catalogs depend on source, never on a checkout's parent names."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pipeline.skills.technical_documentation.scripts.generate import (
    build_outputs,
    frontend_files,
    is_owned_inventory_file,
    matches_for_globs,
    python_files,
    resolve_frontend_import,
)
from pipeline.skills.technical_documentation.tests.test_generator_compatibility import (
    write_catalog_fixture,
)


def write_source(root: Path, relative: str, content: str) -> Path:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path


def write_extended_fixture(root: Path) -> Path:
    domains = write_catalog_fixture(root)
    sources = {
        "frontend/src/pages/Page.tsx": "export default function Page() { return null; }\n",
        "frontend/src/App.tsx": (
            "import { Route } from 'react-router-dom';\n"
            "import Page from './pages/Page';\n"
            "export const App = () => <Route path='/pages' element={<Page />} />;\n"
        ),
        "frontend/src/pages/Page.test.tsx": "it('unit', () => {});\n",
        "tests/e2e/page.spec.ts": "test('browser', () => {});\n",
        "pipeline/skills/fixture/scripts/run.py": "def run():\n    return 42\n",
        "docs/engineering/domains/fixture.md": "# Fixture\n",
    }
    for relative, content in sources.items():
        write_source(root, relative, content)
    domains.write_text(json.dumps([{
        "id": "fixture", "name": "Fixture",
        "guide": "docs/engineering/domains/fixture.md",
        "source_globs": ["backend/**/*.py", "frontend/src/**/*.tsx"],
        "test_globs": ["tests/e2e/*.ts"], "directives": [],
    }]), encoding="utf-8")
    return domains


@pytest.mark.parametrize("ancestor", ["tests", "e2e", "vendor", "sandbox", ".tmp", "__pycache__"])
def test_catalogs_keep_import_coverage_and_runner_boundaries(
    tmp_path: Path, ancestor: str,
) -> None:
    baseline_root = tmp_path / "baseline"
    baseline = build_outputs(
        baseline_root, baseline_root, write_extended_fixture(baseline_root),
    )
    root = tmp_path / ancestor / "app"
    domains = write_extended_fixture(root)
    assert build_outputs(root, root, domains) == baseline
    assert "| Vitest | 1 | 1 |" in baseline["tests.md"]
    assert "| Playwright | 1 | 1 |" in baseline["tests.md"]
    assert "**covered**" in baseline["coverage.md"]
    assert resolve_frontend_import("./pages/Page", root) == "frontend/src/pages/Page.tsx"

    # Excluded files are deliberately not executable or even valid source.
    for relative in (
        "backend/vendor/hidden.py", "backend/.tmp/hidden.py",
        "backend/secrets/hidden.py", "pipeline/private_skills/hidden.py",
        "pipeline/sandbox/hidden.py", "frontend/src/vendor/Hidden.tsx",
        "frontend/src/.tmp/Hidden.tsx", "tests/e2e/.auth/state.json",
        "pipeline/skills/fixture/scripts/__pycache__/hidden.pyc",
    ):
        excluded = write_source(root, relative, "private sentinel - must never be parsed\n")
        assert not is_owned_inventory_file(excluded, root=root)
    assert build_outputs(root, root, domains) == baseline
    assert resolve_frontend_import("./vendor/Hidden", root) == "./vendor/Hidden"
    assert resolve_frontend_import("./.tmp/Hidden", root) == "./.tmp/Hidden"
    outside = write_source(root, "frontend/outside.tsx", "export default 1;\n")
    assert outside.is_file()
    assert resolve_frontend_import("../outside", root) == "../outside"

    matches = matches_for_globs(root, ["backend/**/*.py", "frontend/src/**/*.tsx"])
    assert {path.relative_to(root).as_posix() for path in matches} == {
        "backend/config.py", "backend/models/page.py", "backend/server.py",
        "backend/tests/test_source.py", "frontend/src/App.tsx",
        "frontend/src/pages/Page.tsx", "frontend/src/pages/Page.test.tsx",
    }


def test_rooted_scan_retains_exclusions_and_legacy_unrooted_helper(tmp_path: Path) -> None:
    root = tmp_path / "vendor" / "app"
    owned = write_source(root, "backend/service.py", "VALUE = 1\n")
    unit = write_source(root, "backend/tests/helper.py", "VALUE = 2\n")
    component = write_source(root, "frontend/src/Page.tsx", "export default 1;\n")
    write_source(root, "backend/vendor/library.py", "ignored\n")
    write_source(root, "frontend/src/vendor/Library.tsx", "ignored\n")

    assert python_files(root, include_tests=False) == [owned]
    assert python_files(root) == [owned, unit]
    assert frontend_files(root) == [component]
    assert is_owned_inventory_file(owned, root=root)
    assert not is_owned_inventory_file(owned)  # Existing unrooted API stays compatible.
    outside = write_source(tmp_path, "outside.py", "VALUE = 3\n")
    with pytest.raises(ValueError):
        is_owned_inventory_file(outside, root=root)
