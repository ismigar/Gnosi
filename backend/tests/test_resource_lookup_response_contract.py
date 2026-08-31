"""Typed response contracts for Vault resource lookup routes."""

from __future__ import annotations

import asyncio

import pytest
from fastapi.params import File as FileParameter
from fastapi.routing import APIRoute
from pydantic import BaseModel


def _route_models() -> dict[str, type[BaseModel]]:
    from backend.domains.vault.citations import lookup_routes

    return {
        "/lookup-metadata": lookup_routes.MetadataLookupResponse,
        "/translate-url": lookup_routes.UrlTranslationResponse,
        "/recognize-pdf": lookup_routes.PdfRecognitionResponse,
        "/promote-zotero-extra": lookup_routes.ZoteroExtraPromotionResponse,
    }


def _resource_lookup_routes() -> dict[str, APIRoute]:
    from backend.domains.vault.citations import lookup_routes

    route_models = _route_models()
    return {
        route.path: route
        for route in lookup_routes.router.routes
        if isinstance(route, APIRoute) and route.path in route_models
    }


def test_resource_lookup_routes_publish_typed_response_models() -> None:
    routes = _resource_lookup_routes()
    route_models = _route_models()

    assert set(routes) == set(route_models)
    for path, response_model in route_models.items():
        route = routes[path]
        assert route.methods == {"POST"}
        assert route.status_code is None
        assert route.response_model is response_model

    assert routes["/translate-url"].response_model_exclude_unset is True


def test_pdf_recognition_route_keeps_required_multipart_upload() -> None:
    route = _resource_lookup_routes()["/recognize-pdf"]

    assert len(route.dependant.body_params) == 1
    upload = route.dependant.body_params[0]
    assert upload.name == "file"
    assert isinstance(upload.field_info, FileParameter)
    assert upload.field_info.media_type == "multipart/form-data"


def test_resource_lookup_models_preserve_historical_json_shapes() -> None:
    from backend.domains.vault.citations import lookup_routes

    suggested = {
        "Title": "A typed resource",
        "Authors": [{"family": "Garcia", "given": "Ismael"}],
        "Zotero Extras": {"provider_field": ["one", {"nested": 2}]},
    }
    lookup_payload = {
        "source": "crossref",
        "identifier": "10.1000/typed",
        "suggested": suggested,
        "error": None,
    }
    assert (
        lookup_routes.MetadataLookupResponse.model_validate(lookup_payload).model_dump()
        == lookup_payload
    )

    translation_error = {
        "source": "web",
        "identifier": "https://example.test/resource",
        "suggested": {},
        "error": "Could not extract any reference from the URL",
    }
    translated = lookup_routes.UrlTranslationResponse.model_validate(translation_error)
    assert translated.model_dump(exclude_unset=True) == translation_error

    translation_success = {
        **translation_error,
        "suggested": suggested,
        "count": 2,
        "error": None,
    }
    translated = lookup_routes.UrlTranslationResponse.model_validate(translation_success)
    assert translated.model_dump(exclude_unset=True) == translation_success

    pdf_payload = {
        "identifiers": {"doi": "10.1000/typed"},
        "source": "pdf",
        "suggested": suggested,
        "error": None,
    }
    assert (
        lookup_routes.PdfRecognitionResponse.model_validate(pdf_payload).model_dump()
        == pdf_payload
    )

    promotion_payload = {
        "column_created": True,
        "column_id": "column-1",
        "column_name": "Patent No.",
        "migrated": 1,
        "migrated_ids": ["page-1"],
        "migrated_with_etags": [{"page_id": "page-1", "etag": {"revision": 4}}],
        "skipped": ["page-2"],
        "conflicts": [
            {
                "page_id": "page-3",
                "expected_etag": {"revision": 2},
                "current_etag": {"revision": 3},
            }
        ],
        "errors": [{"page_id": "page-4", "error": {"code": "not_found"}}],
    }
    assert (
        lookup_routes.ZoteroExtraPromotionResponse.model_validate(
            promotion_payload
        ).model_dump()
        == promotion_payload
    )


def test_lookup_handler_keeps_mapping_semantics_for_internal_consumers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.domains.vault.citations import lookup_routes, metadata_lookup

    payload: metadata_lookup.LookupResponse = {
        "source": "crossref",
        "identifier": "10.1000/typed",
        "suggested": {"Title": "A typed resource"},
        "error": None,
    }

    async def fake_resolve_metadata(*_args: object) -> metadata_lookup.LookupResponse:
        return payload

    monkeypatch.setattr(
        metadata_lookup,
        "resolve_metadata",
        fake_resolve_metadata,
    )

    result = asyncio.run(lookup_routes.lookup_metadata({"doi": "10.1000/typed"}))

    assert isinstance(result, dict)
    assert result.get("source") == "crossref"
    assert result["suggested"] == {"Title": "A typed resource"}
