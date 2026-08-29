"""Typed contracts for citation lookup and persisted PDF annotations."""

from __future__ import annotations

from types import SimpleNamespace

from fastapi import APIRouter
from fastapi.routing import APIRoute


def test_citation_routes_publish_typed_response_contracts() -> None:
    from backend.domains.vault.citations import search

    router = APIRouter()
    dependencies = search.CitationSearchDependencies(
        page_entry_count=lambda _key: 0,
        page_entries=lambda _key: [],
        resolve_reference_table_id=lambda: None,
        canonicalize_id=str,
        active_vault_path=lambda: "/vault",
        resolve_ensure_index=lambda: lambda _key: {},
    )
    search.register_routes(router, dependencies)
    routes = {
        route.endpoint.__name__: route
        for route in router.routes
        if isinstance(route, APIRoute)
    }

    assert routes["search_citations"].response_model == list[
        search.CitationSearchItemResponse
    ]
    assert (
        routes["resolve_by_citation_key"].response_model
        is search.CitationResolutionResponse
    )
    assert routes["resolve_by_citation_key"].response_model_exclude_unset is True


def test_pdf_annotation_routes_publish_typed_response_contracts() -> None:
    from backend.domains.vault.annotations import pdf_routes

    routes = {
        (route.endpoint.__name__, next(iter(route.methods or set()), "")): route
        for route in pdf_routes.router.routes
        if isinstance(route, APIRoute)
        and route.endpoint.__name__
        in {
            "create_pdf_annotation",
            "delete_pdf_annotation",
            "list_pdf_annotations",
            "update_pdf_annotation",
        }
    }

    assert routes[("list_pdf_annotations", "GET")].response_model == list[
        pdf_routes.PdfAnnotationResponse
    ]
    assert (
        routes[("create_pdf_annotation", "POST")].response_model
        is pdf_routes.PdfAnnotationResponse
    )
    assert (
        routes[("update_pdf_annotation", "PATCH")].response_model
        is pdf_routes.PdfAnnotationResponse
    )
    assert (
        routes[("delete_pdf_annotation", "DELETE")].response_model
        is pdf_routes.PdfAnnotationDeletedResponse
    )


def test_pdf_annotation_serializer_keeps_historical_shape() -> None:
    from backend.domains.vault.annotations.pdf_routes import _pdf_annotation_to_dict

    annotation = SimpleNamespace(
        color="#ffeb3b",
        comment=None,
        created_at=None,
        id=7,
        page=2,
        rects_json='[{"x": 1.5}]',
        source_uri="file:///paper.pdf",
        tags="review",
        text="Quoted text",
        type="highlight",
        updated_at=None,
    )

    assert _pdf_annotation_to_dict(annotation) == {
        "id": 7,
        "source_uri": "file:///paper.pdf",
        "page": 2,
        "type": "highlight",
        "color": "#ffeb3b",
        "rects": [{"x": 1.5}],
        "text": "Quoted text",
        "comment": None,
        "tags": "review",
        "created_at": None,
        "updated_at": None,
    }
