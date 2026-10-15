"""Public questions cannot escape their table, owner or durable submission scope."""

import asyncio
from datetime import datetime, timedelta, timezone
import hashlib
import json
from types import SimpleNamespace

from fastapi import BackgroundTasks, HTTPException, Response
from pydantic import ValidationError
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from backend.api import form_routes as routes
from backend.domains.forms import service
from backend.domains.forms.fields import build_fields, current_fields, field_candidates, submission_page
from backend.domains.forms.schemas import FormCreateRequest, FormFieldChoice, FormSubmitRequest
from backend.domains.vault.pages.creation_requests import create_page_with_receipt
from backend.domains.vault.schemas.pages import PageSaveRequest
from backend.models.forms import FormDefinition, FormSubmission
from backend.models.management import Membership, User, Vault, VaultAccess, Workspace
from backend.services import public_workflow_scope
from backend.services.context_vars import active_vault_path
from backend.services.workspace_service import WorkspaceContext
from backend.tests.test_page_creation_responsiveness import dependencies


def registry():
    return {"tables": [{"id": "table", "properties": [
        {"id": "name", "name": "Name", "type": "text"},
        {"id": "count", "name": "Count", "type": "number"},
        {"id": "accepted", "name": "Accepted", "type": "checkbox"},
        {"id": "day", "name": "Day", "type": "date"},
        {"id": "email", "name": "Email", "type": "email"},
        {"id": "stage", "name": "Stage", "type": "select", "config": {"options": ["Open", "Closed"]}},
        {"id": "tags", "name": "Tags", "type": "multi_select", "config": {"options": ["A", "B"]}},
        {"id": "url", "name": "Link", "type": "url"},
        {"id": "formula", "name": "Total", "type": "formula"},
        {"id": "fake-owner", "name": "created_by", "type": "text"},
        {"id": "fake-table", "name": "Table_ID", "type": "text"},
        {"id": "fake-path", "name": "path", "type": "text"},
    ]}]}


def choices(*refs):
    return [FormFieldChoice(ref=ref, label=ref, required=ref in {"title", "name"}) for ref in refs]


@pytest.fixture
def runtime(tmp_path, monkeypatch):
    engine = create_engine("sqlite://")
    tables = [User, Workspace, Membership, Vault, VaultAccess, FormDefinition, FormSubmission]
    for model in tables:
        model.__table__.create(engine, checkfirst=True)
    db = Session(engine)
    vault = tmp_path / "vault"; vault.mkdir()
    other = tmp_path / "other"; other.mkdir()
    db.add_all([User(id="owner", email="owner@example.test"), User(id="other", email="other@example.test"), Workspace(id="workspace", name="Test"),
        Membership(user_id="owner", workspace_id="workspace", role="owner"), Membership(user_id="other", workspace_id="workspace", role="editor"),
        Vault(id="vault", workspace_id="workspace", name="Vault", path_override=str(vault)),
        Vault(id="other-vault", workspace_id="workspace", name="Other", path_override=str(other))])
    db.commit()
    monkeypatch.setattr(public_workflow_scope, "load_params", lambda **_: SimpleNamespace(paths={"PROJECT_DIR": tmp_path}))
    monkeypatch.setattr(public_workflow_scope, "plugins_enabled_now", lambda *_, **__: True)
    data = registry()
    monkeypatch.setattr(service, "load_registry_for_write", lambda: data)
    monkeypatch.setattr(routes, "load_registry_for_write", lambda: data)
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path / "data"))
    context = WorkspaceContext("workspace", "owner", "owner", vault, ["read", "write"])
    result = service.create_form(db, context, FormCreateRequest(table_id="table", title="Survey", fields=choices("title", "name", "count", "accepted")))
    form = db.query(FormDefinition).filter_by(id=result.id).one()
    yield SimpleNamespace(db=db, vault=vault, other=other, context=context, form=form, data=data)
    db.close(); engine.dispose()


def submit(runtime, values=None, request_id="request_identity_0001"):
    request = FormSubmitRequest(request_id=request_id, values=values or {"field_0": "Submission", "field_1": "Person", "field_2": 0, "field_3": False})
    asyncio.run(service.submit_form(runtime.db, runtime.form.token, request, BackgroundTasks()))
    return request


def test_public_definition_hides_destination_and_records(runtime):
    response = Response()
    result = routes.read_public_form(runtime.form.token, response, runtime.db).model_dump()
    assert set(result) == {"title", "description", "fields"}
    assert all(set(field) == {"key", "label", "help", "kind", "required", "options"} for field in result["fields"])
    assert response.headers["cache-control"] == "no-store"
    assert active_vault_path.get() is None


def test_candidates_exclude_computed_and_protected_fields():
    data = registry(); table = data["tables"][0]
    refs = {field.ref for field in field_candidates(table, data)}
    assert not refs.intersection({"fake-owner", "fake-table", "fake-path", "formula"})
    with pytest.raises(HTTPException):
        build_fields(choices("title", "fake-owner"), table, data)


@pytest.mark.parametrize("kind,value", [("count", True), ("count", "42"), ("count", float("inf")), ("accepted", "false"), ("day", "2026-02-30"), ("email", "bad"), ("stage", "New"), ("tags", ["A", "bad"]), ("url", "javascript:alert(1)"), ("name", {"id": "injection"})])
def test_typed_validation_rejects_invalid_answers(kind, value):
    data = registry(); table = data["tables"][0]
    fields = build_fields(choices("title", kind), table, data)
    with pytest.raises(HTTPException) as error:
        submission_page(fields, current_fields(fields, table, data), {"field_0": "Title", "field_1": value}, "table")
    assert error.value.status_code == 422


def test_required_unknown_keys_and_duplicate_configuration_rejected():
    data = registry(); table = data["tables"][0]
    fields = build_fields(choices("title", "name"), table, data)
    for values in [{"field_0": "T"}, {"field_0": "T", "field_1": "   "}, {"field_0": "T", "field_1": "N", "table_id": "other"}]:
        with pytest.raises(HTTPException):
            submission_page(fields, current_fields(fields, table, data), values, "table")
    for refs in [("name",), ("title", "title")]:
        with pytest.raises(HTTPException):
            build_fields(choices(*refs), table, data)


def test_field_rename_follows_stable_id_but_type_drift_stops(runtime):
    fields = service.stored_fields(runtime.form)
    table = runtime.data["tables"][0]
    table["properties"][0]["name"] = "Renamed"
    assert current_fields(fields, table, runtime.data)["field_1"] == "Renamed"
    table["properties"][0]["type"] = "number"
    with pytest.raises(HTTPException) as error:
        routes.read_public_form(runtime.form.token, Response(), runtime.db)
    assert error.value.status_code == 409


@pytest.mark.parametrize("state", ["revoked", "expired", "missing-expiry", "owner-lost-access", "missing-vault", "missing-table"])
def test_links_fail_closed_after_access_changes(runtime, state):
    if state == "revoked": runtime.form.revoked = True
    elif state == "expired": runtime.form.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    elif state == "missing-expiry": runtime.form.expires_at = None
    elif state == "owner-lost-access": runtime.db.query(Membership).filter_by(user_id="owner").update({"role": "viewer"})
    elif state == "missing-vault": runtime.db.query(Vault).filter_by(id="vault").delete()
    else: runtime.data["tables"] = []
    runtime.db.commit()
    with pytest.raises(HTTPException) as error:
        routes.read_public_form(runtime.form.token, Response(), runtime.db)
    assert error.value.status_code == 404
    with pytest.raises(HTTPException) as submission_error:
        submit(runtime)
    assert submission_error.value.status_code == 404
    assert runtime.db.query(FormSubmission).count() == 0


@pytest.mark.parametrize("days", [None, 0, 366])
def test_publication_requires_a_bounded_finite_lifetime(days):
    with pytest.raises(ValidationError):
        FormCreateRequest.model_validate({
            "table_id": "table", "title": "Survey", "fields": [{"ref": "title", "label": "Title"}],
            "expires_in_days": days,
        })


@pytest.mark.parametrize("days", [1, 30, 365])
def test_published_deadline_is_persisted_and_enforced_at_the_boundary(runtime, monkeypatch, days):
    now = datetime(2026, 10, 13, 12, tzinfo=timezone.utc)

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return now.astimezone(tz) if tz is not None else now.replace(tzinfo=None)

    monkeypatch.setattr(service, "datetime", Clock)
    request = FormCreateRequest(table_id="table", title="Finite form", fields=choices("title"), expires_in_days=days)
    created = service.create_form(runtime.db, runtime.context, request)
    stored = runtime.db.query(FormDefinition).filter_by(id=created.id).one()
    deadline = now + timedelta(days=days)
    assert created.expires_at == deadline
    assert stored.expires_at.replace(tzinfo=timezone.utc) == deadline
    now = deadline - timedelta(microseconds=1)
    assert routes.read_public_form(stored.token, Response(), runtime.db).title == "Finite form"
    now = deadline
    with pytest.raises(HTTPException) as lookup_error:
        routes.read_public_form(stored.token, Response(), runtime.db)
    assert lookup_error.value.status_code == 404
    request = FormSubmitRequest(request_id="expired_submission_01", values={"field_0": "Too late"})
    with pytest.raises(HTTPException) as submission_error:
        asyncio.run(routes.submit_public_form(stored.token, request, BackgroundTasks(), Response(), runtime.db))
    assert submission_error.value.status_code == 404
    assert runtime.db.query(FormSubmission).filter_by(form_id=stored.id).count() == 0


def test_owner_management_is_scoped_to_user_and_vault(runtime):
    context = WorkspaceContext("workspace", "other", "editor", runtime.vault, ["read", "write"])
    assert routes.list_forms(None, context, runtime.db).forms == []
    with pytest.raises(HTTPException) as error: routes.revoke_form(runtime.form.id, context, runtime.db)
    assert error.value.status_code == 404
    context = WorkspaceContext("workspace", "owner", "owner", runtime.other, ["read", "write"])
    assert routes.list_forms(None, context, runtime.db).forms == []


def test_normal_submission_uses_pinned_vault_and_canonical_durable_receipt(runtime, monkeypatch):
    writes = []; effects = []
    def save(path, metadata, _body):
        assert active_vault_path.get() == runtime.vault
        writes.append(dict(metadata)); path.write_text(json.dumps(metadata))
    def update_links(_):
        assert active_vault_path.get() == runtime.vault
        effects.append("index")
    ports = dependencies(runtime.vault, save_page=save, update_link_index=update_links)
    async def create(form, entry, tasks, context):
        await create_page_with_receipt(PageSaveRequest.model_validate_json(entry.payload_json), tasks, context.user_id, context.workspace_id,
            context.vault_path, "form_" + hashlib.sha256(f"{form.id}:{entry.request_id}".encode()).hexdigest(), ports)
    monkeypatch.setattr(service, "_create_submission_page", create)
    outer = active_vault_path.set(runtime.other)
    try:
        request = submit(runtime)
        assert active_vault_path.get() == runtime.other
        # Simulate a lost management commit: the canonical receipt still deduplicates.
        runtime.db.query(FormSubmission).update({"completed": False}); runtime.db.commit()
        submit(runtime, request.values)
    finally: active_vault_path.reset(outer)
    assert len(writes) == 1 and effects == ["index"]
    assert writes[0]["table_id"] == "table" and writes[0]["author"] == "owner"
    assert writes[0]["Count"] == 0 and writes[0]["Accepted"] is False
    assert runtime.db.query(FormSubmission).one().completed
    assert list(runtime.other.iterdir()) == []
    with pytest.raises(HTTPException) as error: submit(runtime, {**request.values, "field_1": "Different"})
    assert error.value.status_code == 409


def test_honeypot_and_size_limit_do_not_write(runtime, monkeypatch):
    async def forbidden(*_): raise AssertionError("No write expected")
    monkeypatch.setattr(service, "_create_submission_page", forbidden)
    request = FormSubmitRequest(request_id="request_identity_0001", values={}, website="bot")
    asyncio.run(service.submit_form(runtime.db, runtime.form.token, request, BackgroundTasks()))
    assert runtime.db.query(FormSubmission).count() == 0
    with pytest.raises(HTTPException) as error: submit(runtime, {"field_0": "x" * 70000})
    assert error.value.status_code == 413
