"""Contracts for the synthetic native startup gate."""

from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = REPOSITORY_ROOT / ".github" / "workflows" / "ci.yml"


def test_native_smoke_waits_for_http_instead_of_wrapper_pids() -> None:
    source = WORKFLOW.read_text(encoding="utf-8")
    native_job = source.split("\n  native-smoke:\n", 1)[1].split("\n  docker:\n", 1)[0]

    assert "GNOSI_DISABLE_SCHEDULER: '1'" in native_job
    assert "http://127.0.0.1:5002/api/health" in native_job
    assert "http://127.0.0.1:5173/" in native_job
    assert "kill -0" not in native_job
    assert "tail -n 200" in native_job
