"""Typed HTTP and internal-consumer contract for the social domain."""

from __future__ import annotations

import asyncio
import json

from fastapi import FastAPI

from backend.agent.social_tools import _json_result
from backend.api import social_routes
from backend.domains.social.schemas import (
    ProcessScheduledResponse,
    ScheduledPostResponse,
    Stream,
)
from backend.services import social_store


def _focused_openapi() -> dict[str, object]:
    app = FastAPI()
    app.include_router(social_routes.router, prefix="/api/social")
    return app.openapi()


def test_social_openapi_exposes_concrete_response_models() -> None:
    paths = _focused_openapi()["paths"]

    assert paths["/api/social/streams"]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"]["items"] == {"$ref": "#/components/schemas/Stream"}
    assert paths["/api/social/feed/{stream_id}"]["get"]["responses"]["200"][
        "content"
    ]["application/json"]["schema"]["items"] == {
        "$ref": "#/components/schemas/SocialPost"
    }
    assert paths["/api/social/compose"]["post"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"] == {"$ref": "#/components/schemas/ComposeResponse"}
    assert paths["/api/social/process-scheduled"]["post"]["responses"]["200"][
        "content"
    ]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/ProcessScheduledResponse"
    }


def test_social_routes_validate_stream_and_scheduled_payloads(monkeypatch) -> None:
    monkeypatch.setattr(
        social_routes.integration_manager,
        "_load",
        lambda: {
            "social_streams": [
                {
                    "id": "scheduled",
                    "title": "Scheduled",
                    "icon": "calendar",
                    "network": "scheduled",
                }
            ]
        },
    )

    async def list_publications(*, status=None):
        assert status == social_store.STATUS_SCHEDULED
        return [
            {
                "id": "post-1",
                social_store.COL_MESSAGES: json.dumps(
                    {"mastodon": {"text": "Hello"}}
                ),
                social_store.COL_NETWORKS: "mastodon",
                social_store.COL_SCHEDULED: "2030-01-02T10:00:00",
            }
        ]

    monkeypatch.setattr(social_routes.social_store, "list_publications", list_publications)

    streams = asyncio.run(social_routes.get_streams())
    scheduled = asyncio.run(social_routes.get_scheduled_posts())

    assert streams == [
        Stream(id="scheduled", title="Scheduled", icon="calendar", network="scheduled")
    ]
    assert scheduled == [
        ScheduledPostResponse(
            id="post-1",
            content="Hello",
            networks=["mastodon"],
            scheduled_time="2030-01-02T10:00:00",
            status="pending",
        )
    ]


def test_internal_social_serialization_preserves_structured_json() -> None:
    result = ProcessScheduledResponse(processed=0, details=[])

    assert json.loads(_json_result(result)) == {"processed": 0, "details": []}
