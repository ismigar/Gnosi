"""Response-model coverage for the PR7C literature frontend boundary."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import get_type_hints

import pytest
from fastapi import Response
from fastapi.openapi.utils import get_openapi
from fastapi.routing import APIRoute
from pydantic import BaseModel

from backend.api import literature_routes
from backend.domains.literature import schemas
from backend.domains.vault.citations.references_api import ReferenceTableResponse
from backend.services import (
    literature_import_service,
    literature_review_service,
    literature_service,
)
from backend.services.workspace_service import WorkspaceContext


EXPECTED_MODELS: dict[tuple[str, str], type[BaseModel]] = {
    ("/api/vault/literature/configuration", "GET"): schemas.LiteratureConfigurationResponse,
    ("/api/vault/literature/configuration", "PUT"): schemas.LiteratureConfigurationResponse,
    ("/api/vault/literature/catalog", "GET"): schemas.LiteratureCatalogResponse,
    ("/api/vault/literature/repositories", "POST"): schemas.LiteratureRepositoryResponse,
    (
        "/api/vault/literature/repositories/{repository_id}",
        "PUT",
    ): schemas.LiteratureRepositoryResponse,
    (
        "/api/vault/literature/repositories/{repository_id}",
        "DELETE",
    ): schemas.LiteratureRepositoryDeletionResponse,
    ("/api/vault/literature/repositories/test", "POST"): schemas.LiteratureRepositoryTestResponse,
    ("/api/vault/literature/synchronizations/{source_id}", "POST"): schemas.LiteratureSyncResponse,
    ("/api/vault/literature/synchronizations/{source_id}", "GET"): schemas.LiteratureSyncResponse,
    (
        "/api/vault/literature/synchronizations/{source_id}",
        "DELETE",
    ): schemas.LiteratureSyncResponse,
    (
        "/api/vault/literature/synchronizations/{source_id}/resume",
        "POST",
    ): schemas.LiteratureSyncResponse,
    ("/api/vault/literature/searches", "GET"): schemas.LiteratureSearchesResponse,
    ("/api/vault/literature/searches", "POST"): schemas.LiteratureSearchResponse,
    ("/api/vault/literature/searches/{search_id}", "GET"): schemas.LiteratureSearchResponse,
    ("/api/vault/literature/searches/{search_id}", "DELETE"): schemas.LiteratureSearchResponse,
    (
        "/api/vault/literature/searches/{search_id}/results/{result_id}",
        "GET",
    ): schemas.LiteratureWorkResponse,
    ("/api/vault/literature/imports", "POST"): schemas.LiteratureImportResponse,
    ("/api/vault/literature/reviews/tables", "POST"): schemas.LiteratureReviewTablesResponse,
    ("/api/vault/literature/reviews", "GET"): schemas.LiteratureReviewsResponse,
    ("/api/vault/literature/reviews", "POST"): schemas.LiteratureReviewResponse,
    ("/api/vault/literature/reviews/{review_id}", "GET"): schemas.LiteratureReviewDetailResponse,
    (
        "/api/vault/literature/reviews/{review_id}/activities",
        "POST",
    ): schemas.LiteratureActivityResponse,
    ("/api/vault/literature/reviews/{review_id}/schedule", "PUT"): schemas.LiteratureReviewResponse,
    (
        "/api/vault/literature/reviews/{review_id}/candidates",
        "POST",
    ): schemas.LiteratureCandidateMutationResponse,
    (
        "/api/vault/literature/reviews/{review_id}/candidates",
        "GET",
    ): schemas.LiteratureCandidatesResponse,
    (
        "/api/vault/literature/reviews/{review_id}/candidates/{candidate_id}/decisions",
        "POST",
    ): schemas.LiteratureDecisionMutationResponse,
    (
        "/api/vault/literature/reviews/{review_id}/candidates/{candidate_id}/consensus",
        "POST",
    ): schemas.LiteratureDecisionMutationResponse,
    (
        "/api/vault/literature/reviews/{review_id}/candidates/{candidate_id}/full-text",
        "PUT",
    ): schemas.LiteratureCandidateResponse,
    (
        "/api/vault/literature/reviews/{review_id}/snowball",
        "POST",
    ): schemas.LiteratureSnowballResponse,
    ("/api/vault/literature/manual-capture", "POST"): schemas.LiteratureManualCaptureResponse,
    ("/api/vault/literature/ai", "POST"): schemas.LiteratureAiResponse,
}

NON_JSON_ROUTES = {
    ("/api/vault/literature/searches/{search_id}/events", "GET"),
    ("/api/vault/literature/reviews/{review_id}/exports/{export_format}", "GET"),
}


def _routes() -> dict[tuple[str, str], APIRoute]:
    return {
        (route.path, method): route
        for route in literature_routes.router.routes
        if isinstance(route, APIRoute)
        for method in route.methods or set()
    }


def test_every_literature_json_route_exposes_a_typed_response() -> None:
    routes = _routes()

    assert set(routes) == set(EXPECTED_MODELS) | NON_JSON_ROUTES
    for key, expected_model in EXPECTED_MODELS.items():
        route = routes[key]
        assert route.response_model is expected_model
        assert route.response_model_exclude_unset is True
        assert get_type_hints(route.endpoint)["return"] is expected_model


def test_literature_export_remains_an_explicit_binary_boundary() -> None:
    route = _routes()[("/api/vault/literature/reviews/{review_id}/exports/{export_format}", "GET")]

    assert route.response_model is None
    assert route.response_class is Response


def test_literature_sse_remains_an_explicit_streaming_boundary() -> None:
    route = _routes()[("/api/vault/literature/searches/{search_id}/events", "GET")]

    assert route.response_model is None


def test_extensible_responses_preserve_provider_fields_without_adding_defaults() -> None:
    source = {
        "id": "repository",
        "name": "Repository",
        "kind": "oai",
        "provider_extension": {"coverage": "institutional"},
    }
    serialized_source = schemas.LiteratureSourceResponse.model_validate(source).model_dump(
        exclude_unset=True
    )
    assert serialized_source == source

    designation = {
        "table_id": "resources",
        "configured": True,
        "columns_added": 3,
    }
    serialized_designation = ReferenceTableResponse.model_validate(designation).model_dump(
        exclude_unset=True
    )
    assert serialized_designation == designation


def test_literature_responses_preserve_partial_and_legacy_payloads() -> None:
    partial_work = {
        "id": "work-1",
        "title": "A partial legacy work",
        "provider_extension": {"ranking": 3, "verified": True},
    }
    assert (
        schemas.LiteratureWorkResponse.model_validate(partial_work).model_dump(
            exclude_unset=True,
            mode="json",
        )
        == partial_work
    )

    legacy_activity = {
        "id": "activity-1",
        "Review ID": "review-1",
        "Activity Type": "search_strategy",
        "Version": 2,
        "AI Audit": {"provider": "local", "cost": 0},
    }
    assert (
        schemas.LiteratureActivityResponse.model_validate(legacy_activity).model_dump(
            exclude_unset=True, mode="json"
        )
        == legacy_activity
    )

    managed_tables = {
        "Literature Reviews": "gnosi_literature_reviews",
        "Literature Candidates": "gnosi_literature_candidates",
    }
    assert (
        schemas.LiteratureReviewTablesResponse.model_validate(managed_tables).model_dump(
            mode="json"
        )
        == managed_tables
    )


def test_newly_typed_handlers_preserve_exact_payloads(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    context = WorkspaceContext("workspace", "reader", "viewer", tmp_path, ["read"])
    source = {
        "id": "custom-source",
        "name": "Custom Source",
        "kind": "plugin",
        "provider_extension": {"coverage": "local"},
    }
    monkeypatch.setattr(
        literature_service,
        "catalog",
        lambda _vault_path: [source],
    )
    assert literature_routes.get_catalog(context).model_dump(
        exclude_unset=True,
        mode="json",
    ) == {"sources": [source]}

    sync = {"source_id": "custom-source", "state": "never", "legacy_cursor": None}
    monkeypatch.setattr(
        literature_service,
        "sync_status",
        lambda _vault_path, _source_id: sync,
    )
    assert (
        literature_routes.get_synchronization("custom-source", context).model_dump(
            exclude_unset=True, mode="json"
        )
        == sync
    )

    work = {"id": "work-1", "title": "Legacy result", "provider_rank": 4}
    monkeypatch.setattr(
        literature_service,
        "get_search_result",
        lambda _vault_path, _search_id, _result_id: work,
    )
    monkeypatch.setattr(
        literature_import_service,
        "mark_resource_membership",
        lambda works, _context: list(works),
    )
    assert (
        literature_routes.get_result("search-1", "work-1", context).model_dump(
            exclude_unset=True,
            mode="json",
        )
        == work
    )

    tables = {"Literature Reviews": "gnosi_literature_reviews"}

    async def fake_ensure_tables() -> dict[str, str]:
        return tables

    monkeypatch.setattr(
        literature_review_service,
        "ensure_tables",
        fake_ensure_tables,
    )
    assert (
        asyncio.run(literature_routes.ensure_review_tables(context)).model_dump(mode="json")
        == tables
    )

    monkeypatch.setattr(
        literature_review_service,
        "list_candidates",
        lambda _review_id, _context, _phase: [],
    )
    assert literature_routes.list_candidates("review-1", "", context).model_dump(
        exclude_unset=True,
        mode="json",
    ) == {"candidates": []}


def test_literature_openapi_references_every_json_response_model() -> None:
    openapi = get_openapi(
        title="Focused literature contract",
        version="1",
        routes=literature_routes.router.routes,
    )
    routes = _routes()

    for key, expected_model in EXPECTED_MODELS.items():
        path, method = key
        route = routes[key]
        status = str(route.status_code or 200)
        response_schema = openapi["paths"][path][method.lower()]["responses"][status]["content"][
            "application/json"
        ]["schema"]
        assert response_schema["$ref"] == (f"#/components/schemas/{expected_model.__name__}")
