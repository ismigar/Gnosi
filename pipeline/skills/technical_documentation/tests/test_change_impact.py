"""Tests for functional-change documentation enforcement."""

from pathlib import Path
from subprocess import CompletedProcess

import pytest

from pipeline.skills.technical_documentation.scripts.check_change_impact import (
    REPOSITORY_ROOT,
    changed_files,
    is_implementation_path,
    requires_documentation_path,
    validate_change_set,
)


def test_routine_frontend_component_changes_do_not_require_public_documentation() -> None:
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


def test_backend_boundary_changes_require_public_documentation() -> None:
    """Backend API changes still require reviewed or generated evidence."""
    errors = validate_change_set({"backend/api/reader.py"})

    assert len(errors) == 1
    assert "docs/engineering" in errors[0]
    assert "high-impact" in errors[0]


def test_frontend_shell_changes_require_public_documentation() -> None:
    """Authentication and application-shell changes can alter system contracts."""
    assert requires_documentation_path(
        "frontend/src/context/AuthContext.jsx"
    )
    assert requires_documentation_path("frontend/src/main.jsx")


def test_reviewed_or_generated_documentation_satisfies_the_gate() -> None:
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


@pytest.mark.parametrize(
    "path",
    [
        "frontend/src/app/App.tsx",
        "frontend/src/app/main.tsx",
        "frontend/src/app/bootstrap.tsx",
        "frontend/src/app/routes.tsx",
        "frontend/src/app/AppProviders.tsx",
        "frontend/src/app/navigation/AppSidebar.tsx",
        "frontend/src/app/integration/useFileLinkInterceptor.ts",
        "frontend/src/features/auth/LoginPage.tsx",
        "frontend/src/features/auth/context/AuthProvider.tsx",
        "frontend/src/features/auth/settings/Auth/AccountSettings.tsx",
        "frontend/src/features/auth/settings/ApiTokensSettings.tsx",
        "frontend/src/shared/auth/auth-context.ts",
        "frontend/src/shared/routing/vaultRouting.ts",
        "frontend/src/shared/routing/vaultQuickNavigation.ts",
        "frontend/src/shared/ui/layout/Layout.tsx",
        "frontend/src/shared/api/ApiProvider.tsx",
        "frontend/src/shared/api/auth.ts",
        "frontend/src/shared/api/use-api.ts",
        "frontend/feature-public-entries.json",
    ],
)
def test_owned_frontend_boundaries_require_documentation(path: str) -> None:
    """Relocation must not remove auth, routing, shell, or public-entry gates."""
    assert is_implementation_path(path)
    assert requires_documentation_path(path)
    assert validate_change_set({path})
    assert validate_change_set(
        {path, "docs/engineering/architecture/system-context.md"}
    ) == []


@pytest.mark.parametrize(
    "path",
    [
        "frontend/src/features/reader/ReaderDashboard.tsx",
        "frontend/src/features/mail/components/MailViewer.tsx",
        "frontend/src/features/vault/editor/BlockEditor.tsx",
        "frontend/src/shared/editor/VaultMarkdown.tsx",
        "frontend/src/shared/records/hooks/useCanonicalTableRecords.ts",
        "frontend/src/shared/ui/dialogs/ConfirmDialog.tsx",
        "frontend/src/features/authors/Author.tsx",
        "frontend/src/shared/authors/author.ts",
    ],
)
def test_routine_owned_components_do_not_require_documentation(path: str) -> None:
    """Domain UI and similarly named neighbors stay outside boundary prefixes."""
    assert is_implementation_path(path)
    assert not requires_documentation_path(path)
    assert validate_change_set({path}) == []


@pytest.mark.parametrize(
    "path",
    [
        "frontend/src/app/composition.contract.test.ts",
        "frontend/src/app/navigation/AppSidebar.test.tsx",
        "frontend/src/features/auth/LoginPage.test.tsx",
        "frontend/src/features/auth/__tests__/bootstrap.tsx",
        "frontend/src/shared/routing/vaultRouting.test.ts",
        "frontend/src/shared/auth/auth-context.spec.ts",
        "frontend/src/shared/api/auth.test.ts",
        "frontend/tests/contracts/feature-boundaries.test.ts",
        "frontend/src/app/styles/index.css",
        "frontend/src/features/auth/styles/login.css",
    ],
)
def test_owned_frontend_tests_and_styles_remain_exempt(path: str) -> None:
    """Sensitive directories must still allow coverage-only and style changes."""
    assert not is_implementation_path(path)
    assert not requires_documentation_path(path)
    assert validate_change_set({path}) == []


def test_localized_docs_alone_do_not_satisfy_owned_boundary_gate() -> None:
    """A translated mirror does not replace canonical English evidence."""
    assert validate_change_set(
        {
            "frontend/src/shared/auth/auth-context.ts",
            "docs/engineering-ca/architecture/system-context.md",
            "docs/engineering-es/architecture/system-context.md",
            "docs/engineering-fr/architecture/system-context.md",
        }
    )


def test_tests_and_style_only_changes_do_not_trigger_the_gate() -> None:
    """Test coverage and styling can change without inventing behavior docs."""
    paths = {
        "backend/tests/test_reader.py",
        "frontend/src/index.css",
    }

    assert validate_change_set(paths) == []
    assert not any(is_implementation_path(path) for path in paths)


def test_dependency_only_updates_do_not_require_public_documentation() -> None:
    """Dependency manifests do not change the documented product contract."""
    assert validate_change_set({"frontend/package.json"}) == []
    assert validate_change_set({"pyproject.toml"}) == []
    assert validate_change_set({
        "frontend/package.json",
        "frontend/src/main.jsx",
    })


def test_runtime_and_deployment_files_are_functional() -> None:
    """Native and Docker execution changes must update operations documentation."""
    assert is_implementation_path("scripts/runtime/run_native_dev.sh")
    assert is_implementation_path("Dockerfile.backend")
    assert requires_documentation_path("scripts/runtime/run_native_dev.sh")
    assert requires_documentation_path("Dockerfile.backend")


def test_changed_files_includes_committed_and_local_changes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
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

    def fake_run(
        command: tuple[str, ...], *, cwd: Path, check: bool,
        capture_output: bool, text: bool,
    ) -> CompletedProcess[str]:
        assert cwd == REPOSITORY_ROOT
        assert check is True
        assert capture_output is True
        assert text is True
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
