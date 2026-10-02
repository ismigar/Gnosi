"""Recorded planning callbacks select only known, unchanged application code."""

import json
from dataclasses import replace
from types import ModuleType

from fastapi import BackgroundTasks, HTTPException
import pytest

from backend.domains.vault.pages.creation_callbacks import CreationCallbacks
from backend.domains.vault.pages.creation_requests import CreationRequests, _create_with_receipt
from backend.domains.vault.pages.creation_recovery import recover_creation
from backend.domains.vault.schemas.pages import PageSaveRequest
from backend.services import planning_scheduler
from backend.tests.test_page_creation_responsiveness import dependencies


@pytest.fixture
def state(tmp_path, monkeypatch):
    calls = []
    def enqueue(vault_path):
        assert vault_path == tmp_path
        calls.append("planning")
    monkeypatch.setattr(planning_scheduler, "enqueue_recalculation", enqueue)
    def save(path, metadata, body): path.write_text(json.dumps(metadata) + "\n\n" + body)
    def parse(raw, _path):
        metadata, body = raw.split("\n\n", 1); return json.loads(metadata), body
    def stop(*_args): raise HTTPException(503, "Stopped after queue registration")
    ports = dependencies(tmp_path, save_page=save, parse_frontmatter=parse,
        queue_planning=lambda tasks: tasks.add_task(enqueue, tmp_path), resolve_page_context=stop,
        update_link_index=lambda *_args: calls.append("links"),
        propagate_relations=lambda *_args: calls.append("relations"))
    ledger = CreationRequests(tmp_path / "receipts.sqlite")
    with pytest.raises(HTTPException):
        _create_with_receipt(ledger, "s", "k", tmp_path, PageSaveRequest(title="QA", content="Body"), BackgroundTasks(), "u", ports)
    ports = replace(ports, resolve_page_context=lambda *_args: ("QA", None))
    assert not calls
    return ledger, ports, calls, enqueue


def test_registered_pending_planning_resumes_once_without_registering_again(state, tmp_path):
    ledger, ports, calls, enqueue = state
    assert CreationCallbacks(ledger._connect, "s", "k").resolve("planning:0") is enqueue
    status = ledger.status("s", "k", vault_path=tmp_path, dependencies=ports)
    assert status["can_resume"] is True
    before = (tmp_path / "QA.md").read_bytes()
    def forbidden(_tasks): raise AssertionError("Completed planning queue must not repeat")
    ports = replace(ports, queue_planning=forbidden)
    result = recover_creation(ledger, "s", "k", tmp_path, ports, guard=lambda: None)
    assert calls == ["links", "planning", "relations"] and result["content"] == "Body"
    assert (tmp_path / "QA.md").read_bytes() == before
    assert recover_creation(ledger, "s", "k", tmp_path, ports, guard=lambda: None) == result
    assert calls == ["links", "planning", "relations"]


@pytest.mark.parametrize("case", ["unknown_kind", "missing", "revision", "changed_code", "source", "incomplete_queue"])
def test_unverifiable_callback_cannot_execute_any_pending_effect(state, tmp_path, monkeypatch, case):
    ledger, ports, calls, enqueue = state
    with ledger._connect() as db:
        if case == "unknown_kind": db.execute("UPDATE creation_callbacks SET kind='os.system'")
        elif case == "missing": db.execute("DELETE FROM creation_callbacks")
        elif case == "revision": db.execute("UPDATE creation_callbacks SET revision='changed'")
        elif case == "changed_code":
            def different(vault_path): calls.append("different")
            monkeypatch.setattr(planning_scheduler, "enqueue_recalculation", different)
        elif case == "source": (tmp_path / "QA.md").write_text('user edit')
        elif case == "incomplete_queue": db.execute("UPDATE creation_steps SET state='pending' WHERE step='planning_queue'")
    with pytest.raises(HTTPException) as caught:
        recover_creation(ledger, "s", "k", tmp_path, ports, guard=lambda: None)
    assert caught.value.status_code == 409 and not calls


def test_a_spoofed_function_name_does_not_enter_the_allowlist(state):
    ledger, _, _, enqueue = state
    def spoof(*args): raise AssertionError("Untrusted callback ran")
    spoof.__module__ = enqueue.__module__
    spoof.__qualname__ = enqueue.__qualname__
    from backend.domains.vault.pages.creation_steps import CreationSteps
    CreationSteps(ledger._connect, "s", "k").plan(["planning:spoof"])
    callbacks = CreationCallbacks(ledger._connect, "s", "k")
    callbacks.capture("planning:spoof", spoof)
    with pytest.raises(HTTPException): callbacks.resolve("planning:spoof")


def test_unavailable_planning_source_blocks_all_pending_recovery_effects(state, tmp_path, monkeypatch):
    from backend.domains.vault.pages import creation_callbacks

    ledger, ports, calls, _enqueue = state
    original = creation_callbacks.inspect.getsourcefile
    monkeypatch.setattr(creation_callbacks.inspect, "getsourcefile",
                        lambda value: None if isinstance(value, ModuleType) else original(value))
    with pytest.raises(HTTPException) as caught:
        recover_creation(ledger, "s", "k", tmp_path, ports, guard=lambda: None)
    assert caught.value.status_code == 503
    assert not calls


def test_callback_is_revalidated_after_earlier_recovery_effects(state, tmp_path, monkeypatch):
    ledger, ports, calls, _enqueue = state
    def links(*_args):
        calls.append("links")
        def changed(vault_path): calls.append("changed-planning")
        monkeypatch.setattr(planning_scheduler, "enqueue_recalculation", changed)
    with pytest.raises(HTTPException) as caught:
        recover_creation(ledger, "s", "k", tmp_path, replace(ports, update_link_index=links), guard=lambda: None)
    assert caught.value.status_code == 409 and calls == ["links"]
    states = {item["step"]: item["state"] for item in ledger.status("s", "k")["steps"]}
    assert states["links"] == "completed" and states["planning:0"] == "pending"


@pytest.mark.parametrize("changed", [False, True])
def test_new_registered_callback_is_revalidated_before_execution(state, tmp_path, monkeypatch, changed):
    ledger, ports, calls, enqueue = state
    # Reproduce interruption before the planning queue registered any work.
    with ledger._connect() as db:
        db.execute("DELETE FROM creation_callbacks")
        db.execute("DELETE FROM creation_step_inputs WHERE step='planning:0'")
        db.execute("DELETE FROM creation_steps WHERE step='planning:0'")
        db.execute("UPDATE creation_steps SET state='pending' WHERE step='planning_queue'")
    def links(*_args):
        calls.append("links")
        if changed:
            def replacement(vault_path): calls.append("replacement")
            monkeypatch.setattr(planning_scheduler, "enqueue_recalculation", replacement)
    ports = replace(ports, update_link_index=links)
    if changed:
        with pytest.raises(HTTPException) as caught:
            recover_creation(ledger, "s", "k", tmp_path, ports, guard=lambda: None)
        assert caught.value.status_code == 409 and calls == ["links"]
        steps = {item["step"]: item["state"] for item in ledger.status("s", "k")["steps"]}
        assert steps["planning:0"] == "pending"
    else:
        recover_creation(ledger, "s", "k", tmp_path, ports, guard=lambda: None)
        assert calls == ["links", "planning", "relations"]
        assert CreationCallbacks(ledger._connect, "s", "k").resolve("planning:0") is enqueue
