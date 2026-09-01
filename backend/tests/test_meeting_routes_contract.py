"""Contract checks for the typed meeting recorder endpoints."""

from __future__ import annotations

import asyncio

from fastapi.routing import APIRoute


def test_meeting_routes_publish_typed_response_contracts() -> None:
    from backend.api import meeting_routes

    routes = {
        route.endpoint.__name__: route
        for route in meeting_routes.router.routes
        if isinstance(route, APIRoute)
    }

    assert routes["record_meeting"].response_model is meeting_routes.MeetingStartResponse
    assert routes["meeting_status"].response_model is meeting_routes.MeetingStatusResponse


def test_meeting_status_preserves_known_and_extension_fields(monkeypatch) -> None:
    from backend.api import meeting_routes

    monkeypatch.setattr(
        meeting_routes.meeting_notes,
        "get_status",
        lambda: {
            "running": True,
            "stage": "transcribing",
            "progress": 37,
            "error": None,
            "page_id": None,
            "title": "Weekly sync",
            "queued_seconds": 4,
        },
    )

    result = asyncio.run(meeting_routes.meeting_status())

    assert result.model_dump() == {
        "running": True,
        "stage": "transcribing",
        "progress": 37,
        "error": None,
        "page_id": None,
        "title": "Weekly sync",
        "queued_seconds": 4,
    }
