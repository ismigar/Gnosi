"""Explicit request contracts for vault schema and designation commands."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel
import pytest

from backend.domains.vault.citations import lookup_routes, references_api
from backend.domains.vault.pages import metadata_mutations
from backend.domains.vault.schemas.pages import BulkMetadataUpdateRequest
from backend.domains.vault.tables import options, routes
from backend.domains.vault.tables.contracts import (
    FolderSchemaRequest,
    OptionCatalogUpsertRequest,
)
from backend.domains.vault.views import schema as folder_schema


def _contains_ref(schema: object, model: type[BaseModel]) -> bool:
    if isinstance(schema, dict):
        if schema.get("$ref") == f"#/components/schemas/{model.__name__}":
            return True
        return any(_contains_ref(value, model) for value in schema.values())
    if isinstance(schema, list):
        return any(_contains_ref(value, model) for value in schema)
    return False


def test_target_routes_reference_named_request_models() -> None:
    app = FastAPI()
    app.include_router(lookup_routes.router, prefix="/api/vault")
    schema = app.openapi()
    expected: dict[tuple[str, str], type[BaseModel]] = {
        ("/api/vault/bulk-update-metadata", "post"): BulkMetadataUpdateRequest,
        ("/api/vault/option-catalogs/{name}", "put"): OptionCatalogUpsertRequest,
        (
            "/api/vault/reference-table",
            "post",
        ): references_api.ReferenceTableSelectionRequest,
        (
            "/api/vault/reference-table/create",
            "post",
        ): references_api.ReferenceTableCreateRequest,
        ("/api/vault/schema", "post"): FolderSchemaRequest,
    }

    for (path, method), model in expected.items():
        body = schema["paths"][path][method]["requestBody"]["content"]["application/json"]["schema"]
        assert _contains_ref(body, model), (path, body)


def test_command_models_preserve_2x_field_and_extension_policy() -> None:
    bulk = BulkMetadataUpdateRequest.model_validate(
        {
            "page_ids": [1, "page"],
            "updates": {"Count": 0},
            "remove": "malformed",
            "expected_etags": None,
            "ignored": {"future": True},
        }
    )
    catalog = OptionCatalogUpsertRequest.model_validate({"options": "malformed", "ignored": [1]})
    document = {"fields": [{"name": "Title"}], "plugin": {"revision": 2}}

    assert bulk.payload() == {
        "page_ids": [1, "page"],
        "updates": {"Count": 0},
        "remove": "malformed",
        "expected_etags": None,
    }
    assert catalog.registry_data() == {"options": "malformed"}
    assert FolderSchemaRequest.model_validate(document).root == document
    assert BulkMetadataUpdateRequest.model_validate({}).payload() == {}
    assert BulkMetadataUpdateRequest.model_validate({"updates": None}).payload() == {
        "updates": None
    }


def test_reference_models_keep_loose_values_and_ignore_unknown_keys() -> None:
    selection = references_api.ReferenceTableSelectionRequest.model_validate(
        {"table_id": ["legacy"], "ignored": True}
    )
    creation = references_api.ReferenceTableCreateRequest.model_validate(
        {"name": 17, "ignored": True}
    )

    assert selection.model_dump(exclude_unset=True) == {"table_id": ["legacy"]}
    assert creation.model_dump(exclude_unset=True) == {"name": 17}


def test_bulk_and_table_handlers_forward_historical_dictionaries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    received: list[tuple[str, object]] = []

    async def bulk(payload: dict[str, object], dependency: object) -> dict[str, object]:
        received.append(("bulk", payload))
        return {"updated": 0}

    async def catalog(
        name: str, payload: dict[object, object], dependency: object
    ) -> dict[str, object]:
        received.append((name, payload))
        return {"status": "ok"}

    async def save(
        folder: str, payload: dict[object, object], dependency: object
    ) -> dict[str, object]:
        received.append((folder, payload))
        return {"status": "success"}

    monkeypatch.setattr(metadata_mutations, "bulk_update_metadata", bulk)
    monkeypatch.setattr(lookup_routes, "_metadata_mutation_dependencies", object)
    monkeypatch.setattr(options, "put_option_catalog", catalog)
    monkeypatch.setattr(folder_schema, "save_schema", save)
    monkeypatch.setattr(
        routes,
        "_configured",
        lambda: SimpleNamespace(options=object(), folder_schema=object()),
    )

    asyncio.run(
        lookup_routes.bulk_update_metadata(
            BulkMetadataUpdateRequest.model_validate(
                {"page_ids": [1], "updates": {"Title": "A"}, "ignored": True}
            )
        )
    )
    asyncio.run(
        routes.put_option_catalog(
            "shared",
            OptionCatalogUpsertRequest.model_validate({"options": ["A"], "ignored": True}),
        )
    )
    asyncio.run(
        routes.save_schema(
            "Folder",
            FolderSchemaRequest.model_validate({"fields": [], "extension": 1}),
        )
    )

    assert received == [
        ("bulk", {"page_ids": [1], "updates": {"Title": "A"}}),
        ("shared", {"options": ["A"]}),
        ("Folder", {"fields": [], "extension": 1}),
    ]


def test_reference_handlers_preserve_defaults_and_2x_string_coercion() -> None:
    selected: list[str | None] = []
    created_payloads: list[dict[str, object]] = []

    async def create_table(payload: dict[str, object]) -> dict[str, object]:
        created_payloads.append(payload)
        return {"id": "created-id", "name": payload["name"]}

    table: dict[str, object] = {"name": "Legacy"}
    dependencies = references_api.ReferenceApiDependencies(
        resolve_get_table_id=lambda: lambda: None,
        resolve_primary_table=lambda: lambda _table_id: table,
        resolve_table=lambda: lambda table_id: table if table_id == "['legacy']" else None,
        resolve_ensure_schema=lambda: lambda _table_id: 0,
        resolve_set_table_id=lambda: selected.append,
        resolve_invalidate_index=lambda: lambda: None,
        resolve_create_table=lambda: create_table,
    )
    router = APIRouter()
    references_api.register_routes(
        router,
        post_dependencies=(),
        create_dependencies=(),
        delete_dependencies=(),
        dependencies=dependencies,
    )
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    selected_response = client.post(
        "/reference-table",
        json={"table_id": ["legacy"], "ignored": True},
    )
    default_response = client.post("/reference-table/create")
    numeric_response = client.post("/reference-table/create", json={"name": 17})

    assert selected_response.status_code == 200
    assert selected_response.json()["table_id"] == "['legacy']"
    assert selected == ["['legacy']", "created-id", "created-id"]
    assert default_response.status_code == 200
    assert default_response.json()["name"] == "Referències"
    assert numeric_response.status_code == 200
    assert numeric_response.json()["name"] == "17"
    assert [payload["name"] for payload in created_payloads] == ["Referències", "17"]
