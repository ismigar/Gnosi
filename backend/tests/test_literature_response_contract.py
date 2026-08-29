"""Response-model coverage for the PR7C literature frontend boundary."""

from __future__ import annotations

from fastapi import Response
from fastapi.routing import APIRoute

from backend.api import literature_routes
from backend.domains.literature import schemas
from backend.domains.vault.citations.references_api import ReferenceTableResponse


EXPECTED_MODELS: dict[tuple[str, str], object] = {
    ("/api/vault/literature/configuration", "GET"):
        schemas.LiteratureConfigurationResponse,
    ("/api/vault/literature/configuration", "PUT"):
        schemas.LiteratureConfigurationResponse,
    ("/api/vault/literature/repositories", "POST"):
        schemas.LiteratureRepositoryResponse,
    ("/api/vault/literature/repositories/{repository_id}", "PUT"):
        schemas.LiteratureRepositoryResponse,
    ("/api/vault/literature/repositories/{repository_id}", "DELETE"):
        schemas.LiteratureRepositoryDeletionResponse,
    ("/api/vault/literature/repositories/test", "POST"):
        schemas.LiteratureRepositoryTestResponse,
    ("/api/vault/literature/synchronizations/{source_id}", "POST"):
        schemas.LiteratureSyncResponse,
    ("/api/vault/literature/synchronizations/{source_id}", "DELETE"):
        schemas.LiteratureSyncResponse,
    ("/api/vault/literature/synchronizations/{source_id}/resume", "POST"):
        schemas.LiteratureSyncResponse,
    ("/api/vault/literature/searches", "GET"):
        schemas.LiteratureSearchesResponse,
    ("/api/vault/literature/searches", "POST"):
        schemas.LiteratureSearchResponse,
    ("/api/vault/literature/searches/{search_id}", "GET"):
        schemas.LiteratureSearchResponse,
    ("/api/vault/literature/searches/{search_id}", "DELETE"):
        schemas.LiteratureSearchResponse,
    ("/api/vault/literature/imports", "POST"):
        schemas.LiteratureImportResponse,
    ("/api/vault/literature/reviews", "GET"):
        schemas.LiteratureReviewsResponse,
    ("/api/vault/literature/reviews", "POST"):
        schemas.LiteratureReviewResponse,
    ("/api/vault/literature/reviews/{review_id}", "GET"):
        schemas.LiteratureReviewDetailResponse,
    ("/api/vault/literature/reviews/{review_id}/activities", "POST"):
        schemas.LiteratureActivityResponse,
    ("/api/vault/literature/reviews/{review_id}/schedule", "PUT"):
        schemas.LiteratureReviewResponse,
    ("/api/vault/literature/reviews/{review_id}/candidates", "POST"):
        schemas.LiteratureCandidateMutationResponse,
    (
        "/api/vault/literature/reviews/{review_id}/candidates/"
        "{candidate_id}/decisions",
        "POST",
    ): schemas.LiteratureDecisionMutationResponse,
    (
        "/api/vault/literature/reviews/{review_id}/candidates/"
        "{candidate_id}/consensus",
        "POST",
    ): schemas.LiteratureDecisionMutationResponse,
    (
        "/api/vault/literature/reviews/{review_id}/candidates/"
        "{candidate_id}/full-text",
        "PUT",
    ): schemas.LiteratureCandidateResponse,
    ("/api/vault/literature/reviews/{review_id}/snowball", "POST"):
        schemas.LiteratureSnowballResponse,
    ("/api/vault/literature/manual-capture", "POST"):
        schemas.LiteratureManualCaptureResponse,
    ("/api/vault/literature/ai", "POST"):
        schemas.LiteratureAiResponse,
}


def _routes() -> dict[tuple[str, str], APIRoute]:
    return {
        (route.path, method): route
        for route in literature_routes.router.routes
        if isinstance(route, APIRoute)
        for method in route.methods
    }


def test_assigned_literature_json_routes_expose_typed_responses() -> None:
    routes = _routes()

    for key, expected_model in EXPECTED_MODELS.items():
        route = routes[key]
        assert route.response_model is expected_model
        assert route.response_model_exclude_unset is True


def test_literature_export_remains_an_explicit_binary_boundary() -> None:
    route = _routes()[
        ("/api/vault/literature/reviews/{review_id}/exports/{export_format}", "GET")
    ]

    assert route.response_model is None
    assert route.response_class is Response


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
