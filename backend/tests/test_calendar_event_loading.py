"""Concurrency and resilience contracts for calendar event loading."""

from __future__ import annotations

import threading

from backend.api import calendar_routes
from backend.services import calendar_event_aggregation, hybrid_calendar_service


def test_collect_all_events_fetches_independent_accounts_concurrently(monkeypatch) -> None:
    accounts = [
        {"email": "one@example.test", "provider": "google"},
        {"email": "two@example.test", "provider": "caldav"},
    ]
    rendezvous = threading.Barrier(2, timeout=2)

    monkeypatch.setattr(
        hybrid_calendar_service.integration_manager,
        "get_all_safe",
        lambda: {"calendars": accounts, "emails": []},
    )
    monkeypatch.setattr(calendar_routes, "_get_hidden_event_ids", lambda: set())
    monkeypatch.setattr(calendar_routes, "_get_vault_events", lambda *_args: [])
    monkeypatch.setattr(
        calendar_event_aggregation,
        "list_events",
        lambda email, *_args: (
            rendezvous.wait(),
            [{"id": email, "title": email, "start": "2026-09-01"}],
        )[1],
    )
    calendar_routes._EVENTS_CACHE.clear()

    result = calendar_routes.collect_all_events(
        "2026-09-01", "2026-10-01", include_vault=False
    )

    assert {event["id"] for event in result} == {
        "one@example.test",
        "two@example.test",
    }


def test_collect_all_events_keeps_valid_empty_results_cached(monkeypatch) -> None:
    calls = 0

    monkeypatch.setattr(
        hybrid_calendar_service.integration_manager,
        "get_all_safe",
        lambda: {
            "calendars": [{"email": "empty@example.test", "provider": "google"}],
            "emails": [],
        },
    )
    monkeypatch.setattr(calendar_routes, "_get_hidden_event_ids", lambda: set())

    def empty_events(*_args: object) -> list[dict[str, object]]:
        nonlocal calls
        calls += 1
        return []

    monkeypatch.setattr(calendar_event_aggregation, "list_events", empty_events)
    calendar_routes._EVENTS_CACHE.clear()

    for _ in range(2):
        assert (
            calendar_routes.collect_all_events(
                "2026-09-01", "2026-10-01", include_vault=False
            )
            == []
        )

    assert calls == 1
