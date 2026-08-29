"""Typed HTTP contracts for Vault daily notes."""

from __future__ import annotations

from fastapi.routing import APIRoute


def _routes() -> dict[str, APIRoute]:
    from backend.api import vault_routes
    from backend.domains.vault.api import core_routes  # noqa: F401

    names = {"get_or_create_daily_note", "list_daily_notes"}
    return {
        route.endpoint.__name__: route
        for route in vault_routes.router.routes
        if isinstance(route, APIRoute) and route.endpoint.__name__ in names
    }


def test_daily_routes_publish_typed_models() -> None:
    from backend.domains.vault.daily import contracts

    registered = _routes()

    assert registered["list_daily_notes"].response_model == list[
        contracts.DailyNoteSummaryResponse
    ]
    assert (
        registered["get_or_create_daily_note"].response_model
        is contracts.DailyNoteDocumentResponse
    )


def test_daily_document_contract_preserves_page_payload() -> None:
    from backend.domains.vault.daily.contracts import DailyNoteDocumentResponse

    payload = {
        "id": "daily-1",
        "title": "2026-08-29",
        "content": "Seed",
        "metadata": {"note_type": "daily"},
        "etag": "etag-1",
    }

    assert DailyNoteDocumentResponse.model_validate(payload).model_dump() == payload
