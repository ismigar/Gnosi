"""Provider-neutral contracts for the hybrid calendar dispatcher."""

import threading
from datetime import datetime, timezone

from backend.services import hybrid_calendar_service as service


def test_normalize_datetime_preserves_aware_iso_value() -> None:
    value = datetime(2026, 8, 28, 10, 30, tzinfo=timezone.utc)

    assert service._normalize_dt(value) == "2026-08-28T10:30:00+00:00"
    assert service._normalize_dt("20260828") == "2026-08-28"


def test_google_dispatch_uses_selected_account(monkeypatch) -> None:
    monkeypatch.setattr(
        service.integration_manager,
        "get_raw",
        lambda section: (
            [{"email": "user@example.com", "provider": "google"}]
            if section == "calendars"
            else []
        ),
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
        "get_raw",
        lambda section: (
            [
                {
                    "email": "user@example.com",
                    "provider": "caldav",
                    "caldav_url": "https://cloud.example.com/remote.php/dav/calendars/user",
                    "password": "resolved-app-password",
                }
            ]
            if section == "calendars"
            else []
        ),
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
    account = service._get_account("user@example.com")
    assert account is not None
    assert service._caldav_session(account).auth == (
        "user@example.com",
        "resolved-app-password",
    )


def test_unknown_account_returns_no_events(monkeypatch) -> None:
    monkeypatch.setattr(
        service.integration_manager,
        "get_raw",
        lambda _section: [],
    )

    assert service.list_events("missing@example.com", "start", "end") == []
    assert service.get_event("missing@example.com", "event") is None


def test_google_events_use_one_batch_for_multiple_calendars(monkeypatch) -> None:
    class FakeRequest:
        def __init__(self, calendar_id: str) -> None:
            self.calendar_id = calendar_id

        def execute(self) -> dict[str, object]:
            raise AssertionError("multi-calendar loading should use the batch transport")

    class FakeEvents:
        def list(self, **kwargs: object) -> FakeRequest:
            return FakeRequest(str(kwargs["calendarId"]))

    class FakeBatch:
        def __init__(self, callback: object) -> None:
            self.callback = callback
            self.requests: list[tuple[str, FakeRequest]] = []

        def add(self, request: FakeRequest, *, request_id: str) -> None:
            self.requests.append((request_id, request))

        def execute(self) -> None:
            for request_id, request in self.requests:
                self.callback(
                    request_id,
                    {"items": [{"id": f"event-{request.calendar_id}"}]},
                    None,
                )

    class FakeService:
        def __init__(self) -> None:
            self.batch: FakeBatch | None = None

        def events(self) -> FakeEvents:
            return FakeEvents()

        def new_batch_http_request(self, *, callback: object) -> FakeBatch:
            self.batch = FakeBatch(callback)
            return self.batch

    fake_service = FakeService()
    monkeypatch.setattr(service, "_google_service", lambda _email: fake_service)
    service.clear_calendar_list_cache()
    monkeypatch.setattr(
        service,
        "_load_google_calendars",
        lambda _email, _provider_service: [
            {"id": "primary", "name": "Primary"},
            {"id": "shared", "name": "Shared"},
        ],
    )
    monkeypatch.setattr(
        service,
        "_normalize_google_event",
        lambda event, _email, calendar: {
            "id": event["id"],
            "calendar_id": calendar["id"],
        },
    )

    result = service.google_list_events(
        "user@example.com", "2026-09-01", "2026-10-01"
    )

    assert fake_service.batch is not None
    assert len(fake_service.batch.requests) == 2
    assert result == [
        {"id": "event-primary", "calendar_id": "primary"},
        {"id": "event-shared", "calendar_id": "shared"},
    ]


def test_google_events_build_one_service_for_discovery_and_events(monkeypatch) -> None:
    service_calls = 0

    class FakeRequest:
        def execute(self) -> dict[str, object]:
            return {"items": []}

    class FakeCalendarList:
        def list(self) -> FakeRequest:
            return FakeRequest()

    class FakeEvents:
        def list(self, **_kwargs: object) -> FakeRequest:
            return FakeRequest()

    class FakeService:
        def calendarList(self) -> FakeCalendarList:
            return FakeCalendarList()

        def events(self) -> FakeEvents:
            return FakeEvents()

    def service_factory(_email: str) -> FakeService:
        nonlocal service_calls
        service_calls += 1
        return FakeService()

    monkeypatch.setattr(service, "_google_service", service_factory)
    service.clear_calendar_list_cache()

    assert service.google_list_events(
        "user@example.com", "2026-09-01", "2026-10-01"
    ) == []
    assert service_calls == 1


def test_calendar_list_cache_coalesces_concurrent_google_discovery(monkeypatch) -> None:
    load_started = threading.Event()
    release_load = threading.Event()
    calls = 0

    def load(_email: str, _provider_service: object) -> list[service.JsonObject]:
        nonlocal calls
        calls += 1
        load_started.set()
        assert release_load.wait(timeout=2)
        return [{"id": "primary"}]

    monkeypatch.setattr(service, "_google_service", lambda _email: object())
    monkeypatch.setattr(service, "_load_google_calendars", load)
    service.clear_calendar_list_cache()

    results: list[list[service.JsonObject]] = []

    def fetch() -> None:
        results.append(service.google_list_calendars("user@example.com"))

    first = threading.Thread(target=fetch)
    second = threading.Thread(target=fetch)
    first.start()
    assert load_started.wait(timeout=2)
    second.start()
    release_load.set()
    first.join(timeout=3)
    second.join(timeout=3)

    assert results == [[{"id": "primary"}], [{"id": "primary"}]]
    assert calls == 1
