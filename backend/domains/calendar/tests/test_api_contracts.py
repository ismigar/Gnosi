"""Calendar request-schema and extracted-domain behavior contracts."""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
import json
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.routing import APIRoute
import pytest
from pydantic import BaseModel

from backend.api import calendar_routes
from backend.domains.calendar import api_contracts, mutations, runtime
from backend.services.calendar_event_aggregation import CalendarAccountEvents


def _openapi() -> dict[str, Any]:
    app = FastAPI()
    app.include_router(calendar_routes.router)
    return app.openapi()


def test_every_calendar_json_body_uses_an_explicit_pydantic_model() -> None:
    body_routes = [
        route
        for route in calendar_routes.router.routes
        if isinstance(route, APIRoute) and route.body_field is not None
    ]

    assert {route.path for route in body_routes} == {
        "/api/calendar/events",
        "/api/calendar/events/{event_id}",
        "/api/calendar/events/{event_id}/invite",
        "/api/calendar/events/{event_id}/rsvp",
        "/api/calendar/freebusy",
        "/api/calendar/reminders/settings",
    }
    for route in body_routes:
        assert route.body_field is not None
        annotation = route.body_field.field_info.annotation
        assert isinstance(annotation, type)
        assert issubclass(annotation, BaseModel)


def test_openapi_names_each_calendar_request_contract() -> None:
    paths = _openapi()["paths"]
    expected = {
        ("/api/calendar/events", "post"): "CalendarEventCreateRequest",
        ("/api/calendar/events/{event_id}", "patch"): "CalendarEventPatchRequest",
        ("/api/calendar/freebusy", "post"): "FreeBusyRequest",
        ("/api/calendar/reminders/settings", "put"): ("MeetingReminderSettingsRequest"),
    }
    for (path, method), schema_name in expected.items():
        request_schema = paths[path][method]["requestBody"]["content"]["application/json"]["schema"]
        assert request_schema == {"$ref": f"#/components/schemas/{schema_name}"}


def test_refactor_preserves_calendar_route_status_parameter_and_response_contract() -> None:
    repository = Path(__file__).resolve().parents[4]
    committed = json.loads((repository / "openapi" / "openapi.json").read_text(encoding="utf-8"))
    current = _openapi()
    methods = {"get", "post", "put", "patch", "delete"}

    committed_paths = {
        path: value
        for path, value in committed["paths"].items()
        if path.startswith("/api/calendar")
    }
    current_paths = {
        path: value for path, value in current["paths"].items() if path.startswith("/api/calendar")
    }
    assert set(current_paths) == set(committed_paths)

    for path, old_path in committed_paths.items():
        new_path = current_paths[path]
        for method in methods & old_path.keys():
            old_operation = old_path[method]
            new_operation = new_path[method]
            assert new_operation["operationId"] == old_operation["operationId"]
            assert new_operation.get("parameters", []) == old_operation.get("parameters", [])
            assert set(new_operation["responses"]) == set(old_operation["responses"])
            assert new_operation["responses"].get("200") == old_operation["responses"].get("200")


def test_event_requests_preserve_provider_extensions_and_omissions() -> None:
    created = api_contracts.CalendarEventCreateRequest.model_validate(
        {
            "summary": "Review",
            "start": {"dateTime": "2026-09-03T10:00:00Z"},
            "workingLocationProperties": {"type": "homeOffice"},
        }
    )
    patched = api_contracts.CalendarEventPatchRequest.model_validate(
        {"title": "Renamed", "provider_extension": {"enabled": True}}
    )

    assert created.model_dump(exclude_unset=True, by_alias=True) == {
        "summary": "Review",
        "start": {"dateTime": "2026-09-03T10:00:00Z"},
        "workingLocationProperties": {"type": "homeOffice"},
    }
    assert patched.model_dump(exclude_unset=True, by_alias=True) == {
        "title": "Renamed",
        "provider_extension": {"enabled": True},
    }


def test_post_event_passes_the_original_json_shape_to_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    def create(email: str, body: dict[str, object], calendar_id: str) -> dict[str, str]:
        captured.update(email=email, body=body, calendar_id=calendar_id)
        return {"id": "event-1", "summary": "Review"}

    monkeypatch.setattr(calendar_routes, "create_google_calendar_event", create)
    result = asyncio.run(
        calendar_routes.post_event(
            email="owner@example.test",
            calendar_id="primary",
            event_data=api_contracts.CalendarEventCreateRequest.model_validate(
                {"summary": "Review", "custom": {"flag": True}}
            ),
        )
    )

    assert result == {"id": "event-1", "summary": "Review"}
    assert captured == {
        "email": "owner@example.test",
        "body": {"summary": "Review", "custom": {"flag": True}},
        "calendar_id": "primary",
    }


def test_freebusy_contract_keeps_legacy_body_and_provider_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: list[object] = []

    def freebusy(*args: object) -> dict[str, object]:
        captured.extend(args)
        return {"calendars": {}}

    monkeypatch.setattr(
        calendar_routes,
        "get_google_calendar_free_busy",
        freebusy,
    )
    payload = api_contracts.FreeBusyRequest(
        time_min="2026-09-03T09:00:00Z",
        time_max="2026-09-03T10:00:00Z",
        calendar_ids=["primary"],
    )

    result = asyncio.run(calendar_routes._post_freebusy_endpoint("owner@example.test", payload))

    assert result == {"calendars": {}}
    assert captured == [
        "owner@example.test",
        "2026-09-03T09:00:00Z",
        "2026-09-03T10:00:00Z",
        ["primary"],
    ]


def test_extracted_vault_patch_preserves_body_and_unknown_metadata(tmp_path: Path) -> None:
    event_path = tmp_path / "event.md"
    event_path.write_text("---\ncustom: keep\ntitle: Before\n---\n\nBody\n", encoding="utf-8")

    def write(path: Path, content: str) -> None:
        path.write_text(content, encoding="utf-8")

    mutations.patch_vault_event(
        event_path,
        {"title": "After", "ignored": "value"},
        write,
    )

    metadata, body = mutations.parse_frontmatter(event_path.read_text(encoding="utf-8"))
    assert metadata == {"custom": "keep", "title": "After"}
    assert body.strip() == "Body"


def test_extracted_ics_skips_only_malformed_events() -> None:
    payload = runtime.build_ics(
        [
            {
                "id": "event-1",
                "title": "Review",
                "start": "2026-09-03T10:00:00Z",
                "end": "2026-09-03T11:00:00Z",
                "description": "Agenda",
            },
            {"id": 2, "title": "Malformed", "start": "invalid"},
        ]
    )

    text = payload.decode("utf-8")
    assert "SUMMARY:Review" in text
    assert "UID:event-1@gnosi.local" in text
    assert "Malformed" not in text


def test_extracted_attendee_search_keeps_other_accounts_after_one_fails() -> None:
    errors: list[str] = []

    def contacts(email: str) -> list[object]:
        if email.startswith("broken"):
            raise RuntimeError("unavailable")
        return [{"email": "guest@example.test", "name": "Guest"}]

    results = runtime.find_attendees(
        [{"email": "broken@example.test"}, {"email": "ok@example.test"}],
        "guest",
        contacts,
        lambda contact: dict(contact) if isinstance(contact, dict) else {},
        lambda error: errors.append(str(error)),
    )

    assert results == [{"email": "guest@example.test", "name": "Guest"}]
    assert errors == ["unavailable"]


def test_extracted_vault_invitation_preserves_sent_and_failed_payloads() -> None:
    sent: list[tuple[str, str, str, str]] = []

    def send(sender: str, recipient: str, subject: str, body: str) -> bool:
        sent.append((sender, recipient, subject, body))
        return not recipient.startswith("fail")

    result = mutations.invite_vault_event(
        "owner@example.test",
        [{"email": "ok@example.test"}, {"email": "fail@example.test"}],
        {"title": "Review", "date": "2026-09-03"},
        send,
    )

    assert result == {"ok": False, "failed": ["fail@example.test"], "sent": 1}
    assert [message[1] for message in sent] == [
        "ok@example.test",
        "fail@example.test",
    ]
    assert all(message[2] == "Invitació: Review" for message in sent)


def test_extracted_cache_reuses_a_valid_empty_provider_result() -> None:
    runtime.EVENTS_CACHE.clear()
    calls = 0

    def fetch(
        accounts: Sequence[tuple[str, str]],
        _time_min: str,
        _time_max: str,
        _search: str | None,
        _calendar_id: str | None,
    ) -> list[CalendarAccountEvents]:
        nonlocal calls
        calls += len(accounts)
        return [CalendarAccountEvents(email, cache_key, [], True) for email, cache_key in accounts]

    def load() -> list[dict[str, object]]:
        return runtime.collect_events(
            ["empty@example.test"],
            "2026-09-01",
            "2026-10-01",
            None,
            None,
            False,
            fetch,
            set,
            lambda *_args: [],
        )

    assert load() == []
    assert load() == []
    assert calls == 1
