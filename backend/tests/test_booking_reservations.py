"""Disposable SQLite tests for idempotency, concurrent claims and authorization."""

from concurrent.futures import ThreadPoolExecutor
import asyncio
from datetime import datetime, timedelta, timezone
import json
from types import SimpleNamespace

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.data.management_db import Base, get_mgmt_db
from backend.domains.booking import links, reservations, sources
from backend.domains.booking.schemas import BookingLinkCreate, BookingReservationRequest
from backend.models.booking import BookingReservation
from backend.models.management import Membership, User, Vault, Workspace
from backend.services import public_workflow_scope
from backend.services.workspace_service import WorkspaceContext

UTC = timezone.utc


@pytest.fixture
def booking_runtime(tmp_path, monkeypatch):
    vault = tmp_path / "vault"
    other = tmp_path / "other"
    vault.mkdir()
    other.mkdir()
    engine = create_engine(f"sqlite:///{tmp_path / 'management.sqlite'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    with sessions() as db:
        db.add_all([User(id="owner", email="owner@example.test"), User(id="other", email="other@example.test"), Workspace(id="personal", name="Personal", slug="personal")])
        db.commit()
        db.add_all([Membership(user_id="owner", workspace_id="personal", role="owner"), Membership(user_id="other", workspace_id="personal", role="editor"), Vault(id="vault", workspace_id="personal", name="Vault", slug="vault", path_override=str(vault)), Vault(id="other-vault", workspace_id="personal", name="Other", slug="other", path_override=str(other))])
        db.commit()
    monkeypatch.setattr(public_workflow_scope, "load_params", lambda **kwargs: SimpleNamespace(paths={"PROJECT_DIR": tmp_path}))
    monkeypatch.setattr(public_workflow_scope, "plugins_enabled_now", lambda *args, **kwargs: True)
    monkeypatch.setattr(sources, "_provider_busy", lambda *args: [])
    monkeypatch.setattr(sources, "load_params", lambda **kwargs: SimpleNamespace(gnosi_mode="personal"))
    context = WorkspaceContext("personal", "owner", "owner", vault)
    config = BookingLinkCreate.model_validate({
        "title": "Consultation", "schedule": {"calendars": [{"provider": "vault", "calendar_id": "gnosi"}], "timezone": "UTC", "weekdays": list(range(7)), "notice_minutes": 0},
        "destination": {"provider": "vault", "calendar_id": "gnosi"},
    })
    with sessions() as db:
        link = links.create_link(db, context, config)
    day = (datetime.now(UTC) + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
    request = BookingReservationRequest(start=day, name="Guest", email="guest@example.test", idempotency_key="request-booking-123")
    yield SimpleNamespace(sessions=sessions, context=context, config=config, link=link, request=request, other=other)
    engine.dispose()


def test_idempotency_replay_survives_new_session_and_rejects_changed_payload(booking_runtime, monkeypatch):
    runtime = booking_runtime
    calls = []
    monkeypatch.setattr(reservations, "_write_event", lambda row, *args: calls.append(row.id) or "event-1")
    with runtime.sessions() as db:
        first = reservations.make_reservation(db, runtime.link.token, runtime.request, runtime.context)
    with runtime.sessions() as db:
        replay = reservations.make_reservation(db, runtime.link.token, runtime.request, runtime.context)
        assert replay == first and replay.status == "confirmed"
        with pytest.raises(HTTPException) as error:
            reservations.make_reservation(db, runtime.link.token, runtime.request.model_copy(update={"name": "Someone else"}), runtime.context)
        assert error.value.status_code == 409
    assert len(calls) == 1


def test_unknown_remote_result_stays_pending_and_blocks_other_links(booking_runtime, monkeypatch):
    runtime = booking_runtime
    calls = []

    def uncertain(*args):
        calls.append(True)
        raise TimeoutError("response lost after provider accepted")

    monkeypatch.setattr(reservations, "_write_event", uncertain)
    with runtime.sessions() as db:
        first = reservations.make_reservation(db, runtime.link.token, runtime.request, runtime.context)
        assert first.status == "pending"
        second_link = links.create_link(db, runtime.context, runtime.config)
    with runtime.sessions() as db:
        assert reservations.make_reservation(db, runtime.link.token, runtime.request, runtime.context) == first
        with pytest.raises(HTTPException) as error:
            reservations.make_reservation(db, second_link.token, runtime.request.model_copy(update={"idempotency_key": "another-request-123"}), runtime.context)
        assert error.value.status_code == 409
    assert len(calls) == 1


def test_simultaneous_reservations_across_links_only_write_once(booking_runtime, monkeypatch):
    runtime = booking_runtime
    with runtime.sessions() as db:
        second = links.create_link(db, runtime.context, runtime.config)
    calls = []
    monkeypatch.setattr(reservations, "_write_event", lambda row, *args: calls.append(row.id) or "remote-event")

    def book(token):
        with runtime.sessions() as db:
            try:
                return reservations.make_reservation(db, token, runtime.request, runtime.context).status
            except HTTPException as error:
                return error.status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        result = list(executor.map(book, [runtime.link.token, second.token]))
    assert set(result) == {"confirmed", 409}
    assert len(calls) == 1
    with runtime.sessions() as db:
        assert db.query(BookingReservation).count() == 1


def test_revoke_requires_same_owner_and_selected_vault(booking_runtime):
    runtime = booking_runtime
    with runtime.sessions() as db:
        for context in [WorkspaceContext("personal", "other", "editor", runtime.context.vault_path), WorkspaceContext("personal", "owner", "owner", runtime.other)]:
            with pytest.raises(HTTPException) as error:
                links.revoke_link(db, context, runtime.link.id)
            assert error.value.status_code == 404
        links.revoke_link(db, runtime.context, runtime.link.id)
        with pytest.raises(HTTPException) as error:
            links.load_public_link(db, runtime.link.token)
        assert error.value.status_code == 404


def test_public_response_is_slots_only_and_owner_access_is_rechecked(booking_runtime):
    from backend.api.booking_routes import router

    runtime = booking_runtime
    app = FastAPI()
    app.include_router(router)

    def database():
        with runtime.sessions() as db:
            yield db

    app.dependency_overrides[get_mgmt_db] = database
    with TestClient(app) as client:
        base = f"/api/booking/public/{runtime.link.token}"
        response = client.get(base + "/slots", params={"date": runtime.request.start.date().isoformat()}, headers={"X-Vault-ID": "other-vault"})
        assert response.status_code == 200
        assert response.headers["Cache-Control"] == "no-store"
        assert set(response.json()) == {"timezone", "date", "slots"}
        assert set(response.json()["slots"][0]) == {"start", "end"}
        with runtime.sessions() as db:
            db.query(Membership).filter(Membership.user_id == "owner").update({"role": "viewer"})
            db.commit()
        assert client.get(base).status_code == 404


def test_local_reservation_uses_pinned_vault_and_real_creation_receipt(booking_runtime, monkeypatch, tmp_path):
    from backend.api import vault_routes
    from backend.domains.vault.pages.creation_requests import create_page_with_receipt
    from backend.services.context_vars import active_vault_path
    from backend.tests.test_page_creation_responsiveness import dependencies

    runtime = booking_runtime
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path / "data"))
    writes = []
    effects = []

    def save(path, metadata, body):
        assert active_vault_path.get() == runtime.context.vault_path
        writes.append(metadata)
        path.write_text(json.dumps(metadata))

    def side_effect(*args):
        assert active_vault_path.get() == runtime.context.vault_path
        effects.append("links")

    ports = dependencies(runtime.context.vault_path, save_page=save, update_link_index=side_effect)

    async def create(request, tasks, *, context, idempotency_key):
        return await create_page_with_receipt(request, tasks, context.user_id, context.workspace_id, context.vault_path, idempotency_key, ports)

    monkeypatch.setattr(vault_routes, "create_page", create)
    with runtime.sessions() as db:
        with public_workflow_scope.public_vault_scope(db, "personal", "vault", "owner", plugin_ids=("calendar",)) as context:
            first = reservations.make_reservation(db, runtime.link.token, runtime.request, context)
            row = db.query(BookingReservation).filter_by(id=first.id).one()
            # Even a direct replay at the page seam cannot create another file.
            assert asyncio.run(reservations._create_local(row, runtime.config, context)) == row.event_id
    assert first.status == "confirmed"
    assert len(writes) == 1 and len(effects) == 1
    assert writes[0]["source"] == "Gnosi" and writes[0]["booking_reservation_id"] == first.id
    assert writes[0]["attendees"] == [{"email": "guest@example.test", "displayName": "Guest"}]
    assert active_vault_path.get() is None


@pytest.fixture
def shared_booking_runtime(booking_runtime):
    runtime = booking_runtime
    with runtime.sessions() as db:
        db.add(Workspace(id="shared", name="Shared", slug="shared"))
        db.commit()
        db.add_all([
            Membership(user_id=owner, workspace_id="shared", role="editor")
            for owner in ("owner", "other")
        ])
        db.add_all([
            Vault(id="shared-vault", workspace_id="shared", name="Shared", slug="shared", path_override=str(runtime.context.vault_path)),
            Vault(id="separate-vault", workspace_id="shared", name="Separate", slug="separate", path_override=str(runtime.other)),
        ])
        db.commit()
    return runtime


def _shared_link(runtime, owner, vault_id="shared-vault"):
    with runtime.sessions() as db:
        with public_workflow_scope.public_vault_scope(db, "shared", vault_id, owner, plugin_ids=("calendar",)) as context:
            return links.create_link(db, context, runtime.config)


def _shared_claim(runtime, link, owner, vault_id="shared-vault"):
    with runtime.sessions() as db:
        with public_workflow_scope.public_vault_scope(db, "shared", vault_id, owner, plugin_ids=("calendar",)) as context:
            row, _, fresh = reservations.claim_reservation(db, link.token, runtime.request, context)
            return row.id, fresh


@pytest.mark.parametrize("status", ["pending", "confirmed"])
def test_shared_calendar_claims_block_other_authorized_editors(shared_booking_runtime, status):
    runtime = shared_booking_runtime
    first = _shared_link(runtime, "owner")
    second = _shared_link(runtime, "other")
    reservation_id, _ = _shared_claim(runtime, first, "owner")
    with runtime.sessions() as db:
        db.query(BookingReservation).filter_by(id=reservation_id).update({"status": status})
        db.commit()
    # Calendar projection remains empty: the file write is pending or the
    # snapshot has not observed it yet. The durable resource claim must suffice.
    with pytest.raises(HTTPException) as error:
        _shared_claim(runtime, second, "other")
    assert error.value.status_code == 409
    with runtime.sessions() as db:
        assert db.query(BookingReservation).count() == 1


def test_concurrent_editors_cannot_claim_same_shared_calendar(shared_booking_runtime):
    runtime = shared_booking_runtime
    first = _shared_link(runtime, "owner")
    second = _shared_link(runtime, "other")

    def claim(item):
        owner, link = item
        try:
            return _shared_claim(runtime, link, owner)[1]
        except HTTPException as error:
            return error.status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(claim, [("owner", first), ("other", second)]))
    assert sorted(results) == [True, 409]
    with runtime.sessions() as db:
        rows = db.query(BookingReservation).all()
        assert len(rows) == 1 and rows[0].status == "pending"


def test_unrelated_vaults_remain_independent_across_editors(shared_booking_runtime):
    runtime = shared_booking_runtime
    first = _shared_link(runtime, "owner")
    second = _shared_link(runtime, "other", "separate-vault")
    assert _shared_claim(runtime, first, "owner")[1]
    assert _shared_claim(runtime, second, "other", "separate-vault")[1]
    with runtime.sessions() as db:
        assert db.query(BookingReservation).count() == 2


def test_same_owner_conflicts_even_when_vault_resources_differ(shared_booking_runtime):
    runtime = shared_booking_runtime
    first = _shared_link(runtime, "owner")
    second = _shared_link(runtime, "owner", "separate-vault")
    assert _shared_claim(runtime, first, "owner")[1]
    with pytest.raises(HTTPException) as error:
        _shared_claim(runtime, second, "owner", "separate-vault")
    assert error.value.status_code == 409
