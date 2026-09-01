"""Typed HTTP contract for grounded notebooks and their evidence."""

from __future__ import annotations

from fastapi import FastAPI

from backend.api import notebook_routes
from backend.domains.notebooks.schemas import (
    NotebookConversationResponse,
    NotebookCreateRequest,
    NotebookDetailResponse,
    NotebookPatchRequest,
    NotebookRefreshRequest,
    NotebookRefreshResponse,
    NotebookSearchResponse,
    NotebookSourcesPageResponse,
    NotebookSourcesRequest,
    ReferenceResourcePageResponse,
)


def _focused_openapi() -> dict[str, object]:
    app = FastAPI()
    app.include_router(notebook_routes.router)
    return app.openapi()


def test_notebook_openapi_exposes_concrete_json_responses() -> None:
    paths = _focused_openapi()["paths"]

    assert paths["/api/notebooks"]["get"]["responses"]["200"]["content"]["application/json"][
        "schema"
    ] == {"$ref": "#/components/schemas/NotebookPageResponse"}
    assert paths["/api/notebooks"]["post"]["responses"]["201"]["content"]["application/json"][
        "schema"
    ] == {"$ref": "#/components/schemas/NotebookDetailResponse"}
    assert paths["/api/notebooks/resources"]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"] == {"$ref": "#/components/schemas/ReferenceResourcePageResponse"}
    assert paths["/api/notebooks/{notebook_id}/sources"]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"] == {"$ref": "#/components/schemas/NotebookSourcesPageResponse"}
    assert paths["/api/notebooks/{notebook_id}/refresh"]["post"]["responses"]["202"]["content"][
        "application/json"
    ]["schema"] == {"$ref": "#/components/schemas/NotebookRefreshResponse"}
    assert paths["/api/notebooks/{notebook_id}/search"]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"] == {"$ref": "#/components/schemas/NotebookSearchResponse"}
    assert paths["/api/notebooks/{notebook_id}/conversation"]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"] == {"$ref": "#/components/schemas/NotebookConversationResponse"}


def test_notebook_models_preserve_complete_detail_and_source_payloads() -> None:
    detail_payload = {
        "id": "notebook-1",
        "vault_scope": "vault-1",
        "workspace_id": "workspace-1",
        "owner_user_id": "user-1",
        "source_table_id": "references",
        "title": "Grounded research",
        "visibility": "workspace",
        "conversation_mode": "shared",
        "active_revision": 4,
        "status": "available",
        "last_error": None,
        "created_at": "2026-08-29T10:00:00+00:00",
        "updated_at": "2026-08-29T10:05:00+00:00",
        "groups_json": '[{"id":"group-1","name":"Core","resource_ids":["res-1"]}]',
        "groups": [{"id": "group-1", "name": "Core", "resource_ids": ["res-1"]}],
        "resource_count": 1,
        "source_counts": {"total": 2, "available": 1, "stale": 1, "error": 0},
        "progress": {
            "revision": 4,
            "state": "complete",
            "processed": 1,
            "total": 1,
            "percent": 100,
            "job_id": "job-4",
            "error": None,
            "current_resource_id": None,
            "current_resource_title": None,
            "cancel_requested_at": None,
            "cancellable": False,
        },
        "chat_ready": True,
        "can_manage": True,
        "can_chat": True,
        "conversation_principal": "user-1",
        "conversation_session_id": "notebook:notebook-1",
    }
    sources_payload = {
        "items": [
            {
                "resource_id": "res-1",
                "title": "Reference one",
                "state": "available",
                "error": None,
                "updated_at": "2026-08-29T10:05:00+00:00",
                "last_checked_at": "2026-08-29T10:04:00+00:00",
                "url_checked_at": None,
                "sources": [
                    {
                        "source_id": "source-1",
                        "resource_id": "res-1",
                        "kind": "attachment",
                        "label": "Paper.pdf",
                        "source_url": None,
                        "fingerprint": "sha256:abc",
                        "snapshot_id": "snapshot-1",
                        "status": "available",
                        "error": None,
                    }
                ],
            }
        ],
        "page": 1,
        "page_size": 50,
        "total": 1,
        "active_revision": 4,
    }

    detail = NotebookDetailResponse.model_validate(detail_payload)
    sources = NotebookSourcesPageResponse.model_validate(sources_payload)

    assert detail.model_dump(exclude_unset=True) == detail_payload
    assert sources.model_dump(exclude_unset=True) == sources_payload


def test_notebook_models_preserve_complete_retrieval_and_catalog_payloads() -> None:
    citation = {
        "href": "gnosi-cite:?res=res-1&notebook=notebook-1&revision=4&chunk=chunk-1",
        "label": "p. 7",
        "resource_id": "res-1",
        "revision": 4,
        "source_id": "source-1",
        "chunk_id": "chunk-1",
    }
    search_payload = {
        "notebook_id": "notebook-1",
        "revision": 4,
        "query": "grounded answer",
        "results": [
            {
                "chunk_id": "chunk-1",
                "source_id": "source-1",
                "resource_id": "res-1",
                "source_label": "Paper.pdf",
                "source_kind": "attachment",
                "source_status": "available",
                "text": "Grounded evidence.",
                "locator": {"page": 7},
                "citation": citation,
                "score": 0.875,
            }
        ],
    }
    catalog_payload = {
        "items": [
            {
                "id": "res-1",
                "title": "Reference one",
                "last_modified": "2026-08-29T10:00:00+00:00",
                "source_count": 2,
                "resource_type": "Article",
                "authors": ["Ada Lovelace"],
                "tags": ["Computing"],
            }
        ],
        "page": 1,
        "page_size": 50,
        "total": 1,
        "table_id": "references",
        "source_fields": 2,
        "hidden_without_sources": 3,
        "facets": {
            "types": [{"value": "Article", "count": 1}],
            "authors": [{"value": "Ada Lovelace", "count": 1}],
            "tags": [{"value": "Computing", "count": 1}],
        },
    }

    search = NotebookSearchResponse.model_validate(search_payload)
    catalog = ReferenceResourcePageResponse.model_validate(catalog_payload)

    assert search.model_dump(exclude_unset=True) == search_payload
    assert catalog.model_dump(exclude_unset=True) == catalog_payload


def test_notebook_variant_responses_preserve_legacy_short_payloads() -> None:
    current_refresh = NotebookRefreshResponse.model_validate({"state": "current", "revision": None})
    queued_refresh = NotebookRefreshResponse.model_validate(
        {"job_id": "job-5", "revision": 5, "state": "queued"}
    )
    legacy_catalog = ReferenceResourcePageResponse.model_validate(
        {"items": [], "page": 1, "page_size": 50, "total": 0}
    )
    no_revision_search = NotebookSearchResponse.model_validate(
        {"notebook_id": "notebook-1", "revision": None, "results": []}
    )
    empty_conversation = NotebookConversationResponse.model_validate(
        {"messages": [], "session_id": "notebook:notebook-1"}
    )

    assert current_refresh.model_dump(exclude_unset=True) == {
        "state": "current",
        "revision": None,
    }
    assert queued_refresh.model_dump(exclude_unset=True) == {
        "job_id": "job-5",
        "revision": 5,
        "state": "queued",
    }
    assert legacy_catalog.model_dump(exclude_unset=True) == {
        "items": [],
        "page": 1,
        "page_size": 50,
        "total": 0,
    }
    assert no_revision_search.model_dump(exclude_unset=True) == {
        "notebook_id": "notebook-1",
        "revision": None,
        "results": [],
    }
    assert empty_conversation.model_dump(exclude_unset=True) == {
        "messages": [],
        "session_id": "notebook:notebook-1",
    }

    variable_paths = {
        "/api/notebooks",
        "/api/notebooks/resources",
        "/api/notebooks/{notebook_id}",
        "/api/notebooks/{notebook_id}/sources",
        "/api/notebooks/{notebook_id}/chat-sources",
        "/api/notebooks/{notebook_id}/sources/{resource_id}",
        "/api/notebooks/{notebook_id}/sources/{resource_id}/refresh",
        "/api/notebooks/{notebook_id}/refresh",
        "/api/notebooks/{notebook_id}/refresh/cancel",
        "/api/notebooks/{notebook_id}/search",
        "/api/notebooks/{notebook_id}/evidence/{chunk_id}",
        "/api/notebooks/{notebook_id}/conversation",
    }
    for route in notebook_routes.router.routes:
        if route.path in variable_paths and route.response_model is not None:
            assert route.response_model_exclude_unset is True


def test_notebook_request_models_remain_reexported_by_the_route_module() -> None:
    assert notebook_routes.NotebookCreateRequest is NotebookCreateRequest
    assert notebook_routes.NotebookPatchRequest is NotebookPatchRequest
    assert notebook_routes.NotebookSourcesRequest is NotebookSourcesRequest
    assert notebook_routes.NotebookRefreshRequest is NotebookRefreshRequest
