"""Frozen typed inputs and revision guards prepare safe continuation."""

import asyncio
from datetime import date, datetime, timezone
from decimal import Decimal
import json
from pathlib import Path
import sqlite3
import uuid

from fastapi import HTTPException
import pytest

from backend.domains.vault.pages.creation_inputs import CreationInputs, pack, unpack
from backend.domains.vault.pages.creation_requests import CreationRequests
from backend.domains.vault.pages.creation_steps import CreationSteps, OperationTasks
from backend.domains.vault.schemas.pages import PageSaveRequest


def setup(tmp_path):
    ledger = CreationRequests(tmp_path / "receipt.sqlite")
    ledger.claim("s", "k", PageSaveRequest(title="QA", content=""))
    path = tmp_path / "QA.md"; path.write_text("original")
    ledger.record_path("s", "k", path)
    steps = CreationSteps(ledger._connect, "s", "k")
    CreationInputs(ledger._connect, "s", "k").capture_context(tmp_path)
    return ledger, steps, CreationInputs(ledger._connect, "s", "k"), path


def test_frozen_arguments_preserve_types_and_are_captured_when_queued(tmp_path):
    ledger, steps, inputs, path = setup(tmp_path)
    args = {"zero": 0, "checked": False, "empty": "", "date": date(2026, 3, 15),
            "time": datetime(2026, 3, 15, tzinfo=timezone.utc), "tuple": ("a", False),
            "amount": Decimal("0.10"), "id": uuid.uuid4(), "set": frozenset({"a", "b"})}
    called = []
    async def callback(metadata, file):
        await asyncio.sleep(0)
        called.append((metadata, file))
    tasks = OperationTasks(steps)
    tasks.add_task(steps.wrap("relations", callback), args, path)
    args["zero"] = 99
    restored, kwargs = CreationInputs(CreationRequests(tmp_path / "receipt.sqlite")._connect, "s", "k").load_pending("relations", tmp_path)
    assert restored[0]["zero"] == 0 and restored[0]["checked"] is False and restored[0]["empty"] == ""
    assert type(restored[0]["date"]) is date and restored[0]["time"].tzinfo is not None
    assert restored[0]["amount"] == Decimal("0.10") and type(restored[0]["tuple"]) is tuple
    assert restored[0]["id"] == args["id"] and restored[0]["set"] == frozenset({"a", "b"})
    assert restored[1] == path and isinstance(restored[1], Path) and kwargs == {}
    assert not called and path.read_text() == "original"
    with pytest.raises(HTTPException) as error:
        asyncio.run(tasks())
    assert error.value.status_code == 409 and not called


@pytest.mark.parametrize("change", ["edit", "delete", "symlink"])
def test_resume_inputs_reject_changed_or_replaced_document(tmp_path, change):
    ledger, steps, inputs, path = setup(tmp_path)
    steps.plan(["links"]); inputs.capture("links", (path,), {})
    if change == "edit": path.write_text("user edit")
    elif change == "delete": path.unlink()
    else:
        path.unlink(); target = tmp_path.parent / (uuid.uuid4().hex + ".md"); target.write_text("private")
        try:
            path.symlink_to(target)
            with pytest.raises(HTTPException) as error:
                inputs.load_pending("links", tmp_path)
            assert error.value.status_code == 403
        finally: target.unlink()
        return
    with pytest.raises(HTTPException) as error:
        inputs.load_pending("links", tmp_path)
    assert error.value.status_code == 409


def test_pending_save_requires_absence_and_cannot_overwrite_an_appeared_file(tmp_path):
    ledger, steps, inputs, _path = setup(tmp_path)
    target = tmp_path / "New.md"
    steps.plan(["save"]); inputs.capture("save", (target, {"id": "reserved"}, "body"), {})
    assert inputs.load_pending("save", tmp_path)[0][0] == target
    target.write_text("somebody else's page")
    with pytest.raises(HTTPException) as error:
        inputs.load_pending("save", tmp_path)
    assert error.value.status_code == 409 and target.read_text() == "somebody else's page"


@pytest.mark.parametrize("args", [(), (0,), (False,), (None,), ({"path": "QA.md"},)])
def test_invalid_save_target_is_rejected_without_freezing_replay_data(tmp_path, args):
    ledger, steps, inputs, path = setup(tmp_path)
    steps.plan(["save"])
    with pytest.raises(HTTPException) as caught:
        inputs.capture("save", args, {})
    assert caught.value.status_code == 409
    with ledger._connect() as db:
        assert db.execute("SELECT COUNT(*) FROM creation_step_inputs WHERE step='save'").fetchone()[0] == 0
    assert path.read_text() == "original"


@pytest.mark.parametrize("state", ["started", "completed"])
def test_only_unstarted_steps_can_prepare_inputs(tmp_path, state):
    ledger, steps, inputs, path = setup(tmp_path)
    steps.plan(["links"]); inputs.capture("links", (path,), {})
    steps.begin("links")
    if state == "completed": steps.complete("links")
    with pytest.raises(HTTPException) as error:
        inputs.load_pending("links", tmp_path)
    assert error.value.status_code == 409


def test_missing_history_and_corrupt_payload_do_not_invent_replay_inputs(tmp_path):
    ledger, steps, inputs, path = setup(tmp_path)
    steps.plan(["links"])
    with pytest.raises(HTTPException): inputs.load_pending("links", tmp_path)
    inputs.capture("links", (path,), {})
    with sqlite3.connect(ledger.path) as db:
        db.execute("UPDATE creation_step_inputs SET payload=?", (json.dumps(["unknown_constructor", "data"]),))
    with pytest.raises(HTTPException) as error:
        inputs.load_pending("links", tmp_path)
    assert error.value.status_code == 409
    with pytest.raises(HTTPException): CreationInputs(ledger._connect, "other", "k").load_pending("links", tmp_path)


@pytest.mark.parametrize("value", [float("nan"), float("inf"), Decimal("NaN"), object()])
def test_unsupported_or_nonfinite_values_are_never_stored(value):
    with pytest.raises(TypeError): pack(value)


def test_literal_data_that_resembles_tags_is_not_interpreted_as_code():
    value = {"tuple": ["path", "/outside"], "date": ["date", "not a date"]}
    assert unpack(pack(value)) == value


@pytest.mark.parametrize("payload", [
    ["uuid", 123], ["decimal", "not a number"], ["path", []],
    ["dict", [["broken"]]], ["tuple", "abc"],
    ["list", [["tuple", []], ["dict", []]]],
    ["tuple", [["tuple", []]]],
    ["dict", [[["scalar", "key"], ["scalar", 1]], [["scalar", "key"], ["scalar", 2]]]],
])
def test_malformed_saved_values_return_controlled_conflict(tmp_path, payload):
    ledger, steps, inputs, path = setup(tmp_path)
    steps.plan(["links"]); inputs.capture("links", (path,), {})
    with sqlite3.connect(ledger.path) as db:
        db.execute("UPDATE creation_step_inputs SET payload=?", (json.dumps(payload),))
    with pytest.raises(HTTPException) as error:
        inputs.load_pending("links", tmp_path)
    assert error.value.status_code == 409
    assert path.read_text() == "original"


@pytest.mark.parametrize("location", ["nested", "key", "relative", "symlink"])
def test_replay_checks_all_typed_paths_without_touching_external_files(tmp_path, location):
    ledger, steps, inputs, path = setup(tmp_path)
    external = tmp_path.parent / (uuid.uuid4().hex + ".md")
    external.write_text("private")
    try:
        if location == "nested": args = ({"files": [external]},)
        elif location == "key": args = ({external: "value"},)
        elif location == "relative": args = (Path("QA.md"),)
        else:
            alias = tmp_path / "alias.md"
            alias.symlink_to(external)
            args = (alias,)
        steps.plan(["links"]); inputs.capture("links", args, {})
        with pytest.raises(HTTPException) as error:
            inputs.load_pending("links", tmp_path)
        assert error.value.status_code == 403
        assert external.read_text() == "private" and path.read_text() == "original"
    finally:
        external.unlink()


def test_set_snapshots_are_canonical_and_keyword_names_are_strings(tmp_path):
    assert pack(set(["a", "b", "c"])) == pack(set(["c", "b", "a"]))
    ledger, steps, inputs, path = setup(tmp_path)
    steps.plan(["links"]); inputs.capture("links", (path,), {0: "bad keyword"})
    with pytest.raises(HTTPException) as error:
        inputs.load_pending("links", tmp_path)
    assert error.value.status_code == 409


@pytest.mark.parametrize("relative", [".gnosi/params.yaml", ".gnosi/plugins.json", "BD/vault_db_registry.json"])
@pytest.mark.parametrize("change", ["edit", "delete"])
def test_replay_requires_unchanged_config_plugins_and_schema(tmp_path, relative, change):
    config = tmp_path / relative
    config.parent.mkdir(parents=True, exist_ok=True)
    config.write_text("initial")
    ledger, steps, inputs, path = setup(tmp_path)
    steps.plan(["relations"]); inputs.capture("relations", (path,), {})
    with sqlite3.connect(ledger.path) as db:
        initial = db.execute("SELECT revisions FROM creation_context").fetchone()[0]
    if change == "edit": config.write_text("changed")
    else: config.unlink()
    with pytest.raises(HTTPException) as error:
        inputs.load_pending("relations", tmp_path)
    assert error.value.status_code == 409
    with pytest.raises(HTTPException): inputs.capture_context(tmp_path)
    with sqlite3.connect(ledger.path) as db:
        assert db.execute("SELECT revisions FROM creation_context").fetchone()[0] == initial
    assert path.read_text() == "original"


def test_new_config_and_missing_legacy_context_require_review(tmp_path):
    ledger, steps, inputs, path = setup(tmp_path)
    steps.plan(["relations"]); inputs.capture("relations", (path,), {})
    config = tmp_path / ".gnosi/params.yaml"
    config.parent.mkdir(); config.write_text("new config")
    with pytest.raises(HTTPException) as error: inputs.load_pending("relations", tmp_path)
    assert error.value.status_code == 409
    config.unlink()
    assert inputs.load_pending("relations", tmp_path) == ((path,), {})
    with sqlite3.connect(ledger.path) as db: db.execute("DELETE FROM creation_context")
    with pytest.raises(HTTPException) as error: inputs.load_pending("relations", tmp_path)
    assert error.value.status_code == 409


def test_config_symlink_cannot_read_another_vault(tmp_path):
    ledger, steps, inputs, path = setup(tmp_path)
    steps.plan(["relations"]); inputs.capture("relations", (path,), {})
    external = tmp_path.parent / (uuid.uuid4().hex + ".json")
    external.write_text("private configuration")
    try:
        config = tmp_path / ".gnosi/plugins.json"
        config.parent.mkdir(); config.symlink_to(external)
        with pytest.raises(HTTPException) as error: inputs.load_pending("relations", tmp_path)
        assert error.value.status_code == 403 and external.read_text() == "private configuration"
    finally: external.unlink()
