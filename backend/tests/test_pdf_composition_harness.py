"""PDF group failures retain child evidence and remove their disposable data."""
from pathlib import Path
import subprocess

import pytest

from backend.tests import test_pdf_annotation_typed_composition as composition


def test_timeout_reports_child_progress_and_cleans_fixture(monkeypatch):
    roots: list[Path] = []

    def timeout(command, **options):
        roots.append(Path(options["env"]["GNOSI_VALIDATION_ROOT"]))
        raise subprocess.TimeoutExpired(
            command, options["timeout"],
            output=b"check_real_sqlite_http_crud PASSED\ncheck_real_editor_guard",
            stderr=b"Thread stack: waiting for child request\xff",
        )

    monkeypatch.setattr(composition.subprocess, "run", timeout)
    with pytest.raises(pytest.fail.Exception) as error:
        composition.test_pdf_annotation_typed_composition_in_isolated_subprocess("facade-first")
    message = str(error.value)
    assert "facade-first" in message
    assert "check_real_sqlite_http_crud PASSED" in message
    assert "check_real_editor_guard" in message
    assert "Thread stack: waiting for child request" in message
    assert roots and not roots[0].exists()


def test_child_failure_remains_fatal(monkeypatch):
    def failure(command, **_options):
        return subprocess.CompletedProcess(command, 1, "FAILED check_real_editor_guard", "403 mismatch")

    monkeypatch.setattr(composition.subprocess, "run", failure)
    with pytest.raises(AssertionError, match="FAILED check_real_editor_guard"):
        composition.test_pdf_annotation_typed_composition_in_isolated_subprocess("domain-first")
