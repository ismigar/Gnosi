from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.services import context_vars, durable_job_queue, notebook_service
from backend.services.workspace_service import WorkspaceContext


@pytest.fixture()
def notebook_env(tmp_path, monkeypatch):
    local_data = tmp_path / "local_data"
    vault = tmp_path / "vault"
    vault.mkdir()
    params = SimpleNamespace(paths={"LOCAL_DATA": local_data, "VAULT": vault})
    monkeypatch.setattr(notebook_service, "load_params", lambda strict_env=False: params)
    monkeypatch.setattr(context_vars, "get_active_vault_path", lambda: vault)
    monkeypatch.setattr(durable_job_queue, "load_params", lambda strict_env=False: params)
    monkeypatch.setattr(notebook_service, "launch_ingest", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(notebook_service, "launch_analysis", lambda *_args, **_kwargs: None)

    attachment = vault / "evidence.txt"
    attachment.write_text("Grounded evidence about deterministic retrieval.", encoding="utf-8")
    table = {
        "id": "references-table",
        "name": "References",
        "properties": [
            {"id": "files-field", "name": "Attachments", "type": "files"},
            {"id": "url-field", "name": "URL", "type": "url"},
            {"id": "notes-field", "name": "Notes", "type": "text"},
        ],
    }
    page = SimpleNamespace(
        id="resource-1",
        title="Resource title metadata",
        last_modified="2026-08-20T10:00:00+00:00",
        metadata={
            "files-field": "evidence.txt",
            "url-field": "",
            "notes-field": "SECRET RECORD METADATA MUST NEVER BE INDEXED",
            "database_table_id": table["id"],
        },
    )
    monkeypatch.setattr(
        notebook_service,
        "_reference_table",
        lambda: (table["id"], table, [page]),
    )
    monkeypatch.setattr(
        notebook_service,
        "_current_resource_snapshot",
        lambda _notebook: (
            table,
            {
                "table_id": table["id"],
                "attachment_property_ids": ["files-field"],
                "url_property_ids": ["url-field"],
                "include_body": False,
            },
            [page],
        ),
    )
    context = WorkspaceContext("workspace-1", "user-1", "owner", vault, ["read", "write"])
    return {
        "context": context,
        "vault": vault,
        "page": page,
        "attachment": attachment,
    }


def _run_queued_ingest(vault: Path):
    job = durable_job_queue.ready_jobs(job_type="notebook_ingest", limit=1)[0]
    worker_id = "test-worker"
    assert durable_job_queue.claim(job["job_id"], worker_id=worker_id)
    result = notebook_service._run_ingest(vault, job["job_id"], worker_id)  # noqa: SLF001
    assert durable_job_queue.complete(job["job_id"], worker_id, result)
    return result


def test_notebook_indexes_only_attachment_and_url_fields(notebook_env):
    context = notebook_env["context"]
    notebook = notebook_service.create_notebook(
        context,
        title="Research notebook",
        visibility="private",
        conversation_mode="private_member",
        resource_ids=["resource-1"],
    )
    result = _run_queued_ingest(notebook_env["vault"])
    assert result["available_sources"] == 1

    detail = notebook_service.get_notebook(notebook["id"], context)
    assert detail["chat_ready"] is True
    hits = notebook_service.search_notebook(notebook["id"], "deterministic retrieval")
    assert hits["revision"] == 1
    assert "Grounded evidence" in hits["results"][0]["text"]
    assert all("SECRET RECORD METADATA" not in item["text"] for item in hits["results"])
    assert hits["results"][0]["citation"]["href"].startswith("gnosi-cite:?")


def test_removing_resource_excludes_active_revision_immediately(notebook_env):
    context = notebook_env["context"]
    notebook = notebook_service.create_notebook(
        context,
        title="Removal",
        visibility="private",
        conversation_mode="private_member",
        resource_ids=["resource-1"],
    )
    _run_queued_ingest(notebook_env["vault"])
    assert notebook_service.search_notebook(notebook["id"], "evidence")["results"]

    notebook_service.remove_resource(notebook["id"], context, "resource-1")
    assert notebook_service.search_notebook(notebook["id"], "evidence")["results"] == []
    assert notebook_env["attachment"].exists()


def test_incremental_refresh_reuses_unchanged_attachment(notebook_env, monkeypatch):
    context = notebook_env["context"]
    notebook = notebook_service.create_notebook(
        context,
        title="Incremental",
        visibility="private",
        conversation_mode="private_member",
        resource_ids=["resource-1"],
    )
    _run_queued_ingest(notebook_env["vault"])
    monkeypatch.setattr(
        notebook_service.llm_wiki_extractors,
        "extract_resource_sources",
        lambda *_args, **_kwargs: pytest.fail("Unchanged attachment was re-extracted"),
    )
    notebook_service.request_refresh(
        notebook["id"], context, reason="test", force=True
    )
    result = _run_queued_ingest(notebook_env["vault"])
    assert result["revision"] == 2
    assert notebook_service.get_notebook(notebook["id"], context)["active_revision"] == 2


def test_failed_refresh_keeps_last_valid_source_as_stale(notebook_env, monkeypatch):
    context = notebook_env["context"]
    notebook = notebook_service.create_notebook(
        context,
        title="Stale fallback",
        visibility="private",
        conversation_mode="private_member",
        resource_ids=["resource-1"],
    )
    _run_queued_ingest(notebook_env["vault"])
    table, source_config, _pages = notebook_service._current_resource_snapshot(  # noqa: SLF001
        notebook
    )
    monkeypatch.setattr(
        notebook_service,
        "_current_resource_snapshot",
        lambda _notebook: (table, source_config, []),
    )

    notebook_service.request_refresh(notebook["id"], context, reason="test", force=True)
    result = _run_queued_ingest(notebook_env["vault"])

    assert result["revision"] == 2
    detail = notebook_service.get_notebook(notebook["id"], context)
    assert detail["active_revision"] == 2
    assert detail["source_counts"]["stale"] == 1
    assert notebook_service.search_notebook(notebook["id"], "deterministic")["results"]


def test_three_hundred_resources_are_paged_with_multiple_sources(notebook_env, monkeypatch):
    context = notebook_env["context"]
    table, _source_config, _pages = notebook_service._current_resource_snapshot(  # noqa: SLF001
        {"source_table_id": "references-table"}
    )
    pages = [
        SimpleNamespace(
            id=f"resource-{index}",
            title=f"Resource {index:03d}",
            last_modified="2026-08-20T10:00:00+00:00",
            metadata={
                "files-field": ["evidence.txt", "second.pdf"],
                "url-field": f"https://example.org/{index}",
                "notes-field": "Excluded metadata",
                "database_table_id": table["id"],
            },
        )
        for index in range(300)
    ]
    monkeypatch.setattr(
        notebook_service,
        "_reference_table",
        lambda: (table["id"], table, pages),
    )

    selector_page = notebook_service.list_reference_resources(
        context, page=2, page_size=125
    )
    assert selector_page["total"] == 300
    assert len(selector_page["items"]) == 125
    assert selector_page["items"][0]["source_count"] == 3

    notebook = notebook_service.create_notebook(
        context,
        title="Load boundary",
        visibility="workspace",
        conversation_mode="shared",
        resource_ids=[page.id for page in pages],
    )
    assert notebook_service.get_notebook(notebook["id"], context)["resource_count"] == 300


def test_resource_selector_excludes_items_already_in_notebook(notebook_env):
    context = notebook_env["context"]
    notebook = notebook_service.create_notebook(
        context,
        title="Selector exclusion",
        visibility="private",
        conversation_mode="private_member",
        resource_ids=["resource-1"],
    )

    selector = notebook_service.list_reference_resources(
        context,
        page=1,
        page_size=50,
        exclude_notebook_id=notebook["id"],
    )

    assert selector["total"] == 0
    assert selector["items"] == []


def test_private_and_workspace_permissions_are_isolated(notebook_env):
    owner = notebook_env["context"]
    private_notebook = notebook_service.create_notebook(
        owner,
        title="Private",
        visibility="private",
        conversation_mode="private_member",
        resource_ids=["resource-1"],
    )
    other = WorkspaceContext(
        owner.workspace_id,
        "user-2",
        "editor",
        owner.vault_path,
        ["read", "write"],
    )
    with pytest.raises(HTTPException) as private_error:
        notebook_service.authorize(private_notebook["id"], other)
    assert private_error.value.status_code == 404

    notebook_service.update_notebook(
        private_notebook["id"], owner, visibility="workspace"
    )
    assert notebook_service.authorize(private_notebook["id"], other)["id"] == private_notebook["id"]
    with pytest.raises(HTTPException) as manage_error:
        notebook_service.authorize(private_notebook["id"], other, action="manage")
    assert manage_error.value.status_code == 403


def test_conversation_modes_keep_distinct_checkpoint_principals(notebook_env):
    context = notebook_env["context"]
    notebook = notebook_service.create_notebook(
        context,
        title="Conversation modes",
        visibility="workspace",
        conversation_mode="private_member",
        resource_ids=["resource-1"],
    )
    private_principal = notebook_service.conversation_principal(notebook, "user-1")
    assert private_principal.endswith(":member:user-1")
    shared = notebook_service.update_notebook(
        notebook["id"], context, conversation_mode="shared"
    )
    shared_principal = notebook_service.conversation_principal(shared, "user-1")
    assert shared_principal.endswith(":shared")
    assert shared_principal != private_principal

    notebook_service.register_conversation_principal(notebook, "user-1")
    notebook_service.register_conversation_principal(shared, "user-2")
    scopes = notebook_service.conversation_scopes(notebook["id"], context)
    assert {item["principal_id"] for item in scopes} == {
        private_principal,
        shared_principal,
    }


def test_whole_notebook_analysis_is_durable_and_revision_pinned(notebook_env, monkeypatch):
    context = notebook_env["context"]
    notebook = notebook_service.create_notebook(
        context,
        title="Whole notebook",
        visibility="private",
        conversation_mode="private_member",
        resource_ids=["resource-1"],
    )
    _run_queued_ingest(notebook_env["vault"])
    monkeypatch.setattr(
        notebook_service,
        "_model_analysis",
        lambda prompt, request: f"Summary for {request}: {len(prompt)} chars",
    )
    started = notebook_service.start_notebook_analysis(
        notebook["id"],
        "Compare every source",
        revision=1,
    )
    assert started["state"] == "queued"
    job = durable_job_queue.ready_jobs(job_type="notebook_analysis", limit=1)[0]
    worker_id = "analysis-worker"
    assert durable_job_queue.claim(job["job_id"], worker_id=worker_id)
    result = notebook_service._run_analysis(  # noqa: SLF001
        notebook_env["vault"], job["job_id"], worker_id
    )
    assert durable_job_queue.complete(job["job_id"], worker_id, result)
    completed = notebook_service.get_notebook_analysis(
        notebook["id"], started["analysis_id"], revision=1, include_result=True
    )
    assert completed["state"] == "completed"
    assert completed["result"]["revision"] == 1
    assert completed["result"]["chunk_ids"]
