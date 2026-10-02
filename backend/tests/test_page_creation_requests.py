"""Creation receipts protect actual writes, including disconnected callers."""

import asyncio
from concurrent.futures import ThreadPoolExecutor
import sqlite3
import threading
from types import SimpleNamespace

from fastapi import APIRouter, BackgroundTasks, FastAPI, HTTPException
import httpx
import pytest

from backend.domains.vault.pages.creation_requests import (
    CreationRequests, _create_with_receipt, create_page_with_receipt, creation_scope,
)
from backend.domains.vault.api.pages_commands import register_create_route
from backend.domains.vault.schemas.pages import PageSaveRequest
from backend.services.context_vars import active_vault_path
from backend.tests.test_page_creation_responsiveness import dependencies


def test_completed_retry_is_durable_and_does_not_overwrite_later_edits(tmp_path):
    ledger_path = tmp_path / "receipts.sqlite"
    request = PageSaveRequest(title="Page", content="original", metadata={"zero": 0, "false": False, "empty": ""})
    effects = []
    ports = dependencies(tmp_path, update_link_index=lambda _path: effects.append("links"),
                         propagate_relations=lambda *_args: effects.append("relations"))
    tasks = BackgroundTasks()
    result = _create_with_receipt(CreationRequests(ledger_path), "scope", "key", tmp_path, request, tasks, "user", ports)
    (tmp_path / "Page.md").write_text("later edit")
    replay_tasks = BackgroundTasks()
    replay = _create_with_receipt(CreationRequests(ledger_path), "scope", "key", tmp_path, request, replay_tasks, "user", ports)
    assert replay == result
    assert replay["metadata"]["zero"] == 0 and replay["metadata"]["false"] is False
    assert (tmp_path / "Page.md").read_text() == "later edit"
    assert not tasks.tasks and not replay_tasks.tasks
    assert effects == ["links", "relations"]
    assert CreationRequests(ledger_path).status("scope", "key")["status"] == "completed"


def test_conflicting_payload_and_scope_isolation(tmp_path):
    ledger = CreationRequests(tmp_path / "receipts.sqlite")
    request = PageSaveRequest(title="A", content="")
    first, _ = ledger.claim("first", "key", request)
    with pytest.raises(HTTPException) as error:
        ledger.claim("first", "key", request.model_copy(update={"title": "B"}))
    assert error.value.status_code == 409
    second, _ = ledger.claim("second", "key", request)
    assert second != first
    with pytest.raises(HTTPException) as error:
        ledger.status("third", "key")
    assert error.value.status_code == 404
    assert creation_scope("u", "w", tmp_path) != creation_scope("other", "w", tmp_path)
    assert creation_scope("u", "w", tmp_path) != creation_scope("u", "other", tmp_path)
    assert creation_scope("u", "w", tmp_path) != creation_scope("u", "w", tmp_path / "other")


def test_concurrent_retry_does_not_enter_second_write(tmp_path):
    ledger = CreationRequests(tmp_path / "receipts.sqlite")
    entered, release = threading.Event(), threading.Event()
    writes = []
    def save(path, _metadata, body):
        writes.append(path)
        entered.set()
        assert release.wait(3)
        path.write_text(body)
    ports = dependencies(tmp_path, save_page=save)
    request = PageSaveRequest(title="Page", content="body")
    with ThreadPoolExecutor(2) as pool:
        pending = pool.submit(_create_with_receipt, ledger, "s", "k", tmp_path, request, BackgroundTasks(), "u", ports)
        try:
            assert entered.wait(2)
            with pytest.raises(HTTPException) as error:
                _create_with_receipt(ledger, "s", "k", tmp_path, request, BackgroundTasks(), "u", ports)
            assert error.value.status_code == 409
            assert ledger.status("s", "k")["status"] == "pending"
        finally:
            release.set()
        assert pending.result()["status"] == "created"
    assert len(writes) == 1


@pytest.mark.parametrize("phase", ["metadata", "write", "index"])
def test_failed_creation_is_unknown_and_cannot_be_reexecuted(tmp_path, phase):
    ledger = CreationRequests(tmp_path / "receipts.sqlite")
    def fail(*_args):
        raise RuntimeError("synthetic failure")
    changes = {"metadata": {"normalize_metadata": fail}, "write": {"save_page": fail}, "index": {"index_created_page": fail}}
    ports = dependencies(tmp_path, **changes[phase])
    request = PageSaveRequest(title="Page", content="body")
    with pytest.raises((HTTPException, RuntimeError)):
        _create_with_receipt(ledger, "s", "k", tmp_path, request, BackgroundTasks(), "u", ports)
    assert ledger.status("s", "k")["status"] == "unknown"
    assert (tmp_path / "Page.md").exists() is (phase == "index")
    with pytest.raises(HTTPException) as error:
        _create_with_receipt(ledger, "s", "k", tmp_path, request, BackgroundTasks(), "u", dependencies(tmp_path))
    assert error.value.status_code == 409


def test_cancelled_waiter_still_commits_worker_receipt(tmp_path, monkeypatch):
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path / "data"))
    entered, release, finished = threading.Event(), threading.Event(), threading.Event()
    def save(path, _metadata, body):
        entered.set()
        assert release.wait(3)
        path.write_text(body)
    original_finish = CreationRequests.finish
    def finish(self, *args):
        original_finish(self, *args)
        finished.set()
    monkeypatch.setattr(CreationRequests, "finish", finish)
    request = PageSaveRequest(title="Page", content="body")
    effects = []
    async def relations(*_args):
        assert active_vault_path.get() == tmp_path
        effects.append("relations")
    ports = dependencies(tmp_path, save_page=save,
                         get_table_id=lambda _meta: "qa-table",
                         recompute_formulas=lambda *_args: effects.append("formulas"),
                         update_link_index=lambda _path: effects.append("links"),
                         propagate_relations=relations)
    async def run():
        token = active_vault_path.set(tmp_path)
        task = asyncio.create_task(create_page_with_receipt(request, BackgroundTasks(), "u", "w", tmp_path, "k", ports))
        try:
            assert await asyncio.to_thread(entered.wait, 2)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        finally:
            release.set()
            active_vault_path.reset(token)
        assert await asyncio.to_thread(finished.wait, 2)
    asyncio.run(run())
    status = CreationRequests().status(creation_scope("u", "w", tmp_path), "k")
    assert status["status"] == "completed" and status["result"]["content"] == "body"
    assert effects == ["formulas", "links", "relations"]


def test_callback_failure_does_not_claim_completion_or_repeat_write(tmp_path):
    ledger = CreationRequests(tmp_path / "receipts.sqlite")
    def fail(*_args):
        raise RuntimeError("relation update failed")
    request = PageSaveRequest(title="Page", content="body")
    ports = dependencies(tmp_path, propagate_relations=fail)
    with pytest.raises(RuntimeError, match="relation update failed"):
        _create_with_receipt(ledger, "s", "k", tmp_path, request, BackgroundTasks(), "u", ports)
    assert (tmp_path / "Page.md").read_text() == "body"
    assert ledger.status("s", "k")["status"] == "unknown"
    with pytest.raises(HTTPException) as error:
        _create_with_receipt(ledger, "s", "k", tmp_path, request, BackgroundTasks(), "u", dependencies(tmp_path))
    assert error.value.status_code == 409


def test_expired_pending_operation_never_becomes_retryable(tmp_path):
    path = tmp_path / "receipts.sqlite"
    ledger = CreationRequests(path)
    request = PageSaveRequest(title="Page", content="body")
    ledger.claim("s", "k", request)
    with sqlite3.connect(path) as db:
        db.execute("UPDATE creation_requests SET created_at=0")
    assert ledger.status("s", "k")["status"] == "unknown"
    with pytest.raises(HTTPException) as error:
        ledger.claim("s", "k", request)
    assert error.value.status_code == 409


def test_outside_vault_path_is_rejected_before_file_write(tmp_path):
    vault = tmp_path / "vault"
    vault.mkdir()
    ports = dependencies(vault, unique_file_path=lambda *_args: tmp_path / "outside.md")
    ledger = CreationRequests(tmp_path / "receipts.sqlite")
    with pytest.raises(HTTPException) as error:
        _create_with_receipt(ledger, "s", "k", vault, PageSaveRequest(title="Page", content="body"), BackgroundTasks(), "u", ports)
    assert error.value.status_code == 403
    assert not (tmp_path / "outside.md").exists()


@pytest.mark.parametrize("key", ["", "../key", "a" * 129, "key\n"])
def test_invalid_keys_do_not_reserve_requests(tmp_path, key):
    ledger = CreationRequests(tmp_path / "receipts.sqlite")
    with pytest.raises(HTTPException) as error:
        ledger.claim("s", key, PageSaveRequest(title="Page", content="body"))
    assert error.value.status_code == 422


def test_http_receipts_require_editor_and_selected_workspace(tmp_path, monkeypatch):
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path / "data"))
    context = SimpleNamespace(user_id="u", workspace_id="w", vault_path=tmp_path)
    access = {"editor": True}
    def editor():
        if not access["editor"]:
            raise HTTPException(403, "Editor required")
    app = FastAPI()
    router = APIRouter()
    register_create_route(router, editor_dependency=editor,
                          workspace_context_dependency=lambda: context, dependencies=dependencies(tmp_path))
    app.include_router(router)
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://qa") as client:
            body = {"title": "Page", "content": "body"}
            first = await client.post("/pages", json=body, headers={"Idempotency-Key": "k"})
            assert first.status_code == 200
            receipt = await client.get("/pages/creation-requests/k")
            assert receipt.status_code == 200 and receipt.json()["result"] == first.json()
            retry = await client.post("/pages", json=body, headers={"Idempotency-Key": "k"})
            assert retry.json() == first.json()
            access["editor"] = False
            assert (await client.get("/pages/creation-requests/k")).status_code == 403
            assert (await client.post("/pages", json=body, headers={"Idempotency-Key": "k"})).status_code == 403
            access["editor"] = True
            context.workspace_id = "other"
            assert (await client.get("/pages/creation-requests/k")).status_code == 404
    asyncio.run(run())
