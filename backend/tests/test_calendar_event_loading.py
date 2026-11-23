"""Concurrency and resilience contracts for calendar event loading."""

from __future__ import annotations

import asyncio
import threading

import pytest
from fastapi import Response

from backend.api import calendar_routes
from backend.services import (
    calendar_event_aggregation,
    hybrid_calendar_service,
    integration_manager,
)


def test_calendar_list_fetches_independent_accounts_concurrently(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    accounts = [
        {"email": "one@example.test", "provider": "google"},
        {"email": "two@example.test", "provider": "caldav"},
    ]
    rendezvous = threading.Barrier(2, timeout=2)

    monkeypatch.setattr(
        integration_manager.integration_manager,
        "get_all_safe",
        lambda: {"calendars": accounts, "emails": []},
    )

    def list_calendars(email: str) -> list[dict[str, object]]:
        rendezvous.wait()
        return [{"id": email, "name": email, "account": email, "provider": "test"}]

    monkeypatch.setattr(calendar_event_aggregation, "list_calendars", list_calendars)
    calendar_routes._CALS_CACHE.clear()

    result = asyncio.run(calendar_routes.get_calendars(Response(), email=None))

    assert {calendar["id"] for calendar in result} == {
        "one@example.test",
        "two@example.test",
    }


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


def test_day_instance_reads_are_bounded_and_do_not_reuse_series_cache(monkeypatch) -> None:
    from fastapi import HTTPException

    monkeypatch.setattr(integration_manager.integration_manager, "get_all_safe", lambda: {"calendars": [{"email": "fixture@example.test"}]})
    monkeypatch.setattr(calendar_routes, "_get_hidden_event_ids", lambda: set())
    calls = []

    def events(*_args, expand_instances=False):
        calls.append(expand_instances)
        return [{"id": "occurrence" if expand_instances else "series"}]

    monkeypatch.setattr(calendar_event_aggregation, "list_events", events)
    calendar_routes._EVENTS_CACHE.clear()
    params = dict(email=None, time_min="2026-10-25T00:00:00+02:00", time_max="2026-10-26T00:00:00+01:00",
                  calendar_id=None, search=None, include_vault=False)
    for expanded in (False, True, True):
        result = asyncio.run(calendar_routes.get_events(**params, expand_instances=expanded))
        assert result == [{"id": "occurrence" if expanded else "series"}]
    assert calls == [False, True]
    with pytest.raises(HTTPException) as exc:
        asyncio.run(calendar_routes.get_events(**{**params, "time_max": "2027-01-01T00:00:00Z"}, expand_instances=True))
    assert exc.value.status_code == 422


def test_calendar_reads_and_provider_workers_partition_the_same_account_by_owner(monkeypatch, tmp_path):
    from backend.domains.calendar.cache_scope import calendar_cache_owner, request_cache_owner
    from backend.services.workspace_service import WorkspaceContext

    email = "shared@example.test"
    monkeypatch.setattr(integration_manager.integration_manager, "get_all_safe", lambda: {"calendars": [{"email": email}]})
    monkeypatch.setattr(calendar_routes, "_get_hidden_event_ids", lambda: set())

    def fixture(key):
        return hybrid_calendar_service._cached_calendar_list(key, lambda: [{"id": calendar_cache_owner.get()}])

    monkeypatch.setattr(calendar_event_aggregation, "list_calendars", fixture)
    monkeypatch.setattr(calendar_event_aggregation, "list_events", lambda *_, **__: fixture("provider:" + email))
    calendar_routes._CALS_CACHE.clear()
    calendar_routes._EVENTS_CACHE.clear()
    hybrid_calendar_service.clear_calendar_list_cache()
    for user, workspace, vault in [("a", "w1", "v1"), ("b", "w1", "v1"), ("a", "w2", "v1"), ("a", "w1", "v2"), ("a", "w1", "v1")]:
        context = WorkspaceContext(workspace, user, "viewer", tmp_path / vault)
        expected = [{"id": request_cache_owner(context)}]
        assert asyncio.run(calendar_routes.get_calendars(Response(), email=None, context=context)) == expected
        assert asyncio.run(calendar_routes.get_events(
            email=None, calendar_id=None, search=None, include_vault=False, expand_instances=True, context=context,
            time_min="2026-11-23T00:00:00Z", time_max="2026-11-24T00:00:00Z",
        )) == expected
