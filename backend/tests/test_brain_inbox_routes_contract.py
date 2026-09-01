"""Typed contracts for the read-only Brain connection inbox."""

from __future__ import annotations

import asyncio

from fastapi.routing import APIRoute


def _routes() -> dict[str, APIRoute]:
    from backend.domains.vault.knowledge import jobs_routes

    return {
        route.endpoint.__name__: route
        for route in jobs_routes.router.routes
        if isinstance(route, APIRoute)
    }


def test_brain_inbox_routes_publish_typed_response_contracts() -> None:
    from backend.domains.vault.knowledge import jobs_routes

    routes = _routes()

    assert (
        routes["llm_wiki_list_suggestions"].response_model
        is jobs_routes.BrainSuggestionListResponse
    )
    assert routes["llm_wiki_list_suggestions"].response_model_exclude_unset is True
    assert (
        routes["llm_wiki_reject_suggestion"].response_model
        is jobs_routes.BrainSuggestionRejectedResponse
    )
    assert (
        routes["llm_wiki_dismiss_suggestion"].response_model
        is jobs_routes.BrainSuggestionRejectedResponse
    )


def test_brain_inbox_preserves_queue_and_dismiss_shapes(monkeypatch) -> None:
    from backend.domains.vault.knowledge import jobs_routes
    from backend.services import llm_wiki_suggestions

    suggestion = {
        "id": "proposal-1",
        "title": "Connect both notes",
        "kind": "connection",
        "why": "Shared evidence",
        "evidence": ["Excerpt"],
        "member_ids": ["page-1", "page-2"],
        "member_titles": ["One", "Two"],
    }
    monkeypatch.setattr(llm_wiki_suggestions, "load_queue", lambda: [suggestion])
    monkeypatch.setattr(
        llm_wiki_suggestions,
        "pop_suggestion",
        lambda suggestion_id: suggestion if suggestion_id == "proposal-1" else None,
    )

    listed = asyncio.run(jobs_routes.llm_wiki_list_suggestions())
    dismissed = asyncio.run(jobs_routes.llm_wiki_dismiss_suggestion("proposal-1"))

    assert listed == {"suggestions": [suggestion]}
    assert dismissed == {"rejected": "proposal-1"}
