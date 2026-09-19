"""New feature adapters preserve authenticated scope and canonical validation."""

import asyncio
import hashlib
import json
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException

from backend.agent import (
    activity_tools,
    feature_tool_support,
    literature_tools,
    media_tools,
    notebook_tools,
    planning_resource_tools,
)
from backend.agent.action_confirmations import confirmation_context
from backend.services.context_vars import active_vault_path


@pytest.fixture
def feature_scope(tmp_path, monkeypatch):
    monkeypatch.setattr(feature_tool_support, "feature_enabled", lambda _: True)
    token = active_vault_path.set(tmp_path)
    scope = dict(
        vault_scope=hashlib.sha256(str(tmp_path.resolve()).encode()).hexdigest()[:20],
        workspace_id="personal",
        user_id="reader-1",
        role="editor",
        agent_id="agent-1",
        session_id="session-1",
    )
    with confirmation_context(**scope):
        yield scope
    active_vault_path.reset(token)


def test_adapter_requires_authenticated_context(monkeypatch):
    monkeypatch.setattr(
        feature_tool_support,
        "current_confirmation_scope",
        Mock(side_effect=RuntimeError("missing scope")),
    )
    with pytest.raises(RuntimeError, match="missing scope"):
        feature_tool_support.feature_context("resources")


@pytest.mark.parametrize("role", ["viewer", "unknown"])
def test_writes_reject_insufficient_roles(feature_scope, role):
    with confirmation_context(**{**feature_scope, "role": role}):
        with pytest.raises(PermissionError, match="role"):
            notebook_tools.notebook_rename.invoke({"notebook_id": "private", "title": "New"})


def test_adapter_rejects_missing_or_changed_vault(feature_scope, tmp_path):
    for vault in (None, tmp_path / "other"):
        token = active_vault_path.set(vault)
        try:
            with pytest.raises(PermissionError, match="Vault"):
                feature_tool_support.feature_context("resources")
        finally:
            active_vault_path.reset(token)


def test_plugin_revocation_is_checked_at_execution(feature_scope, monkeypatch):
    monkeypatch.setattr(feature_tool_support, "feature_enabled", lambda _: False)
    with pytest.raises(PermissionError, match="disabled"):
        notebook_tools.notebook_list.invoke({})


def test_notebook_read_does_not_schedule_refresh(feature_scope, monkeypatch):
    from backend.services import notebook_service

    read = Mock(return_value={"id": "book-1", "revision": 4})
    monkeypatch.setattr(notebook_service, "get_notebook", read)
    assert (
        json.loads(notebook_tools.notebook_read.invoke({"notebook_id": "book-1"}))["revision"] == 4
    )
    assert read.call_args.kwargs == {"schedule_refresh": False}
    assert read.call_args.args[1].user_id == feature_scope["user_id"]


def test_notebook_acl_denies_other_owner_before_search(feature_scope, monkeypatch):
    from backend.domains.notebooks import repository
    from backend.services import notebook_service

    monkeypatch.setattr(
        repository,
        "_notebook_row",
        lambda _: {
            "vault_scope": repository._vault_scope(active_vault_path.get()),
            "workspace_id": "personal",
            "visibility": "private",
            "owner_user_id": "another-user",
        },
    )
    search = Mock()
    monkeypatch.setattr(notebook_service, "search_notebook", search)
    with pytest.raises(HTTPException) as error:
        notebook_tools.notebook_search.invoke(
            {"notebook_id": "private", "query": "evidence", "revision": 1}
        )
    assert error.value.status_code == 404
    search.assert_not_called()


def test_notebook_evidence_preserves_exact_revision(feature_scope, monkeypatch):
    from backend.services import notebook_service

    monkeypatch.setattr(notebook_service, "authorize", Mock())
    read = Mock(return_value={"text": "citable evidence"})
    monkeypatch.setattr(notebook_service, "read_notebook_evidence", read)
    notebook_tools.notebook_read_evidence.invoke(
        {"notebook_id": "book-1", "chunk_id": "chunk-2", "revision": 7}
    )
    read.assert_called_once_with("book-1", "chunk-2", revision=7)


def test_notebook_creation_is_private_and_bounded(feature_scope, monkeypatch):
    from backend.services import notebook_service

    create = Mock(return_value={"status": "queued"})
    monkeypatch.setattr(notebook_service, "create_notebook", create)
    notebook_tools.notebook_create.invoke({"title": "Research", "resource_ids": ["resource-1"]})
    assert create.call_args.kwargs == {
        "title": "Research",
        "visibility": "private",
        "conversation_mode": "private_member",
        "resource_ids": ["resource-1"],
    }
    with pytest.raises(ValueError, match="50"):
        notebook_tools.notebook_create.invoke(
            {"title": "Research", "resource_ids": [str(i) for i in range(51)]}
        )
    assert create.call_count == 1


def test_source_catalog_does_not_expose_transport_configuration(feature_scope, monkeypatch):
    from backend.services import literature_service

    monkeypatch.setattr(
        literature_service,
        "catalog",
        lambda _: [
            {
                "id": "custom",
                "name": "Research archive",
                "enabled": True,
                "available": True,
                "base_url": "https://example.org/?token=secret",
                "headers": {"Authorization": "secret"},
                "settings": {"api_key": "secret"},
            }
        ],
    )
    payload = json.loads(literature_tools.literature_sources.invoke({}))
    assert payload == {
        "sources": [
            {"id": "custom", "name": "Research archive", "enabled": True, "available": True}
        ]
    }


@pytest.mark.parametrize("source_id", ["unknown", "disabled", "unavailable"])
def test_search_never_falls_back_to_all_sources(feature_scope, monkeypatch, source_id):
    from backend.services import literature_service

    monkeypatch.setattr(
        literature_service,
        "catalog",
        lambda _: [
            dict(id="disabled", enabled=False, automated=True, available=True),
            dict(id="unavailable", enabled=True, automated=True, available=False),
        ],
    )
    start = Mock()
    monkeypatch.setattr(literature_service, "start_search", start)
    with pytest.raises(ValueError, match="enabled source"):
        literature_tools.literature_start_search.invoke(
            {"query": "test", "source_ids": [source_id]}
        )
    start.assert_not_called()


def test_search_selects_exact_sources_and_bound_limits(feature_scope, monkeypatch):
    from backend.services import literature_service

    monkeypatch.setattr(
        literature_service,
        "catalog",
        lambda _: [dict(id="pubmed", enabled=True, automated=True, available=True)],
    )
    start = Mock(return_value={"id": "search-1", "status": "queued"})
    monkeypatch.setattr(literature_service, "start_search", start)
    result = json.loads(
        literature_tools.literature_start_search.invoke(
            {"query": "test", "source_ids": ["pubmed"], "limit_per_source": 500}
        )
    )
    assert result["status"] == "queued"
    assert start.call_args.kwargs["source_ids"] == ["pubmed"]
    assert start.call_args.kwargs["limit_per_source"] == 50
    assert start.call_args.kwargs["owner_user_id"] == feature_scope["user_id"]


def test_import_rejects_implicit_vault_redirect(feature_scope, monkeypatch, tmp_path):
    from backend.services import context_vars, literature_service

    monkeypatch.setattr(context_vars, "get_primary_vault_path", lambda: tmp_path / "another-vault")
    lookup = Mock()
    monkeypatch.setattr(literature_service, "get_search_result", lookup)
    with pytest.raises(PermissionError, match="primary Vault"):
        asyncio.run(
            literature_tools.literature_import_result.ainvoke(
                {"search_id": "search-1", "result_id": "work-1"}
            )
        )
    lookup.assert_not_called()


def test_import_uses_stored_result_and_executes_background_work(feature_scope, monkeypatch):
    from backend.services import context_vars, literature_service, literature_import_service

    monkeypatch.setattr(context_vars, "get_primary_vault_path", lambda: active_vault_path.get())
    lookup = Mock(return_value={"id": "work-1", "title": "Actual stored result"})
    monkeypatch.setattr(literature_service, "get_search_result", lookup)
    completed = []

    async def do_import(works, tasks, context):
        assert works == [lookup.return_value]
        assert context.user_id == feature_scope["user_id"]
        tasks.add_task(completed.append, "indexed")
        return {"imported_count": 1}

    monkeypatch.setattr(literature_import_service, "import_works", do_import)
    result = asyncio.run(
        literature_tools.literature_import_result.ainvoke(
            {"search_id": "search-1", "result_id": "work-1"}
        )
    )
    assert json.loads(result) == {"imported_count": 1}
    assert completed == ["indexed"]


def test_media_search_supplies_real_defaults_and_pagination(feature_scope, monkeypatch):
    from backend.domains.vault.media import routes

    async def search(response, **kwargs):
        assert kwargs["limit"] == 50 and kwargs["offset"] == 0
        assert kwargs["album"] is None and kwargs["sort"] == "mtime"
        assert kwargs["root"] == "assets" and kwargs["kinds"] == "pdf"
        assert all(value is None or isinstance(value, (str, int)) for value in kwargs.values())
        response.headers["X-Gnosi-Media-Index"] = "ready"
        response.headers["X-Gnosi-Media-Next-Offset"] = "50"
        return {"items": [{"path": "paper.pdf"}], "total": 80}

    monkeypatch.setattr(routes, "get_all_media", search)
    result = json.loads(
        asyncio.run(
            media_tools.media_search.ainvoke(
                {"root": "assets", "kind": "pdf", "offset": -10, "limit": 500}
            )
        )
    )
    assert result["index_state"] == "ready" and result["next_offset"] == "50"


@pytest.mark.parametrize(
    "path", ["../private", "/etc/passwd", "folder/../../private", "..\\private"]
)
def test_media_mutation_rejects_path_escape(feature_scope, monkeypatch, path):
    from backend.domains.vault.media import routes

    update = AsyncMock()
    monkeypatch.setattr(routes, "update_media_metadata", update)
    with pytest.raises(ValueError, match="relative"):
        asyncio.run(
            media_tools.media_update_description.ainvoke(
                {"path_in_root": path, "description": "New", "tags": []}
            )
        )
    update.assert_not_called()


def test_activity_history_is_bound_to_authenticated_scope(feature_scope, monkeypatch):
    from backend.services import automation_history

    history = Mock(return_value={"runs": [], "total": 0})
    monkeypatch.setattr(automation_history, "list_scoped_runs", history)
    activity_tools.activity_read_runs.invoke(
        {"automation_id": "automation-1", "offset": -1, "limit": 999}
    )
    history.assert_called_once_with(feature_scope, automation_id="automation-1", offset=0, limit=50)


def test_system_activity_is_not_exposed_to_organization(feature_scope):
    with confirmation_context(**{**feature_scope, "workspace_id": "team-1"}):
        with pytest.raises(PermissionError, match="personal workspace"):
            activity_tools.activity_list_system_schedules.invoke({})


def test_planning_update_preserves_partial_validated_payload(feature_scope, monkeypatch):
    from backend.api import planning_routes

    update = AsyncMock(
        return_value={"resource": {"id": "resource-1", "standard_rate": 25}, "revision": 2}
    )
    monkeypatch.setattr(planning_routes, "update_resource", update)
    asyncio.run(
        planning_resource_tools.planning_save_resource.ainvoke(
            {"resource_id": "resource-1", "resource": {"standard_rate": 25}}
        )
    )
    resource_id, payload = update.call_args.args
    assert resource_id == "resource-1"
    assert payload.model_dump(exclude_unset=True) == {"standard_rate": 25}


def test_planning_delete_preserves_dependency_validation(feature_scope, monkeypatch):
    from backend.api import planning_routes

    delete = AsyncMock(side_effect=HTTPException(status_code=409, detail="In use"))
    monkeypatch.setattr(planning_routes, "delete_resource", delete)
    with pytest.raises(HTTPException) as error:
        asyncio.run(
            planning_resource_tools.planning_delete_entity.ainvoke(
                {"kind": "resource", "entity_id": "resource-1"}
            )
        )
    assert error.value.status_code == 409
    delete.assert_called_once_with("resource-1")
