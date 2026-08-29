"""Typed OpenAPI contract for local and synchronized contacts."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.routing import APIRoute

from backend.api import contacts_routes
from backend.domains.contacts.schemas import (
    ContactResponse,
    ContactSyncResponse,
    ContactSyncStatusResponse,
    ContactWriteRequest,
)


def _focused_openapi() -> dict[str, object]:
    app = FastAPI()
    app.include_router(contacts_routes.router)
    return app.openapi()


def test_contacts_json_routes_all_have_response_models() -> None:
    routes = [route for route in contacts_routes.router.routes if isinstance(route, APIRoute)]

    assert routes
    assert all(route.response_model is not None for route in routes)


def test_contacts_openapi_exposes_typed_bodies_and_responses() -> None:
    paths = _focused_openapi()["paths"]

    assert paths["/contacts"]["get"]["responses"]["200"]["content"]["application/json"]["schema"][
        "items"
    ] == {"$ref": "#/components/schemas/ContactResponse"}
    assert paths["/contacts"]["post"]["requestBody"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/ContactWriteRequest"
    }
    assert paths["/contacts/sync"]["post"]["responses"]["200"]["content"]["application/json"][
        "schema"
    ] == {"$ref": "#/components/schemas/ContactSyncResponse"}
    assert paths["/contacts/sync/status"]["get"]["responses"]["200"]["content"]["application/json"][
        "schema"
    ] == {"$ref": "#/components/schemas/ContactSyncStatusResponse"}


def test_contact_models_preserve_provider_and_legacy_payloads() -> None:
    contact_payload = {
        "id": "contact-1",
        "workspace_id": "personal",
        "type": "personal",
        "name": "Ada Lovelace",
        "email": "ada@example.test",
        "phone": None,
        "company": None,
        "job_title": None,
        "address": None,
        "notes": None,
        "google_resource_name": "people/1",
        "apple_resource_id": None,
        "last_synced_at": "2026-08-29T10:00:00+00:00",
        "source": "ada@example.test",
        "photo_url": None,
        "tags": ["research"],
        "emails": [{"value": "ada@example.test", "type": "work"}],
        "phones": [],
        "addresses": [],
        "created_at": "2026-08-29T09:00:00+00:00",
        "updated_at": "2026-08-29T10:00:00+00:00",
    }
    sync_payload = {
        "status": "ok",
        "result": {
            "gnosi_to_remote": {
                "created": 1,
                "updated": 0,
                "deleted": 0,
                "errors": [],
                "skipped": 2,
            },
            "remote_to_gnosi": {"imported": 1, "updated": 1, "errors": []},
            "vault_export": {"exported": 3, "errors": []},
            "timestamp": "2026-08-29T10:00:00+00:00",
        },
    }

    assert ContactResponse.model_validate(contact_payload).model_dump() == contact_payload
    assert ContactSyncResponse.model_validate(sync_payload).model_dump() == sync_payload
    assert ContactSyncStatusResponse.model_validate(
        {
            "contacts_count": 3,
            "google_synced_count": 2,
            "pending_sync_count": 1,
            "last_sync": "2026-08-29T10:00:00+00:00",
        }
    ).model_dump(exclude_unset=True) == {
        "contacts_count": 3,
        "google_synced_count": 2,
        "pending_sync_count": 1,
        "last_sync": "2026-08-29T10:00:00+00:00",
    }
    assert ContactWriteRequest.model_validate(
        {"name": "Ada", "email": "ada@example.test", "provider_note": "kept"}
    ).model_dump(exclude_unset=True) == {
        "name": "Ada",
        "email": "ada@example.test",
        "provider_note": "kept",
    }
