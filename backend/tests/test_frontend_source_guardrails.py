from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from scripts.check_frontend_guardrails import (
    FrontendMetrics,
    check_baseline,
    current_metrics,
)


def _baseline(**overrides: dict[str, int]) -> dict[str, Any]:
    allowlist: dict[str, dict[str, int]] = {
        "legacy_js_jsx": {},
        "oversized_files": {},
        "direct_storage": {},
        "global_events": {},
    }
    allowlist.update(overrides)
    return {
        "format": "gnosi-frontend-guardrails-v1",
        "limits": {"handwritten_file_lines": 500, "component_lines": 300},
        "allowlist": allowlist,
    }


def test_current_metrics_detects_debt_and_exempts_typed_adapters(tmp_path: Path) -> None:
    source = tmp_path / "frontend" / "src"
    feature = source / "features" / "alpha"
    feature.mkdir(parents=True)
    (feature / "Large.jsx").write_text(
        "import '@/features/beta/private';\n"
        "const value = localStorage.getItem('key');\n"
        "window.dispatchEvent(new CustomEvent('changed'));\n"
        + "\n".join("const line = 1;" for _ in range(500)),
        encoding="utf-8",
    )
    platform = source / "shared" / "platform"
    platform.mkdir(parents=True)
    (platform / "browser-storage.ts").write_text(
        "export const storage = localStorage;\n", encoding="utf-8"
    )
    (platform / "app-events.ts").write_text(
        "export const event = new CustomEvent('safe');\n", encoding="utf-8"
    )

    metrics = current_metrics(tmp_path)

    large_path = "frontend/src/features/alpha/Large.jsx"
    assert metrics.legacy_js_jsx[large_path] == 503
    assert metrics.oversized_files[large_path] == 503
    assert metrics.direct_storage == {large_path: 1}
    assert metrics.global_events == {large_path: 2}
    assert metrics.feature_boundary_errors == [
        f"{large_path} imports private code from feature beta: @/features/beta/private"
    ]


def test_check_baseline_rejects_new_worsening_and_stale_entries() -> None:
    metrics = FrontendMetrics(
        legacy_js_jsx={"frontend/src/new.jsx": 10, "frontend/src/growing.js": 21},
        oversized_files={},
        direct_storage={},
        global_events={},
        feature_boundary_errors=[],
    )
    baseline = _baseline(
        legacy_js_jsx={"frontend/src/growing.js": 20, "frontend/src/resolved.js": 5}
    )

    errors = check_baseline(metrics, baseline, require_pruned=True, require_zero=False)

    assert errors == [
        "New frontend legacy_js_jsx violation: frontend/src/new.jsx",
        "Worsened frontend legacy_js_jsx violation: frontend/src/growing.js: 21 > 20",
        "Prune resolved frontend legacy_js_jsx entry: frontend/src/resolved.js",
    ]


def test_check_baseline_accepts_reduced_debt_without_pruning_gate() -> None:
    metrics = FrontendMetrics(
        legacy_js_jsx={"frontend/src/legacy.jsx": 9},
        oversized_files={},
        direct_storage={},
        global_events={},
        feature_boundary_errors=[],
    )
    baseline = _baseline(legacy_js_jsx={"frontend/src/legacy.jsx": 10})

    assert check_baseline(metrics, baseline, require_pruned=False, require_zero=False) == []
    assert check_baseline(metrics, baseline, require_pruned=True, require_zero=False) == [
        "Tighten improved frontend legacy_js_jsx entry: frontend/src/legacy.jsx: 10 -> 9"
    ]


@pytest.mark.parametrize(
    "specifier",
    ["../beta", "../beta/", "../beta/index", "../beta/index.ts", "@/features/beta/index.tsx",
     "@/features/alpha/private", "./nested/private", "../../shared/api/vaults"],
)
def test_feature_imports_accept_public_entries_and_own_internals(
    tmp_path: Path, specifier: str
) -> None:
    feature = tmp_path / "frontend/src/features/alpha/View.ts"
    feature.parent.mkdir(parents=True)
    feature.write_text(f"import '{specifier}';\n", encoding="utf-8")
    assert current_metrics(tmp_path).feature_boundary_errors == []


@pytest.mark.parametrize(
    ("source", "specifier", "message"),
    [
        ("features/alpha/View.ts", "../beta/private", "private code from feature beta"),
        ("features/alpha/View.ts", "../alpha/../beta/private.ts?raw", "private code from feature beta"),
        ("app/App.ts", "@/features/beta/private", "private code from feature beta"),
        ("components/Legacy.ts", "../features/beta/internal/index", "private code from feature beta"),
        ("features/alpha/View.ts", "../../app/providers", "app composition into a feature"),
        ("shared/ui/View.ts", "../../features/beta/index.ts", "app/feature code into shared"),
        ("shared/ui/View.ts", "@/app/providers", "app/feature code into shared"),
    ],
)
def test_feature_imports_reject_private_and_upward_dependencies(
    tmp_path: Path, source: str, specifier: str, message: str
) -> None:
    feature = tmp_path / "frontend/src" / source
    feature.parent.mkdir(parents=True)
    feature.write_text(f"export * from '{specifier}';\n", encoding="utf-8")
    assert current_metrics(tmp_path).feature_boundary_errors == [
        f"frontend/src/{source} imports {message}: {specifier}"
    ]


def test_feature_layout_check_does_not_treat_test_strings_as_imports(tmp_path: Path) -> None:
    source = tmp_path / "frontend/src/test/contracts/boundary.test.ts"
    source.parent.mkdir(parents=True)
    source.write_text(
        'const fixture = "import { Hidden } from \'@/features/beta/private\';";\n'
        'const other = "export * from \'@/features/beta/private\';";\n',
        encoding="utf-8",
    )
    assert current_metrics(tmp_path).feature_boundary_errors == []


@pytest.mark.parametrize(
    "declaration",
    ["import {\n Hidden,\n Other\n} from '../beta/private';",
     "export type { Hidden } from '../beta/private';",
     "export * as hidden from '../beta/private';",
     "import type Hidden from '../beta/private';"],
)
def test_feature_layout_check_preserves_multiline_and_type_declarations(
    tmp_path: Path, declaration: str
) -> None:
    source = tmp_path / "frontend/src/features/alpha/View.ts"
    source.parent.mkdir(parents=True)
    source.write_text(declaration, encoding="utf-8")
    assert len(current_metrics(tmp_path).feature_boundary_errors) == 1


@pytest.mark.parametrize('specifier', ['../beta/Widget', '@/features/beta/Widget.tsx', '../beta/Widget.js?raw'])
def test_explicit_public_module_does_not_open_its_neighbors(tmp_path: Path, specifier: str) -> None:
    source = tmp_path / 'frontend/src/features/alpha/Page.ts'
    source.parent.mkdir(parents=True)
    target = tmp_path / 'frontend/src/features/beta/Widget.tsx'
    target.parent.mkdir(parents=True)
    target.write_text('export const Widget = 1;\n', encoding='utf-8')
    (tmp_path / 'frontend/feature-public-entries.json').write_text(
        json.dumps({'features/beta/Widget.tsx': 'Widget intentionally embedded by another feature.'}), encoding='utf-8',
    )
    source.write_text(f"import '{specifier}';\nimport '../beta/private';\n", encoding='utf-8')
    errors = current_metrics(tmp_path).feature_boundary_errors
    assert len(errors) == 1
    assert '../beta/private' in errors[0]
    shared = tmp_path / 'frontend/src/shared/probe.ts'
    shared.parent.mkdir()
    shared.write_text("import '@/features/beta/Widget';\n", encoding='utf-8')
    assert any('into shared' in error for error in current_metrics(tmp_path).feature_boundary_errors)


@pytest.mark.parametrize('entry', ['features/beta/*', 'features/../shared/Thing.ts', 'features/beta/Missing.ts'])
def test_invalid_public_entries_fail_closed(tmp_path: Path, entry: str) -> None:
    frontend = tmp_path / 'frontend'
    frontend.mkdir()
    (frontend / 'feature-public-entries.json').write_text(json.dumps({entry: 'Reviewed entry.'}), encoding='utf-8')
    with pytest.raises(ValueError, match='Invalid or missing feature public entry'):
        current_metrics(tmp_path)
