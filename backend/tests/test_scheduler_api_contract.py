"""Typed HTTP contract for scheduler tasks and execution history."""

from __future__ import annotations

import asyncio

from fastapi import FastAPI

from backend.api import scheduler_routes
from backend.models.scheduler import ScheduledTaskResponse, TaskUpdateResponse


TASK = {
    "name": "fetch_feeds",
    "description": "Fetch RSS/YouTube feeds",
    "interval_minutes": 120.0,
    "enabled": True,
    "last_run": None,
    "next_run": None,
    "status": "idle",
}


def _focused_openapi() -> dict[str, object]:
    app = FastAPI()
    app.include_router(scheduler_routes.router)
    return app.openapi()


def test_scheduler_openapi_exposes_concrete_response_models() -> None:
    schema = _focused_openapi()
    paths = schema["paths"]

    assert paths["/api/schedulers"]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"] == {
        "items": {"$ref": "#/components/schemas/ScheduledTaskResponse"},
        "title": "Response List Tasks Api Schedulers Get",
        "type": "array",
    }
    assert paths["/api/schedulers/{name}"]["put"]["responses"]["200"][
        "content"
    ]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/TaskUpdateResponse"
    }
    assert paths["/api/schedulers/history"]["get"]["responses"]["200"][
        "content"
    ]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/TaskHistoryPageResponse"
    }


def test_scheduler_routes_validate_manager_payloads(monkeypatch) -> None:
    monkeypatch.setattr(
        scheduler_routes.scheduler_manager,
        "get_tasks",
        lambda: [TASK],
    )
    monkeypatch.setattr(
        scheduler_routes.scheduler_manager,
        "update_task",
        lambda **_kwargs: {"success": True, "task": TASK},
    )

    listed = asyncio.run(scheduler_routes.list_tasks())
    updated = asyncio.run(
        scheduler_routes.update_task(
            "fetch_feeds",
            scheduler_routes.TaskUpdate(interval_minutes=60, enabled=False),
        )
    )

    assert listed == [ScheduledTaskResponse.model_validate(TASK)]
    assert updated == TaskUpdateResponse.model_validate(
        {"success": True, "task": TASK}
    )
