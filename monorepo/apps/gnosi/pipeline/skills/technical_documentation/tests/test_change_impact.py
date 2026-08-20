"""Tests for functional-change documentation enforcement."""

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
        {"monorepo/apps/gnosi/frontend/src/components/Reader.jsx"}
    )

    assert errors == []
    assert is_implementation_path(
        "monorepo/apps/gnosi/frontend/src/components/Reader.jsx"
    )
    assert not requires_documentation_path(
        "monorepo/apps/gnosi/frontend/src/components/Reader.jsx"
    )


def test_backend_boundary_changes_require_public_documentation():
    """Backend API changes still require reviewed or generated evidence."""
    errors = validate_change_set({"monorepo/apps/gnosi/backend/api/reader.py"})

    assert len(errors) == 1
    assert "docs/engineering" in errors[0]
    assert "high-impact" in errors[0]


def test_frontend_shell_changes_require_public_documentation():
    """Authentication and application-shell changes can alter system contracts."""
    assert requires_documentation_path(
        "monorepo/apps/gnosi/frontend/src/context/AuthContext.jsx"
    )
    assert requires_documentation_path("monorepo/apps/gnosi/frontend/src/main.jsx")


def test_reviewed_or_generated_documentation_satisfies_the_gate():
    """Both reviewed guides and deterministic catalogs are valid evidence."""
    assert validate_change_set(
        {
            "monorepo/apps/gnosi/backend/api/reader.py",
            "monorepo/apps/gnosi/docs/engineering/domains/reader-references.md",
        }
    ) == []
    assert validate_change_set(
        {
            "monorepo/apps/gnosi/backend/api/reader.py",
            "monorepo/apps/gnosi/docs/engineering/generated/api-catalog.md",
        }
    ) == []


def test_tests_and_style_only_changes_do_not_trigger_the_gate():
    """Test coverage and styling can change without inventing behavior docs."""
    paths = {
        "monorepo/apps/gnosi/backend/tests/test_reader.py",
        "monorepo/apps/gnosi/frontend/src/index.css",
    }

    assert validate_change_set(paths) == []
    assert not any(is_implementation_path(path) for path in paths)


def test_dependency_only_updates_do_not_require_public_documentation():
    """Dependency manifests do not change the documented product contract."""
    assert validate_change_set({"monorepo/apps/gnosi/frontend/package.json"}) == []
    assert validate_change_set({"monorepo/apps/gnosi/requirements.txt"}) == []
    assert validate_change_set({
        "monorepo/apps/gnosi/frontend/package.json",
        "monorepo/apps/gnosi/frontend/src/main.jsx",
    })


def test_runtime_and_deployment_files_are_functional():
    """Native and Docker execution changes must update operations documentation."""
    assert is_implementation_path("monorepo/apps/gnosi/sh/run_native_dev.sh")
    assert is_implementation_path("monorepo/apps/gnosi/Dockerfile.backend")
    assert requires_documentation_path("monorepo/apps/gnosi/sh/run_native_dev.sh")
    assert requires_documentation_path("monorepo/apps/gnosi/Dockerfile.backend")


def test_changed_files_includes_committed_and_local_changes(monkeypatch):
    """Local gates must see committed, staged, unstaged, and untracked evidence."""
    outputs = {
        ("git", "diff", "--name-only", "origin/main...HEAD"): (
            "monorepo/apps/gnosi/frontend/package.json\n"
        ),
        ("git", "diff", "--name-only"): (
            "monorepo/apps/gnosi/docs/engineering/domains/desktop-clients.md\n"
        ),
        ("git", "diff", "--name-only", "--cached"): (
            "monorepo/apps/gnosi/docs/engineering-ca/domains/desktop-clients.md\n"
        ),
        ("git", "ls-files", "--others", "--exclude-standard"): (
            "monorepo/apps/gnosi/docs/engineering-es/domains/desktop-clients.md\n"
        ),
    }

    def fake_run(command, **kwargs):
        assert kwargs["cwd"] == REPOSITORY_ROOT
        assert kwargs["check"] is True
        assert kwargs["capture_output"] is True
        assert kwargs["text"] is True
        return CompletedProcess(command, 0, stdout=outputs[tuple(command)])

    monkeypatch.setattr(
        "pipeline.skills.technical_documentation.scripts.check_change_impact.subprocess.run",
        fake_run,
    )

    assert changed_files("origin/main") == {
        "monorepo/apps/gnosi/frontend/package.json",
        "monorepo/apps/gnosi/docs/engineering/domains/desktop-clients.md",
        "monorepo/apps/gnosi/docs/engineering-ca/domains/desktop-clients.md",
        "monorepo/apps/gnosi/docs/engineering-es/domains/desktop-clients.md",
    }
