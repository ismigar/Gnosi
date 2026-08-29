from __future__ import annotations

from pathlib import Path
from typing import Any

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
