"""Compatibility facade for the canonical Google Calendar adapter."""

from typing import Any

from backend.domains.calendar.google import (
    create_google_calendar_event as _canonical_create_google_calendar_event,
)
from backend.domains.calendar.google import (
    get_google_calendar_free_busy as _canonical_get_google_calendar_free_busy,
)
from backend.domains.calendar.google import (
    get_google_calendar_service as get_google_calendar_service,
)
from backend.domains.calendar.google import (
    list_google_calendar_events as _canonical_list_google_calendar_events,
)
from backend.domains.calendar.google import (
    patch_event_attendees as _canonical_patch_event_attendees,
)
from backend.domains.calendar.google import (
    respond_to_invitation as _canonical_respond_to_invitation,
)
from backend.domains.calendar.google import (
    update_google_event as _canonical_update_google_event,
)


def list_google_calendar_events(
    email: str,
    calendar_id: str = "primary",
    time_min: str | None = None,
    time_max: str | None = None,
    max_results: int = 250,
) -> Any:
    return _canonical_list_google_calendar_events(
        email,
        calendar_id,
        time_min,
        time_max,
        max_results,
        service_factory=get_google_calendar_service,
    )


def create_google_calendar_event(
    email: str, event_data: dict[str, Any], calendar_id: str = "primary"
) -> Any:
    return _canonical_create_google_calendar_event(
        email,
        event_data,
        calendar_id,
        service_factory=get_google_calendar_service,
    )


def get_google_calendar_free_busy(
    email: str,
    time_min: str,
    time_max: str,
    calendar_ids: list[str] | None = None,
) -> Any:
    return _canonical_get_google_calendar_free_busy(
        email,
        time_min,
        time_max,
        calendar_ids,
        service_factory=get_google_calendar_service,
    )


def update_google_event(email: str, event_uid: str, patch_data: dict[str, Any]) -> bool:
    return bool(
        _canonical_update_google_event(
            email,
            event_uid,
            patch_data,
            service_factory=get_google_calendar_service,
        )
    )


def respond_to_invitation(
    email: str,
    event_id: str,
    rsvp: str,
    calendar_id: str = "primary",
) -> bool:
    return bool(
        _canonical_respond_to_invitation(
            email,
            event_id,
            rsvp,
            calendar_id,
            service_factory=get_google_calendar_service,
        )
    )


def patch_event_attendees(
    email: str,
    event_id: str,
    new_attendees: list[Any],
    calendar_id: str = "primary",
) -> bool:
    return bool(
        _canonical_patch_event_attendees(
            email,
            event_id,
            new_attendees,
            calendar_id,
            service_factory=get_google_calendar_service,
        )
    )
