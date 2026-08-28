"""Typed OpenAPI and legacy-variant contract for the Calendar domain."""

from __future__ import annotations

import asyncio

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.routing import APIRoute

from backend.api import calendar_routes
from backend.domains.calendar import schemas


def _focused_openapi() -> dict[str, object]:
    app = FastAPI()
    app.include_router(calendar_routes.router)
    return app.openapi()


def test_calendar_json_routes_all_have_concrete_response_models() -> None:
    api_routes = [
        route for route in calendar_routes.router.routes if isinstance(route, APIRoute)
    ]
    json_routes = [
        route for route in api_routes if route.path != "/api/calendar/feed.ics"
    ]

    assert json_routes
    assert all(route.response_model is not None for route in json_routes)

    feed_route = next(
        route for route in api_routes if route.path == "/api/calendar/feed.ics"
    )
    assert feed_route.response_model is None


def test_calendar_openapi_exposes_typed_responses_and_bodies() -> None:
    paths = _focused_openapi()["paths"]

    assert paths["/api/calendar/calendars"]["get"]["responses"]["200"][
        "content"
    ]["application/json"]["schema"]["items"] == {
        "$ref": "#/components/schemas/CalendarListItemResponse"
    }
    assert paths["/api/calendar/events"]["get"]["responses"]["200"][
        "content"
    ]["application/json"]["schema"]["items"] == {
        "$ref": "#/components/schemas/CalendarEventResponse"
    }
    assert paths["/api/calendar/events"]["post"]["responses"]["200"][
        "content"
    ]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/GoogleEventResourceResponse"
    }
    assert paths["/api/calendar/freebusy"]["post"]["responses"]["200"][
        "content"
    ]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/FreeBusyResponse"
    }
    assert paths["/api/calendar/events/{event_id}/invite"]["post"]["responses"][
        "200"
    ]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/CalendarInviteResponse"
    }

    assert paths["/api/calendar/events/{event_id}/rsvp"]["post"]["requestBody"][
        "content"
    ]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/CalendarRsvpRequest"
    }
    assert paths["/api/calendar/events/{event_id}/invite"]["post"]["requestBody"][
        "content"
    ]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/CalendarInviteRequest"
    }
    assert paths["/api/calendar/events/{event_id}/rsvp"]["post"]["operationId"] == (
        "rsvp_event_api_calendar_events__event_id__rsvp_post"
    )
    assert paths["/api/calendar/events/{event_id}/invite"]["post"]["operationId"] == (
        "invite_to_event_api_calendar_events__event_id__invite_post"
    )

    feed_response = paths["/api/calendar/feed.ics"]["get"]["responses"]["200"]
    assert "application/json" not in feed_response.get("content", {})


def test_calendar_short_and_provider_variants_serialize_without_added_defaults() -> None:
    google_calendar = schemas.CalendarListItemResponse.model_validate(
        {
            "id": "primary",
            "name": "Personal",
            "color": None,
            "account": "user@example.test",
            "provider": "google",
            "access_role": "owner",
            "primary": True,
        }
    )
    caldav_calendar = schemas.CalendarListItemResponse.model_validate(
        {
            "id": "/calendar/work/",
            "name": "Work",
            "color": None,
            "account": "user@example.test",
            "provider": "caldav",
            "url": "https://cloud.example.test/calendar/work/",
        }
    )
    google_event = schemas.GoogleEventResourceResponse.model_validate(
        {
            "id": "google-1",
            "htmlLink": "https://calendar.google.test/event/google-1",
            "focusTimeProperties": {"autoDeclineMode": "declineNone"},
        }
    )
    freebusy = schemas.FreeBusyResponse.model_validate({})
    invite = schemas.CalendarInviteResponse.model_validate({"ok": True})
    reminders = schemas.MeetingRemindersResponse.model_validate(
        {"reminders": [{"id": "legacy-reminder"}]}
    )

    assert google_calendar.model_dump(exclude_unset=True) == {
        "id": "primary",
        "name": "Personal",
        "color": None,
        "account": "user@example.test",
        "provider": "google",
        "access_role": "owner",
        "primary": True,
    }
    assert caldav_calendar.model_dump(exclude_unset=True) == {
        "id": "/calendar/work/",
        "name": "Work",
        "color": None,
        "account": "user@example.test",
        "provider": "caldav",
        "url": "https://cloud.example.test/calendar/work/",
    }
    assert google_event.model_dump(by_alias=True, exclude_unset=True) == {
        "id": "google-1",
        "htmlLink": "https://calendar.google.test/event/google-1",
        "focusTimeProperties": {"autoDeclineMode": "declineNone"},
    }
    assert freebusy.model_dump(by_alias=True, exclude_unset=True) == {}
    assert invite.model_dump(exclude_unset=True) == {"ok": True}
    assert reminders.model_dump(exclude_unset=True) == {
        "reminders": [{"id": "legacy-reminder"}]
    }

    variant_routes = {
        ("GET", "/api/calendar/calendars"),
        ("GET", "/api/calendar/events"),
        ("POST", "/api/calendar/events"),
        ("GET", "/api/calendar/events/{event_id}"),
        ("GET", "/api/calendar/reminders"),
        ("POST", "/api/calendar/freebusy"),
        ("POST", "/api/calendar/events/{event_id}/invite"),
    }
    for route in calendar_routes.router.routes:
        if not isinstance(route, APIRoute):
            continue
        for method in route.methods:
            if (method, route.path) in variant_routes:
                assert route.response_model_exclude_unset is True


def test_calendar_typed_rsvp_keeps_legacy_validation_and_payload(monkeypatch) -> None:
    missing = schemas.CalendarRsvpRequest()
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(calendar_routes._rsvp_event_endpoint("event-1", missing))
    assert exc_info.value.status_code == 400

    monkeypatch.setattr(
        calendar_routes,
        "respond_to_invitation",
        lambda email, event_id, rsvp, calendar_id: (
            email == "user@example.test"
            and event_id == "event-1"
            and rsvp == "accepted"
            and calendar_id == "primary"
        ),
    )
    result = asyncio.run(
        calendar_routes._rsvp_event_endpoint(
            "event-1",
            schemas.CalendarRsvpRequest(
                email="user@example.test",
                rsvp="accepted",
            ),
        )
    )

    assert result == {"ok": True, "rsvp": "accepted"}


def test_calendar_typed_invite_keeps_google_short_payload_and_attendee_extras(
    monkeypatch,
) -> None:
    captured: dict[str, object] = {}

    def patch_attendees(email, event_id, attendees, calendar_id):
        captured.update(
            email=email,
            event_id=event_id,
            attendees=attendees,
            calendar_id=calendar_id,
        )
        return True

    monkeypatch.setattr(calendar_routes, "patch_event_attendees", patch_attendees)
    result = asyncio.run(
        calendar_routes._invite_to_event_endpoint(
            "event-2",
            schemas.CalendarInviteRequest.model_validate(
                {
                    "email": "user@example.test",
                    "attendees": [
                        {
                            "email": "guest@example.test",
                            "name": "Guest",
                            "optional": True,
                        }
                    ],
                }
            ),
        )
    )

    assert result == {"ok": True}
    assert captured == {
        "email": "user@example.test",
        "event_id": "event-2",
        "attendees": [
            {
                "email": "guest@example.test",
                "name": "Guest",
                "optional": True,
            }
        ],
        "calendar_id": "primary",
    }
