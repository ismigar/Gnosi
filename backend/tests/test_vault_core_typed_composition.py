"""Core composition contracts; all backend imports run in a disposable child."""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import TYPE_CHECKING, get_type_hints

import pytest

if TYPE_CHECKING:
    from fastapi import BackgroundTasks

    from backend.domains.vault.pages.create_service import CreatePageDependencies
    from backend.domains.vault.schemas.pages import PageSaveRequest


def test_core_composition_in_isolated_subprocess() -> None:
    with tempfile.TemporaryDirectory(prefix="gnosi-core-composition-") as temporary:
        root = Path(temporary).resolve()
        for directory in ("data", "vault", "host"):
            (root / directory).mkdir()
        environment = {
            "PATH": os.defpath,
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1",
            "GNOSI_VALIDATION_ROOT": str(root),
            "GNOSI_DATA_DIR": str(root / "data"),
            "DIGITAL_BRAIN_VAULT_PATH": str(root / "vault"),
            "VAULT_HOST_PATH": str(root / "vault"),
            "HOME_HOST_PATH": str(root / "host"),
            "GNOSI_DISABLE_SCHEDULER": "1",
            "GNOSI_FILES_PROVIDER": "local",
            "GNOSI_RUN_LIVE_E2E": "0",
            "GNOSI_REQUIRE_AUTH": "1",
            "GNOSI_JWT_SECRET": "synthetic-core-composition-fixture-only",
        }
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "pytest",
                "-q",
                "-p",
                "no:cacheprovider",
                "--basetemp",
                str(root / "tests"),
                "-o",
                "python_functions=check_*",
                "backend/tests/test_vault_core_typed_composition.py",
            ],
            cwd=Path(__file__).resolve().parents[2],
            env=environment,
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        sys.stdout.write(result.stdout)


def check_model_router_and_mutable_owner_identity() -> None:
    from backend.api import vault_routes
    from backend.domains.vault.api import core_routes
    from backend.domains.vault.pages.runtime import DailyNoteRequest
    from backend.domains.vault.pages.state import page_state

    assert core_routes.router is vault_routes.router
    assert core_routes._user_label_cache is page_state.user_label_cache
    assert get_type_hints(core_routes.get_or_create_daily_note)["request"] is DailyNoteRequest
    assert DailyNoteRequest.__module__ == "backend.api.vault_routes"
    for name in ("create_page", "list_daily_notes", "get_or_create_daily_note", "list_vault_tags"):
        assert getattr(core_routes, name) is getattr(vault_routes, name)


def check_virtual_catalog_keeps_late_provider_and_raw_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.api import vault_routes
    from backend.domains.vault.api import core_routes

    catalog = [{"compute": "custom", "label": None, "extension": {"nested": True}}]
    monkeypatch.setattr(vault_routes, "_vf_list_specs", lambda: catalog)
    assert asyncio.run(core_routes.list_virtual_fields())["computers"] is catalog


def check_authorship_preserves_creation_and_custom_values(monkeypatch: pytest.MonkeyPatch) -> None:
    from backend.domains.vault.api import core_routes

    monkeypatch.setitem(core_routes._user_label_cache, "synthetic-author", "Nom de prova")
    extension = {"nested": [None, 1]}
    metadata: dict[str, object] = {
        "extension": extension,
        "created_by": "Original",
        "created_at": "old",
    }
    core_routes._stamp_author(metadata, "synthetic-author", True)
    assert metadata["created_by"] == "Original"
    assert metadata["created_at"] == "old"
    assert metadata["last_edited_by"] == "Nom de prova"
    assert metadata["extension"] is extension
    before = dict(metadata)
    core_routes._stamp_author(metadata, None, False)
    assert metadata == before


@pytest.mark.parametrize("role", ["editor", "admin", "owner", "viewer"])
@pytest.mark.parametrize("flow", ["create", "existing", "override"])
@pytest.mark.parametrize("date", ["2026-08-31", "invalid"])
def check_daily_http_context_permissions_and_late_overrides(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    role: str,
    flow: str,
    date: str,
) -> None:
    from fastapi import APIRouter, FastAPI
    from fastapi.routing import APIRoute
    from fastapi.testclient import TestClient

    from backend.api import vault_routes
    from backend.domains.vault.api import core_routes
    from backend.domains.vault.pages import create_service
    from backend.services import plugin_access
    from backend.services.workspace_service import WorkspaceContext, get_workspace_context

    observed: list[str | None] = []

    async def existing(page_id: str) -> dict[str, object]:
        observed.append("read")
        assert page_id == "existing-note"
        return {"id": page_id, "title": date, "content": "Preserved", "metadata": {}}

    async def override(request: PageSaveRequest, tasks: BackgroundTasks) -> dict[str, object]:
        observed.append("override")
        return {
            "id": "override-note",
            "title": request.title,
            "content": request.content,
            "metadata": request.metadata,
        }

    async def create(
        request: PageSaveRequest,
        tasks: BackgroundTasks,
        user_id: str | None,
        dependencies: CreatePageDependencies,
    ) -> dict[str, object]:
        observed.append(user_id)
        assert dependencies is core_routes._CREATE_PAGE_DEPENDENCIES
        return {
            "id": "synthetic-daily",
            "title": request.title,
            "content": request.content,
            "metadata": request.metadata,
        }

    async def enabled(*identifiers: str) -> None:
        assert identifiers == ("daily-notes",)

    monkeypatch.setattr(create_service, "create_page", create)
    # pages_commands keeps the canonical service alias used by the old handler.
    monkeypatch.setattr("backend.domains.vault.api.pages_commands.create_page_service", create)
    monkeypatch.setattr(vault_routes, "_daily_source_config", lambda: (None, None))
    monkeypatch.setattr(
        vault_routes,
        "_find_daily_note_id",
        lambda _date: "existing-note" if flow == "existing" else None,
    )
    monkeypatch.setattr(vault_routes, "get_page", existing)
    if flow == "override":
        monkeypatch.setattr(vault_routes, "create_page", override)
    monkeypatch.setattr(vault_routes, "_load_daily_template_content", lambda: "Template")
    monkeypatch.setattr(plugin_access, "assert_plugins_enabled", enabled)
    context = WorkspaceContext("workspace-fixture", "author-fixture", role, tmp_path)
    app = FastAPI()
    selected = APIRouter()
    selected.routes.extend(
        route
        for route in core_routes.router.routes
        if isinstance(route, APIRoute) and route.path == "/daily"
    )
    app.include_router(selected)
    app.dependency_overrides[get_workspace_context] = lambda: context
    with TestClient(app) as client:
        response = client.post("/daily", json={"date": date})
    expected_status = 403 if role == "viewer" else 422 if date == "invalid" else 200
    assert response.status_code == expected_status
    if expected_status != 200:
        assert observed == []
    else:
        expected_call = {"create": "author-fixture", "existing": "read", "override": "override"}
        assert observed == [expected_call[flow]]
        assert response.json()["content"] == ("Preserved" if flow == "existing" else "Template")


def check_unique_filename_keeps_sanitizer_and_existing_files(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.api import vault_routes
    from backend.domains.vault.api import core_routes

    monkeypatch.setattr(vault_routes, "_safe_filename", lambda _name, _directory: "Safe")
    first = tmp_path / "Safe.md"
    first.write_text("original", encoding="utf-8")
    second = tmp_path / "Safe (1).md"
    second.write_text("second", encoding="utf-8")
    assert core_routes._get_unique_filepath(tmp_path, "Untrusted/name") == tmp_path / "Safe (2).md"
    assert first.read_text(encoding="utf-8") == "original"
    assert second.read_text(encoding="utf-8") == "second"
    assert (
        core_routes._get_unique_filepath(tmp_path, "Untrusted/name", ".txt")
        == tmp_path / "Safe.txt"
    )


def check_created_index_updates_current_owner_and_invalidates_on_failure(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import threading

    from backend.api import vault_routes
    from backend.domains.vault.api import core_routes

    page = tmp_path / "page.md"
    page.write_text("Synthetic", encoding="utf-8")
    entries: dict[str, dict[str, dict[str, object]]] = {}
    paths: dict[str, dict[str, str]] = {}
    entry: dict[str, object] = {"id": "page", "metadata": {"nested": [None]}}
    bumped: list[str] = []
    cleared: list[bool] = []
    indexed: list[tuple[Path, str, Path]] = []

    class Resolver:
        def add_file(self, vault: Path, page_id: str, path: Path) -> None:
            indexed.append((vault, page_id, path))

    monkeypatch.setattr(vault_routes, "get_active_vault_path", lambda: tmp_path)
    monkeypatch.setattr(vault_routes, "_page_index_lock", threading.Lock())
    monkeypatch.setattr(vault_routes, "_page_index_entries", entries)
    monkeypatch.setattr(vault_routes, "_page_id_to_path", paths)
    monkeypatch.setattr(vault_routes, "_build_page_cache_entry", lambda _path, _stat: entry)
    monkeypatch.setattr(vault_routes, "_bump_page_index_version", bumped.append)
    monkeypatch.setattr(vault_routes, "_clear_page_index_cache", lambda: cleared.append(True))
    monkeypatch.setattr(vault_routes, "path_resolver", Resolver())
    core_routes._index_created_page("page", page)
    assert entries[str(tmp_path)][str(page)] is entry
    assert paths == {str(tmp_path): {"page": str(page)}}
    assert bumped == [str(tmp_path)] and indexed == [(tmp_path, "page", page)]
    assert cleared == []
    core_routes._index_created_page("missing", tmp_path / "absent.md")
    assert cleared == [True]


@pytest.mark.parametrize("active", [True, False])
def check_planning_queues_only_an_active_vault_without_running_scheduler(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    active: bool,
) -> None:
    from fastapi import BackgroundTasks

    from backend.api import vault_routes
    from backend.domains.vault.api import core_routes

    tasks = BackgroundTasks()
    monkeypatch.setattr(vault_routes, "get_active_vault_path", lambda: tmp_path if active else None)
    core_routes._queue_planning_recalculation(tasks)
    assert len(tasks.tasks) == int(active)
    if active:
        assert tasks.tasks[0].args == (tmp_path,)
