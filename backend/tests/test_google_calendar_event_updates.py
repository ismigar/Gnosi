from unittest.mock import MagicMock

from backend.services import google_calendar_service


def _calendar_service(existing_event):
    service = MagicMock()
    service.events.return_value.get.return_value.execute.return_value = existing_event
    service.events.return_value.patch.return_value.execute.return_value = {"status": "confirmed"}
    return service


def test_update_google_event_patches_birthday_occurrence(monkeypatch):
    service = _calendar_service(
        {
            "id": "birthday-series_20260819",
            "eventType": "birthday",
            "recurringEventId": "birthday-series",
            "birthdayProperties": {"type": "birthday"},
            "summary": "Original birthday",
            "start": {"date": "2026-08-19"},
            "end": {"date": "2026-08-20"},
        }
    )
    monkeypatch.setattr(
        google_calendar_service,
        "get_google_calendar_service",
        lambda _email: service,
    )

    updated = google_calendar_service.update_google_event(
        "person@example.com",
        "birthday-series_20260819",
        {
            "calendar_id": "person@example.com",
            "summary": "Updated birthday",
            "location": "",
            "description": "",
            "attendees": [],
            "start": "2026-08-19",
            "end": "2026-08-20",
        },
    )

    assert updated is True
    service.events.return_value.update.assert_not_called()
    service.events.return_value.patch.assert_called_once_with(
        calendarId="person@example.com",
        eventId="birthday-series_20260819",
        body={
            "summary": "Updated birthday",
        },
    )


def test_update_google_event_preserves_existing_timezone(monkeypatch):
    service = _calendar_service(
        {
            "id": "timed-event",
            "start": {"dateTime": "2026-08-19T10:00:00", "timeZone": "Europe/Paris"},
            "end": {"dateTime": "2026-08-19T11:00:00", "timeZone": "Europe/Paris"},
        }
    )
    monkeypatch.setattr(
        google_calendar_service,
        "get_google_calendar_service",
        lambda _email: service,
    )

    updated = google_calendar_service.update_google_event(
        "person@example.com",
        "timed-event",
        {
            "start": "2026-08-19T12:00:00",
            "end": "2026-08-19T13:00:00",
        },
    )

    assert updated is True
    service.events.return_value.patch.assert_called_once_with(
        calendarId="primary",
        eventId="timed-event",
        body={
            "start": {
                "dateTime": "2026-08-19T12:00:00",
                "timeZone": "Europe/Paris",
            },
            "end": {
                "dateTime": "2026-08-19T13:00:00",
                "timeZone": "Europe/Paris",
            },
        },
    )
