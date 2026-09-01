"""Typed contracts for starting and polling durable Brain ingests."""

from __future__ import annotations

import asyncio

import pytest
from fastapi.routing import APIRoute


def _routes() -> dict[str, APIRoute]:
    from backend.domains.vault.knowledge import jobs_routes

    return {
        route.endpoint.__name__: route
        for route in jobs_routes.router.routes
        if isinstance(route, APIRoute)
    }


def test_process_resource_routes_publish_typed_contracts() -> None:
    from backend.domains.vault.knowledge import jobs_routes

    routes = _routes()

    assert (
        routes["llm_wiki_process"].response_model
        is jobs_routes.LlmWikiProcessStartResponse
    )
    assert routes["llm_wiki_process"].response_model_exclude_unset is True
    assert routes["llm_wiki_status"].response_model is jobs_routes.LlmWikiJobResponse
    assert routes["llm_wiki_status"].response_model_exclude_unset is True


def test_process_resource_routes_preserve_start_and_status_shapes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.domains.vault.knowledge import jobs_routes
    from backend.services import llm_wiki_actions

    job = {
        "job_id": "job-1",
        "source_table_id": "resources",
        "resource_id": "resource-1",
        "running": True,
        "phase": "reading",
        "progress": 0,
        "created": [],
        "updated": [],
    }
    started = {
        "status": "started",
        "item_id": "resource-1",
        "resource_id": "resource-1",
        "source_table_id": "resources",
        "job_id": "job-1",
        "job": job,
    }

    def fake_start(
        resource_id: str,
        *,
        source_table_id: str,
        force: bool,
        language: str,
    ) -> dict[str, object]:
        assert resource_id == "resource-1"
        assert source_table_id == "resources"
        assert force is True
        assert language == "Catalan"
        return started

    def fake_status(resource_id: str, *, source_table_id: str) -> dict[str, object]:
        assert resource_id == "job-1"
        assert source_table_id == "resources"
        return job

    monkeypatch.setattr(llm_wiki_actions, "start_source_process", fake_start)
    monkeypatch.setattr(llm_wiki_actions, "process_status", fake_status)

    start_result = asyncio.run(
        jobs_routes.llm_wiki_process(
            jobs_routes.LlmWikiProcessRequest(
                resource_id="resource-1",
                source_table_id="resources",
                force=True,
                language="Catalan",
            )
        )
    )
    status_result = asyncio.run(
        jobs_routes.llm_wiki_status("job-1", source_table_id="resources")
    )

    assert start_result == started
    assert status_result == job
