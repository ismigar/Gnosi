"""Persist completed work and the ambiguous effect/checkpoint crash window."""

import asyncio
from pathlib import Path
import sqlite3
import subprocess
import sys

from fastapi import BackgroundTasks, HTTPException
import pytest

from backend.domains.vault.pages.creation_requests import CreationRequests, _create_with_receipt
from backend.domains.vault.pages.creation_steps import CreationSteps
from backend.domains.vault.schemas.pages import PageSaveRequest
from backend.tests.test_page_creation_responsiveness import dependencies


def test_success_has_only_completed_steps_and_no_unscheduled_formula(tmp_path):
    ledger = CreationRequests(tmp_path / "receipt.sqlite")
    _create_with_receipt(ledger, "s", "k", tmp_path, PageSaveRequest(title="QA", content="body"), BackgroundTasks(), "u", dependencies(tmp_path))
    status = ledger.status("s", "k")
    assert status["status"] == "completed" and status["steps"]
    assert all(step["state"] == "completed" for step in status["steps"])
    assert "formulas" not in [step["step"] for step in status["steps"]]


def test_process_crash_keeps_completed_formula_and_uncertain_link_effect(tmp_path):
    code = '''
import os, sys
from pathlib import Path
from fastapi import BackgroundTasks
from backend.domains.vault.pages.creation_requests import CreationRequests, _create_with_receipt
from backend.domains.vault.schemas.pages import PageSaveRequest
from backend.tests.test_page_creation_responsiveness import dependencies
root=Path(sys.argv[1])
def formula(*_args): (root / "effects").write_text("formula")
def links(*_args):
    with (root / "effects").open("a") as file: file.write("+links")
    os._exit(23)
ports=dependencies(root, get_table_id=lambda _metadata: "table", recompute_formulas=formula, update_link_index=links)
_create_with_receipt(CreationRequests(root / "receipt.sqlite"), "s", "k", root,
                    PageSaveRequest(title="QA", content="body"), BackgroundTasks(), "u", ports)
'''
    child = subprocess.run([sys.executable, "-c", code, str(tmp_path)],
                           cwd=Path(__file__).resolve().parents[2], capture_output=True, timeout=20)
    assert child.returncode == 23, child.stderr.decode()
    ledger = CreationRequests(tmp_path / "receipt.sqlite")
    states = {step["step"]: step["state"] for step in ledger.status("s", "k")["steps"]}
    assert states["formulas"] == "completed" and states["links"] == "uncertain" and states["relations"] == "pending"
    steps = CreationSteps(ledger._connect, "s", "k")
    effects = tmp_path / "effects"
    callback = lambda: effects.write_text("repeated")
    assert steps.wrap("formulas", callback)() is None
    with pytest.raises(HTTPException) as error:
        steps.wrap("links", callback)()
    assert error.value.status_code == 409
    assert effects.read_text() == "formula+links"
    assert (tmp_path / "QA.md").read_text() == "body"
    assert ledger.status("s", "k")["status"] == "unknown"


def test_async_and_planning_tasks_are_checkpointed_and_never_repeated(tmp_path):
    ledger = CreationRequests(tmp_path / "receipt.sqlite")
    calls = []
    async def relation(*_args):
        await asyncio.sleep(0)
        calls.append("relations")
    async def planning():
        await asyncio.sleep(0)
        calls.append("planning")
    ports = dependencies(tmp_path, propagate_relations=relation,
                         queue_planning=lambda tasks: tasks.add_task(planning))
    request = PageSaveRequest(title="QA", content="body")
    result = _create_with_receipt(ledger, "s", "k", tmp_path, request, BackgroundTasks(), "u", ports)
    states = {step["step"]: step["state"] for step in ledger.status("s", "k")["steps"]}
    assert states["planning:0"] == states["relations"] == "completed"
    assert _create_with_receipt(CreationRequests(tmp_path / "receipt.sqlite"), "s", "k", tmp_path, request, BackgroundTasks(), "u", ports) == result
    assert calls == ["planning", "relations"]


def test_schema_upgrade_preserves_existing_receipts_without_inventing_checkpoints(tmp_path):
    path = tmp_path / "receipt.sqlite"
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE creation_requests (scope TEXT, key TEXT, fingerprint TEXT, page_id TEXT, status TEXT, owner_pid INTEGER, created_at REAL, file_path TEXT, result TEXT, PRIMARY KEY(scope,key))")
        db.execute("INSERT INTO creation_requests VALUES ('s','k','f','page','completed',1,0,NULL,'{}')")
    status = CreationRequests(path).status("s", "k")
    assert status["status"] == "completed" and status["result"] == {} and status["steps"] == []


def test_step_namespace_requires_its_own_request_and_serializes_claims(tmp_path):
    ledger = CreationRequests(tmp_path / "receipt.sqlite")
    ledger.claim("s", "k", PageSaveRequest(title="QA", content=""))
    first = CreationSteps(ledger._connect, "s", "k")
    second = CreationSteps(CreationRequests(tmp_path / "receipt.sqlite")._connect, "s", "k")
    assert first.begin("links")
    with pytest.raises(HTTPException) as error:
        second.begin("links")
    assert error.value.status_code == 409
    first.complete("links")
    assert not second.begin("links")
    with pytest.raises(HTTPException) as error:
        CreationSteps(ledger._connect, "other", "k").begin("links")
    assert error.value.status_code == 404
