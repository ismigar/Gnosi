"""Typed HTTP contract for Reader sources, articles, analysis, and podcasts."""

from __future__ import annotations

from fastapi import FastAPI

from backend.domains.reader import routes
from backend.domains.reader.schemas import (
    ReaderAnalysisJobResponse,
    ReaderBackfillTriggerResponse,
    ReaderInventoryResponse,
    ReaderPodcastInfoResponse,
)


SCOPE = {
    "unread_only": True,
    "read_status": "unread",
    "source_ids": [],
    "source_names": [],
    "categories": [],
    "date_from": "",
    "date_to": "",
    "include_full_content": True,
    "limit": 200,
    "offset": 0,
}


def _focused_openapi() -> dict[str, object]:
    app = FastAPI()
    app.include_router(routes.router)
    return app.openapi()


def test_reader_openapi_exposes_concrete_json_responses() -> None:
    schema = _focused_openapi()
    paths = schema["paths"]

    assert paths["/api/reader/inventory"]["get"]["responses"]["200"]["content"]["application/json"][
        "schema"
    ] == {"$ref": "#/components/schemas/ReaderInventoryResponse"}
    assert paths["/api/reader/analysis"]["get"]["responses"]["200"]["content"]["application/json"][
        "schema"
    ] == {
        "items": {"$ref": "#/components/schemas/ReaderAnalysisJobResponse"},
        "title": "Response List Reader Analyses Api Reader Analysis Get",
        "type": "array",
    }
    assert paths["/api/reader/podcast/info"]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"] == {"$ref": "#/components/schemas/ReaderPodcastInfoResponse"}


def test_reader_models_validate_inventory_and_durable_job_payloads() -> None:
    inventory = ReaderInventoryResponse.model_validate(
        {
            "source": "reader",
            "count": 2,
            "read_count": 0,
            "unread_count": 2,
            "feed_count": 1,
            "category_count": 1,
            "oldest": "2026-01-01T00:00:00+00:00",
            "newest": "2026-01-02T00:00:00+00:00",
            "feeds": [
                {
                    "id": 7,
                    "name": "Research",
                    "category": "News",
                    "count": 2,
                }
            ],
            "categories": [{"category": "News", "count": 2}],
            "record_fields": ["id", "title"],
            "scope": SCOPE,
        }
    )
    job = ReaderAnalysisJobResponse.model_validate(
        {
            "job_id": "job-1",
            "state": "queued",
            "phase": "queued",
            "progress": 0,
            "total_articles": 0,
            "processed_articles": 0,
            "total_batches": 0,
            "completed_batches": 0,
            "language": "Catalan",
            "scope": SCOPE,
            "snapshot_digest": "",
            "created_at": "2026-01-01T00:00:00+00:00",
            "updated_at": "2026-01-01T00:00:00+00:00",
            "result_available": False,
            "retry": {
                "automatic_enabled": True,
                "attempt": 0,
                "max_attempts": 3,
                "base_delay_seconds": 5,
                "max_delay_seconds": 60,
                "next_retry_at": None,
                "model_call_budget": 100,
                "model_calls_used": 0,
                "last_retry_reason": None,
                "last_resume_kind": "initial",
                "budget_exhausted": False,
            },
        }
    )

    assert inventory.feeds[0].count == 2
    assert job.retry.model_calls_used == 0


def test_reader_variant_responses_preserve_legacy_short_payloads() -> None:
    podcast_info = ReaderPodcastInfoResponse.model_validate({"exists": False})
    backfill = ReaderBackfillTriggerResponse.model_validate({"status": "started"})
    legacy_job = ReaderAnalysisJobResponse.model_validate(
        {
            "job_id": "legacy-job",
            "state": "failed",
            "scope": {"unread_only": True},
        }
    )

    assert podcast_info.model_dump(exclude_unset=True) == {"exists": False}
    assert backfill.model_dump(exclude_unset=True) == {"status": "started"}
    assert legacy_job.model_dump(exclude_unset=True) == {
        "job_id": "legacy-job",
        "scope": {"unread_only": True},
        "state": "failed",
    }

    variable_paths = {
        "/api/reader/analysis",
        "/api/reader/analysis/{job_id}",
        "/api/reader/analysis/{job_id}/cancel",
        "/api/reader/analysis/{job_id}/result",
        "/api/reader/analysis/{job_id}/resume",
        "/api/reader/articles/backfill-extract",
        "/api/reader/podcast/generate",
        "/api/reader/podcast/info",
    }
    for route in routes.router.routes:
        if route.path in variable_paths:
            assert route.response_model_exclude_unset is True
