from unittest.mock import MagicMock

from backend.services import google_calendar_service


def _calendar_service(*existing_events):
    service = MagicMock()
    events_by_id = {event["id"]: event for event in existing_events}

    def get_event(*, eventId, **_kwargs):
        request = MagicMock()
        request.execute.return_value = events_by_id[eventId]
        return request

    service.events.return_value.get.side_effect = get_event
    service.events.return_value.patch.return_value.execute.return_value = {
        "status": "confirmed"
    }
    return service


def test_update_google_event_patches_birthday_occurrence(monkeypatch):
    service = _calendar_service(
        {
            "id": "birthday-series_20260819",
            "eventType": "birthday",
            "recurringEventId": "birthday-series",
            "birthdayProperties": {
                "contact": "people/contact-id",
                "type": "birthday",
            },
            "summary": "Original birthday",
            "start": {"date": "2026-08-19"},
            "end": {"date": "2026-08-20"},
        },
        {
            "id": "birthday-series",
            "eventType": "birthday",
            "recurrence": ["RRULE:FREQ=YEARLY"],
            "birthdayProperties": {
                "contact": "people/contact-id",
                "type": "birthday",
            },
            "summary": "Original birthday",
            "start": {"date": "1976-08-19"},
            "end": {"date": "1976-08-20"},
        },
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
        eventId="birthday-series",
        body={
            "summary": "Updated birthday",
        },
    )


def test_update_google_event_ignores_contact_birthday_date_changes(monkeypatch):
    service = _calendar_service(
        {
            "id": "birthday-series_20260819",
            "eventType": "birthday",
            "recurringEventId": "birthday-series",
            "birthdayProperties": {
                "contact": "people/contact-id",
                "type": "birthday",
            },
            "summary": "Birthday",
            "start": {"date": "2026-08-19"},
            "end": {"date": "2026-08-20"},
        },
        {
            "id": "birthday-series",
            "eventType": "birthday",
            "recurrence": ["RRULE:FREQ=YEARLY"],
            "summary": "Birthday",
            "start": {"date": "1976-08-19"},
            "end": {"date": "1976-08-20"},
        },
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
            "start": "2026-08-19",
            "end": "2026-08-19",
        },
    )

    assert updated is True
    service.events.return_value.patch.assert_not_called()


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
