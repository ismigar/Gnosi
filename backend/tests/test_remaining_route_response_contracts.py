"""Focused contracts for the last JSON response-model closure slice."""

from __future__ import annotations

from typing import Any, get_type_hints

from fastapi.responses import Response, StreamingResponse
from fastapi.routing import APIRoute

from backend.api import mail_routes, vault_routes
from backend.domains.mail import schemas as mail_schemas
from backend.domains.vault.citations import formatting, keys_api
from backend.domains.vault.links import schemas as link_schemas
from backend.domains.vault.schemas.pages import BulkPageMutationResponse
from backend.domains.vault.tables import contracts as table_contracts
from backend.domains.vault.translation import routes as translation_routes


JSON_RESPONSE_MODELS: dict[str, object] = {
    "generate_citation_key_endpoint": keys_api.CitationKeyResponse,
    "format_citation": formatting.FormattedCitationResponse,
    "format_citations": formatting.FormattedCitationsResponse,
    "format_bibliography": formatting.FormattedBibliographyResponse,
    "bulk_update_metadata": BulkPageMutationResponse,
    "sync_drupal_rows": translation_routes.SyncDrupalRowsResponse,
    "execute_button_action": translation_routes.ExecuteButtonActionResponse,
    "delete_option_catalog": table_contracts.OptionCatalogDeleteResponse,
    "get_schema": table_contracts.RegistryRecord,
    "get_link_index_stats": link_schemas.LinkIndexStatsResponse,
    "post_link_index_rebuild": link_schemas.LinkIndexRebuildResponse,
}

VAULT_SPECIALIZED_RESPONSES = {"export_references", "export_page"}

MAIL_SPECIALIZED_RESPONSES: dict[tuple[str, str], type[Response]] = {
    ("GET", "/api/mail/events"): StreamingResponse,
    (
        "GET",
        "/api/mail/messages/{message_id}/attachments/{att_id:path}",
    ): Response,
    ("GET", "/api/mail/messages/{message_id}/cid/{cid:path}"): Response,
    ("POST", "/api/mail/remote-images/fetch"): Response,
}

MAIL_NO_CONTENT_RESPONSES = {
    ("DELETE", "/api/mail/tags/{tag_id}"),
    ("DELETE", "/api/mail/views/{view_id}"),
}


def _routes(router: object) -> list[APIRoute]:
    return [route for route in getattr(router, "routes") if isinstance(route, APIRoute)]


def _route_by_name(router: object, endpoint_name: str) -> APIRoute:
    return next(route for route in _routes(router) if route.endpoint.__name__ == endpoint_name)


def _mail_route(method: str, path: str) -> APIRoute:
    return next(
        route
        for route in _routes(mail_routes.router)
        if route.path == path and method in (route.methods or set())
    )


def test_remaining_json_routes_publish_exact_response_models() -> None:
    for endpoint_name, response_model in JSON_RESPONSE_MODELS.items():
        route = _route_by_name(vault_routes.router, endpoint_name)
        assert route.response_model == response_model
        assert get_type_hints(route.endpoint).get("return") is not Any


def test_only_specialized_and_no_content_routes_keep_no_response_model() -> None:
    for endpoint_name in VAULT_SPECIALIZED_RESPONSES:
        route = _route_by_name(vault_routes.router, endpoint_name)
        assert route.response_model is None
        assert get_type_hints(route.endpoint)["return"] is Response

    for operation, response_class in MAIL_SPECIALIZED_RESPONSES.items():
        route = _mail_route(*operation)
        assert route.response_model is None
        assert route.response_class is response_class
        assert get_type_hints(route.endpoint)["return"] is response_class

    for operation in MAIL_NO_CONTENT_RESPONSES:
        route = _mail_route(*operation)
        assert route.status_code == 204
        assert route.response_model is None
        assert get_type_hints(route.endpoint)["return"] is type(None)


def test_new_models_preserve_exact_short_and_extension_payloads() -> None:
    citation = {
        "key": "rodoreda2026",
        "formatted": "Rodoreda (2026)",
        "resolved": True,
    }
    assert formatting.FormattedCitationResponse.model_validate(citation).model_dump() == citation

    short_bibliography = {
        "entries": [],
        "style": "apa",
        "locale": "ca",
        "resolved": 0,
        "missing": ["missing"],
    }
    assert (
        formatting.FormattedBibliographyResponse.model_validate(short_bibliography).model_dump(
            exclude_unset=True
        )
        == short_bibliography
    )

    sync = {
        "status": "ok",
        "results": [{"item_id": "row-1", "extension": {"nid": 17}}],
        "errors": [{"item_id": 7, "detail": {"reason": "synthetic"}}],
        "provider_extension": {"request_id": "test-only"},
    }
    assert translation_routes.SyncDrupalRowsResponse.model_validate(sync).model_dump() == sync

    executed = {
        "status": "ok",
        "note_id": "note-1",
        "updated_field": "Summary",
        "value": "Result",
        "metadata": {
            "title": "Synthetic",
            "extension": [None, False, {"score": 0.5}],
        },
    }
    assert (
        translation_routes.ExecuteButtonActionResponse.model_validate(executed).model_dump()
        == executed
    )

    stats = {
        "built": True,
        "built_ts": 1.0,
        "built_age_seconds": 2.5,
        "schema_version": 3,
        "sources_indexed": 4,
        "targets_with_backlinks": 2,
        "unresolved_title_buckets": 1,
        "total_outlinks": 5,
        "total_tokens": 6,
        "disk_cache": {"path": None, "exists": False, "size_bytes": 0},
    }
    assert link_schemas.LinkIndexStatsResponse.model_validate(stats).model_dump() == stats
    assert table_contracts.OptionCatalogDeleteResponse.model_validate(
        {"status": "ok"}
    ).model_dump() == {"status": "ok"}


def test_existing_mail_json_models_remain_unchanged() -> None:
    assert (
        _mail_route(
            "PATCH",
            "/api/mail/accounts/{email:path}/enabled",
        ).response_model
        is mail_schemas.MailAccountEnabledResponse
    )
    assert (
        _mail_route("GET", "/api/mail/views").response_model == list[mail_schemas.MailViewResponse]
    )
    assert _mail_route("GET", "/api/mail/tags").response_model == list[mail_schemas.MailTagResponse]
