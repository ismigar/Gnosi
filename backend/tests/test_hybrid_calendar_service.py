"""Provider-neutral contracts for the hybrid calendar dispatcher."""

from datetime import datetime, timezone

from backend.services import hybrid_calendar_service as service


def test_normalize_datetime_preserves_aware_iso_value() -> None:
    value = datetime(2026, 8, 28, 10, 30, tzinfo=timezone.utc)

    assert service._normalize_dt(value) == "2026-08-28T10:30:00+00:00"
    assert service._normalize_dt("20260828") == "2026-08-28"


def test_google_dispatch_uses_selected_account(monkeypatch) -> None:
    monkeypatch.setattr(
        service.integration_manager,
        "get_all_safe",
        lambda: {"calendars": [{"email": "user@example.com", "provider": "google"}]},
    )
    monkeypatch.setattr(
        service,
        "google_list_events",
        lambda email, time_min, time_max, search, calendar_id: [
            {
                "account": email,
                "start": time_min,
                "end": time_max,
                "query": search,
                "calendar_id": calendar_id,
            }
        ],
    )

    result = service.list_events(
        "user@example.com", "2026-08-01", "2026-09-01", "design", "primary"
    )

    assert result[0]["account"] == "user@example.com"
    assert result[0]["calendar_id"] == "primary"


def test_nextcloud_account_dispatches_through_caldav(monkeypatch) -> None:
    monkeypatch.setattr(
        service.integration_manager,
        "get_all_safe",
        lambda: {
            "calendars": [
                {
                    "email": "user@example.com",
                    "provider": "caldav",
                    "caldav_url": "https://cloud.example.com/remote.php/dav/calendars/user",
                }
            ]
        },
    )
    monkeypatch.setattr(
        service,
        "caldav_list_events",
        lambda email, time_min, time_max, search: [{"provider": "caldav", "account": email}],
    )

    result = service.list_events(
        "user@example.com", "2026-08-01", "2026-09-01", "meeting"
    )

    assert result == [{"provider": "caldav", "account": "user@example.com"}]


def test_unknown_account_returns_no_events(monkeypatch) -> None:
    monkeypatch.setattr(
        service.integration_manager,
        "get_all_safe",
        lambda: {"calendars": [], "emails": []},
    )

    assert service.list_events("missing@example.com", "start", "end") == []
    assert service.get_event("missing@example.com", "event") is None
