"""Tests for functional-change documentation enforcement."""

from pipeline.skills.technical_documentation.scripts.check_change_impact import (
    is_implementation_path,
    validate_change_set,
)


def test_functional_source_changes_require_public_documentation():
    """A behavior change cannot merge without public engineering evidence."""
    errors = validate_change_set(
        {"monorepo/apps/gnosi/frontend/src/components/Reader.jsx"}
    )

    assert len(errors) == 1
    assert "docs/engineering" in errors[0]


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


def test_runtime_and_deployment_files_are_functional():
    """Native and Docker execution changes must update operations documentation."""
    assert is_implementation_path("monorepo/apps/gnosi/sh/run_native_dev.sh")
    assert is_implementation_path("monorepo/apps/gnosi/Dockerfile.backend")
