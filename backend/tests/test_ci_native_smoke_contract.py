"""Contracts for mandatory, isolated browser acceptance on native services."""

from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = REPOSITORY_ROOT / ".github" / "workflows" / "ci.yml"


def test_native_gate_requires_full_browser_acceptance_and_evidence() -> None:
    source = WORKFLOW.read_text(encoding="utf-8")
    native_job = source.split("\n  native-smoke:\n", 1)[1].split("\n  docker:\n", 1)[0]

    assert "GNOSI_DISABLE_SCHEDULER: '1'" in native_job
    assert "scripts/ci/browser_acceptance.py --output" in native_job
    assert "timeout-minutes: 15" in native_job
    assert "kill -0" not in native_job
    assert "continue-on-error" not in native_job


def test_browser_gate_contains_persistence_and_authenticated_projects() -> None:
    source = WORKFLOW.read_text(encoding="utf-8")
    native_job = source.split("\n  native-smoke:\n", 1)[1].split("\n  docker:\n", 1)[0]
    assert "dump_traceback_later" not in native_job
    assert "scripts/ci/browser_acceptance.py" in native_job
    runner = (REPOSITORY_ROOT / "scripts/ci/browser_acceptance.py").read_text()
    for project in ("disposable-web", "chromium-auth", "accessibility", "critical-workflows", "persistence-restart", "personal-workflows"):
        assert f'"{project}"' in runner
    assert "report_counts(report, projects)" in runner
    assert "source_fingerprint(ROOT) != initial" in runner


def test_native_browser_build_receives_reader_assets_from_its_exact_candidate() -> None:
    import yaml

    jobs = yaml.safe_load(WORKFLOW.read_text())["jobs"]
    upload = next(step for step in jobs["frontend"]["steps"] if step.get("name") == "Preserve reader assets for the same candidate")
    download = next(step for step in jobs["native-smoke"]["steps"] if step.get("name") == "Restore reader assets from the same candidate")
    assert upload["with"]["name"] == download["with"]["name"] == "gnosi-reader-${{ github.sha }}"
    assert upload["with"]["path"] == download["with"]["path"] == "frontend/public/zotero-reader"
    assert upload["with"]["if-no-files-found"] == "error"
    native_steps = jobs["native-smoke"]["steps"]
    assert native_steps.index(download) < next(i for i, step in enumerate(native_steps) if "scripts/ci/browser_acceptance.py" in step.get("run", ""))
