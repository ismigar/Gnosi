"""Tests for functional-change documentation enforcement."""

from pathlib import Path
from subprocess import CompletedProcess

from pipeline.skills.technical_documentation.scripts.check_change_impact import (
    REPOSITORY_ROOT,
    changed_files,
    is_implementation_path,
    requires_documentation_path,
    validate_change_set,
)


def test_routine_frontend_component_changes_do_not_require_public_documentation():
    """Routine component changes do not require prose that adds no new contract."""
    errors = validate_change_set(
        {"frontend/src/components/Reader.jsx"}
    )

    assert errors == []
    assert is_implementation_path(
        "frontend/src/components/Reader.jsx"
    )
    assert not requires_documentation_path(
        "frontend/src/components/Reader.jsx"
    )


def test_backend_boundary_changes_require_public_documentation():
    """Backend API changes still require reviewed or generated evidence."""
    errors = validate_change_set({"backend/api/reader.py"})

    assert len(errors) == 1
    assert "docs/engineering" in errors[0]
    assert "high-impact" in errors[0]


def test_frontend_shell_changes_require_public_documentation():
    """Authentication and application-shell changes can alter system contracts."""
    assert requires_documentation_path(
        "frontend/src/context/AuthContext.jsx"
    )
    assert requires_documentation_path("frontend/src/main.jsx")


def test_reviewed_or_generated_documentation_satisfies_the_gate():
    """Both reviewed guides and deterministic catalogs are valid evidence."""
    assert validate_change_set(
        {
            "backend/api/reader.py",
            "docs/engineering/domains/reader-references.md",
        }
    ) == []
    assert validate_change_set(
        {
            "backend/api/reader.py",
            "docs/engineering/generated/api-catalog.md",
        }
    ) == []


def test_tests_and_style_only_changes_do_not_trigger_the_gate():
    """Test coverage and styling can change without inventing behavior docs."""
    paths = {
        "backend/tests/test_reader.py",
        "frontend/src/index.css",
    }

    assert validate_change_set(paths) == []
    assert not any(is_implementation_path(path) for path in paths)


def test_dependency_only_updates_do_not_require_public_documentation():
    """Dependency manifests do not change the documented product contract."""
    assert validate_change_set({"frontend/package.json"}) == []
    assert validate_change_set({"pyproject.toml"}) == []
    assert validate_change_set({
        "frontend/package.json",
        "frontend/src/main.jsx",
    })


def test_runtime_and_deployment_files_are_functional():
    """Native and Docker execution changes must update operations documentation."""
    assert is_implementation_path("scripts/runtime/run_native_dev.sh")
    assert is_implementation_path("Dockerfile.backend")
    assert requires_documentation_path("scripts/runtime/run_native_dev.sh")
    assert requires_documentation_path("Dockerfile.backend")


def test_changed_files_includes_committed_and_local_changes(monkeypatch):
    """Local gates must see committed, staged, unstaged, and untracked evidence."""
    outputs = {
        ("git", "diff", "--name-only", "origin/main...HEAD"): (
            "frontend/package.json\n"
        ),
        ("git", "diff", "--name-only"): (
            "docs/engineering/domains/desktop-clients.md\n"
        ),
        ("git", "diff", "--name-only", "--cached"): (
            "docs/engineering-ca/domains/desktop-clients.md\n"
        ),
        ("git", "ls-files", "--others", "--exclude-standard"): (
            "docs/engineering-es/domains/desktop-clients.md\n"
        ),
    }

    def fake_run(command, **kwargs):
        assert kwargs["cwd"] == REPOSITORY_ROOT
        assert kwargs["check"] is True
        assert kwargs["capture_output"] is True
        assert kwargs["text"] is True
        normalized_command = (Path(command[0]).name, *command[1:])
        return CompletedProcess(command, 0, stdout=outputs[normalized_command])

    monkeypatch.setattr(
        "pipeline.skills.technical_documentation.scripts.check_change_impact.subprocess.run",
        fake_run,
    )

    assert changed_files("origin/main") == {
        "frontend/package.json",
        "docs/engineering/domains/desktop-clients.md",
        "docs/engineering-ca/domains/desktop-clients.md",
        "docs/engineering-es/domains/desktop-clients.md",
    }
