"""A terminated creator's unstarted effects can continue once, with frozen inputs."""

import json
import asyncio
from dataclasses import replace
import os
from pathlib import Path
import subprocess
import sys
import threading

from fastapi import BackgroundTasks, FastAPI, HTTPException
import httpx
import pytest

from backend.domains.vault.pages.creation_recovery import recover_creation
from backend.domains.vault.pages.creation_requests import CreationRequests, _create_with_receipt
from backend.tests.test_page_creation_responsiveness import dependencies
from backend.domains.vault.schemas.pages import PageSaveRequest


@pytest.fixture
def state(tmp_path):
    calls = []
    def save(path, metadata, body):
        path.write_text(json.dumps(metadata) + "\n\n" + body)
    def parse(raw, _path):
        metadata, body = raw.split("\n\n", 1)
        return json.loads(metadata), body
    def stop(*_args):
        raise HTTPException(503, "Creator stopped after storage")
    ports = dependencies(tmp_path, save_page=save, parse_frontmatter=parse, checkpoint_post_save=stop,
        index_created_page=lambda *_args: calls.append("index"),
        invalidate_page_responses=lambda: calls.append("cache"),
        add_page_index=lambda *_args: calls.append("sidebar"),
        update_link_index=lambda *_args: calls.append("links"),
        propagate_relations=lambda *_args: calls.append("relations"),
        emit_created=lambda *_args: calls.append("event"),
        queue_planning=lambda tasks: tasks.add_task(lambda: calls.append("planning")))
    ledger = CreationRequests(tmp_path / "receipts.sqlite")
    request = PageSaveRequest(title="QA", content="Body", metadata={"zero": 0, "checked": False})
    with pytest.raises(HTTPException):
        _create_with_receipt(ledger, "scope", "key", tmp_path, request, BackgroundTasks(), "user", ports)
    assert not calls and ledger.status("scope", "key")["status"] == "unknown"
    return ledger, ports, calls, request


def run(state, tmp_path, **changes):
    ledger, ports, _calls, _request = state
    guard = changes.pop("guard", lambda: None)
    return recover_creation(ledger, "scope", "key", tmp_path, replace(ports, **changes), guard=guard)


def test_pending_effects_complete_once_and_return_the_original_identity(state, tmp_path):
    ledger, _ports, calls, request = state
    before = (tmp_path / "QA.md").read_bytes()
    result = run(state, tmp_path)
    assert calls == ["index", "cache", "sidebar", "event", "links", "planning", "relations"]
    assert result["id"] == ledger.status("scope", "key")["page_id"]
    assert result["metadata"]["zero"] == 0 and result["metadata"]["checked"] is False
    assert result["content"] == "Body" and (tmp_path / "QA.md").read_bytes() == before
    assert all(item["state"] == "completed" for item in ledger.status("scope", "key")["steps"])
    assert run(state, tmp_path) == result and len(calls) == 7
    assert ledger.claim("scope", "key", request)[1] == result


@pytest.mark.parametrize("case", ["source", "config", "payload", "uncertain", "unknown_callback", "unsaved", "outside", "invalid_state", "invalid_path"])
def test_invalid_recovery_cannot_execute_any_callback(state, tmp_path, case):
    ledger, _ports, calls, _request = state
    expected = 409
    with ledger._connect() as db:
        if case == "source": (tmp_path / "QA.md").write_text("user edit")
        elif case == "config":
            (tmp_path / ".gnosi").mkdir(); (tmp_path / ".gnosi/params.yaml").write_text("changed: true")
        elif case == "payload": db.execute("UPDATE creation_payloads SET request='{}'")
        elif case == "uncertain": db.execute("UPDATE creation_steps SET state='started' WHERE step='index'")
        elif case == "unknown_callback": db.execute("INSERT INTO creation_steps VALUES ('scope','key','planning:old','pending',99)")
        elif case == "unsaved": db.execute("UPDATE creation_steps SET state='started' WHERE step='save'")
        elif case == "outside":
            db.execute("UPDATE creation_requests SET file_path=?", (str(tmp_path.parent / "private.md"),)); expected = 403
        elif case == "invalid_state": db.execute("UPDATE creation_steps SET state='broken' WHERE step='links'")
        elif case == "invalid_path": db.execute("UPDATE creation_requests SET file_path=NULL")
    with pytest.raises(HTTPException) as caught:
        run(state, tmp_path)
    assert caught.value.status_code == expected
    assert calls == [] and ledger.status("scope", "key")["status"] == "unknown"


def test_an_expired_live_worker_cannot_be_taken_over(state, tmp_path):
    ledger, _ports, calls, _request = state
    with ledger._connect() as db:
        db.execute("UPDATE creation_requests SET status='pending',created_at=0,owner_pid=?", (os.getpid(),))
    with pytest.raises(HTTPException, match="still running"):
        run(state, tmp_path)
    assert not calls


def test_parallel_recovery_has_one_owner(state, tmp_path):
    ledger, _ports, calls, _request = state
    entered, release = threading.Event(), threading.Event()
    result = []
    def index(*_args):
        calls.append("index"); entered.set(); assert release.wait(3)
    def worker():
        result.append(run(state, tmp_path, index_created_page=index))
    first = threading.Thread(target=worker); first.start()
    try:
        assert entered.wait(2)
        with pytest.raises(HTTPException, match="still running"):
            run(state, tmp_path)
    finally:
        release.set(); first.join(3)
    assert len(result) == 1 and calls.count("index") == 1


def test_callback_failure_retains_uncertainty_and_never_repeats_it(state, tmp_path):
    ledger, _ports, calls, _request = state
    def links(*_args):
        calls.append("links-effect"); raise RuntimeError("Failure after effect")
    with pytest.raises(RuntimeError): run(state, tmp_path, update_link_index=links)
    with pytest.raises(HTTPException, match="uncertain"): run(state, tmp_path)
    assert calls.count("links-effect") == 1 and "relations" not in calls
    states = {item["step"]: item["state"] for item in ledger.status("scope", "key")["steps"]}
    assert states["links"] == "uncertain" and states["relations"] == "pending"


def test_revoked_permission_prevents_recovery_claim(state, tmp_path):
    def revoked(): raise HTTPException(403, "revoked")
    with pytest.raises(HTTPException) as caught: run(state, tmp_path, guard=revoked)
    assert caught.value.status_code == 403 and state[2] == []


def test_completed_callbacks_are_skipped_and_revocation_keeps_unstarted_work_pending(state, tmp_path):
    ledger, _ports, calls, _request = state
    with ledger._connect() as db:
        db.execute("UPDATE creation_steps SET state='completed' WHERE step='index'")
    def guard():
        if "cache" in calls: raise HTTPException(403, "revoked")
    with pytest.raises(HTTPException) as caught: run(state, tmp_path, guard=guard)
    assert caught.value.status_code == 403 and calls == ["cache"]
    states = {item["step"]: item["state"] for item in ledger.status("scope", "key")["steps"]}
    assert states["index"] == states["page_cache"] == "completed"
    assert states["sidebar_index"] == "pending"


def test_new_async_planning_work_is_guarded_before_execution(state, tmp_path):
    ledger, _ports, calls, _request = state
    async def planning(): calls.append("async-planning")
    def guard():
        if "links" in calls: raise HTTPException(403, "revoked")
    with pytest.raises(HTTPException):
        run(state, tmp_path, queue_planning=lambda tasks: tasks.add_task(planning), guard=guard)
    assert "async-planning" not in calls and "relations" not in calls
    states = {item["step"]: item["state"] for item in ledger.status("scope", "key")["steps"]}
    assert states["links"] == "completed" and states["planning:0"] == "pending"


def test_dead_process_recovery_preserves_saved_file_and_never_runs_storage_again(tmp_path):
    code = '''
import json,os,sys
from pathlib import Path
from fastapi import BackgroundTasks
from backend.domains.vault.pages.creation_requests import CreationRequests,_create_with_receipt
from backend.domains.vault.schemas.pages import PageSaveRequest
from backend.tests.test_page_creation_responsiveness import dependencies
root=Path(sys.argv[1])
def save(path,metadata,body): path.write_text(json.dumps(metadata)+"\\n\\n"+body)
ports=dependencies(root,save_page=save,checkpoint_post_save=lambda *_args:os._exit(23))
_create_with_receipt(CreationRequests(root/"receipts.sqlite"),"scope","key",root,
    PageSaveRequest(title="QA",content="Body"),BackgroundTasks(),"user",ports)
'''
    child = subprocess.run([sys.executable, "-c", code, str(tmp_path)],
                           cwd=Path(__file__).resolve().parents[2], capture_output=True, timeout=20)
    assert child.returncode == 23, child.stderr.decode()
    ledger = CreationRequests(tmp_path / "receipts.sqlite")
    original = (tmp_path / "QA.md").read_bytes()
    def parse(raw, _path):
        metadata, body = raw.split("\n\n", 1); return json.loads(metadata), body
    def forbidden(*_args): raise AssertionError("Storage must never repeat")
    ports = dependencies(tmp_path, parse_frontmatter=parse, save_page=forbidden)
    result = recover_creation(ledger, "scope", "key", tmp_path, ports, guard=lambda: None)
    assert result["id"] == json.loads(original.split(b"\n\n", 1)[0])["id"]
    assert ledger.status("scope", "key")["status"] == "completed"
    assert (tmp_path / "QA.md").read_bytes() == original


def test_async_planning_may_update_metadata_without_invalidating_its_own_following_work(state, tmp_path):
    ledger, _ports, calls, _request = state
    async def planning():
        path = tmp_path / "QA.md"
        raw, body = path.read_text().split("\n\n", 1)
        metadata = json.loads(raw); metadata["planned"] = True
        path.write_text(json.dumps(metadata) + "\n\n" + body)
        calls.append("async-planning")
    result = run(state, tmp_path, queue_planning=lambda tasks: tasks.add_task(planning))
    assert result["metadata"]["planned"] is True and result["content"] == "Body"
    assert calls[-2:] == ["async-planning", "relations"]
    assert ledger.status("scope", "key")["status"] == "completed"


def test_health_and_cancelled_waiter_do_not_interrupt_recovery_worker(state, tmp_path, monkeypatch):
    from backend.domains.vault.pages import creation_recovery as service
    from backend.services.context_vars import active_vault_path
    ledger, ports, calls, _request = state
    entered, release, finished = threading.Event(), threading.Event(), threading.Event()
    def index(*_args):
        assert active_vault_path.get() == tmp_path
        entered.set(); assert release.wait(3); calls.append("index")
    def relation(*_args): calls.append("relations"); finished.set()
    ports = replace(ports, index_created_page=index, propagate_relations=relation)
    monkeypatch.setattr(service, "CreationRequests", lambda: ledger)
    monkeypatch.setattr(service, "creation_scope", lambda *_args: "scope")
    app = FastAPI()
    @app.get("/health")
    async def health(): return {"ok": True}
    @app.post("/recover")
    async def recover():
        return await service.recover_page_creation("u", "w", tmp_path, "key", ports, guard=lambda: None)
    async def exercise():
        token = active_vault_path.set(tmp_path)
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://qa") as client:
                request = asyncio.create_task(client.post("/recover"))
                try:
                    assert await asyncio.to_thread(entered.wait, 2)
                    response = await asyncio.wait_for(client.get("/health"), 0.5)
                    assert response.status_code == 200 and not request.done()
                    request.cancel()
                    with pytest.raises(asyncio.CancelledError): await request
                finally:
                    release.set()
                assert await asyncio.to_thread(finished.wait, 2)
        finally:
            active_vault_path.reset(token)
    asyncio.run(exercise())
    assert ledger.status("scope", "key")["status"] == "completed"
    assert calls.count("index") == calls.count("relations") == 1
