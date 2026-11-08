"""Scheduling accepts browser UTC dates and legacy local dates without live sends."""
import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

from fastapi import BackgroundTasks, HTTPException
import pytest

from backend.api import social_routes as routes
from backend.domains.social.schemas import SchedulePublishRequest
from backend.services import social_store


@pytest.mark.parametrize("zone", [timezone.utc, timezone(timedelta(hours=2)), None])
def test_schedule_accepts_future_and_rejects_past(monkeypatch, zone):
    save = AsyncMock(return_value="scheduled")
    monkeypatch.setattr(routes.social_store, "save_publication", save)
    monkeypatch.setattr(routes, "_check_publish_requires", AsyncMock())
    future = datetime.now(zone) + timedelta(days=1)
    request = SchedulePublishRequest(posts={"mastodon": {"text": "Article"}}, scheduled_time=future)
    result = asyncio.run(routes.schedule_post(request, BackgroundTasks()))
    assert result.id == "scheduled"
    assert save.call_args.kwargs["scheduled_time"] == future.isoformat()
    request.scheduled_time = datetime.now(zone) - timedelta(days=1)
    with pytest.raises(HTTPException) as error:
        asyncio.run(routes.schedule_post(request, BackgroundTasks()))
    assert error.value.status_code == 400
    assert save.call_count == 1


@pytest.mark.parametrize("zone", [timezone.utc, timezone(timedelta(hours=-3)), None])
def test_due_schedules_are_processed_and_future_ones_wait(monkeypatch, zone):
    now = datetime.now(zone)
    records = [{"id": name, social_store.COL_SCHEDULED: instant.isoformat(),
                social_store.COL_MESSAGES: '{"mastodon": {"text": "Article"}}',
                social_store.COL_ORIGIN: "article"}
               for name, instant in [("due", now - timedelta(days=1)), ("future", now + timedelta(days=1))]]
    monkeypatch.setattr(routes.social_store, "list_publications", AsyncMock(return_value=records))
    monkeypatch.setattr(routes.social_store, "update_publication", AsyncMock())
    publish = AsyncMock(return_value=("due", social_store.STATUS_PUBLISHED, {"mastodon": {"status": "success"}}))
    monkeypatch.setattr(routes, "_do_publish", publish)
    result = asyncio.run(routes.process_scheduled_posts(BackgroundTasks()))
    assert result.processed == 1
    assert result.details[0].id == "due"
    publish.assert_awaited_once()
    assert publish.call_args.kwargs["source_page_id"] == "article"
