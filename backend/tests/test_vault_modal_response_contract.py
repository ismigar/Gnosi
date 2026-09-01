"""Response-model contracts used by Vault modals and embedded views."""

from __future__ import annotations

from fastapi.routing import APIRoute


def _route(router: object, handler_name: str) -> APIRoute:
    routes = getattr(router, "routes")
    return next(
        route
        for route in routes
        if isinstance(route, APIRoute) and route.endpoint.__name__ == handler_name
    )


def test_agent_skill_catalog_has_a_typed_flattened_response() -> None:
    from backend.domains.configuration.agent import catalog_routes
    from backend.domains.configuration.agent.router import router as catalog_router

    route = _route(catalog_router, "list_skills")
    assert route.path == "/ai/skills"
    assert route.methods == {"GET"}
    assert route.response_model is catalog_routes.AgentSkillCatalogResponse

    payload = {
        "skills": [
            {
                "schema_version": 1,
                "id": "core.example",
                "version": "1.0.0",
                "name": "Example",
                "description": "",
                "origin": {"type": "core", "id": "core"},
                "kind": "agent",
                "activation": "automatic",
                "tool_ids": [],
                "instructions": "",
                "status": "available",
                "metadata": {},
                "available": True,
                "missing_tool_ids": [],
                "effects": ["read"],
                "editable": False,
                "deletable": False,
                "revision": "rev-1",
            }
        ],
        "issues": [{"package": "broken", "error": "invalid manifest"}],
        "catalog_revision": "catalog-1",
    }

    parsed = catalog_routes.AgentSkillCatalogResponse.model_validate(payload)
    assert parsed.model_dump(mode="json") == payload


def test_schema_support_routes_expose_exact_response_models() -> None:
    from backend.domains.vault.api import core_routes
    from backend.domains.vault.translation import routes as translation_routes

    expected = {
        "drupal_content_types": translation_routes.DrupalContentTypesResponse,
        "drupal_content_type_fields": (
            translation_routes.DrupalContentTypeFieldsResponse
        ),
        "match_drupal_rows": translation_routes.MatchDrupalRowsResponse,
        "generate_button_action": translation_routes.GenerateButtonActionResponse,
        "list_virtual_fields": core_routes.VirtualFieldsResponse,
    }
    for handler_name, response_model in expected.items():
        route = _route(core_routes.router, handler_name)
        assert route.response_model is response_model

    virtual_payload = {
        "computers": [
            {
                "compute": "word_count",
                "label": "Word count",
                "description": "Number of words",
                "value_type": "number",
            }
        ]
    }
    assert (
        core_routes.VirtualFieldsResponse.model_validate(virtual_payload).model_dump()
        == virtual_payload
    )


def test_table_option_schema_and_view_routes_use_json_safe_contracts() -> None:
    from backend.domains.vault.tables import routes
    from backend.domains.vault.tables.contracts import RegistryRecord
    from backend.domains.vault.views.contracts import (
        VaultViewResponse,
        ViewMutationResponse,
        ViewUsageResponse,
    )

    expected = {
        "table_option_usage": RegistryRecord,
        "rename_table_option": RegistryRecord,
        "remove_table_option": RegistryRecord,
        "list_option_catalogs": RegistryRecord,
        "put_option_catalog": RegistryRecord,
        "create_view": VaultViewResponse,
        "get_view": VaultViewResponse,
        "get_view_usage": ViewUsageResponse,
        "delete_view": ViewMutationResponse,
        "update_view": ViewMutationResponse,
        "save_schema": RegistryRecord,
    }
    for handler_name, response_model in expected.items():
        route = _route(routes.router, handler_name)
        assert route.response_model is response_model

    assert _route(routes.router, "list_views").response_model == list[VaultViewResponse]


def test_file_insert_routes_preserve_their_json_payloads() -> None:
    from backend.api import vault_routes
    from backend.domains.vault.files import api as files_api
    from backend.domains.vault.files.contracts import (
        LinkedExistingFileResponse,
        LocalFileRegistrationResponse,
        PropertyFileUploadResponse,
    )

    expected = {
        "register_local_file": LocalFileRegistrationResponse,
        "upload_property_file": PropertyFileUploadResponse,
        "link_existing_file": LinkedExistingFileResponse,
    }
    for handler_name, response_model in expected.items():
        route = _route(vault_routes.router, handler_name)
        assert route.endpoint is getattr(files_api, handler_name)
        assert route.response_model is response_model

    linked = {
        "path": "/tmp/paper.pdf",
        "url": None,
        "storage": "absolute",
        "name": "paper.pdf",
        "size": 3,
        "renamed": False,
    }
    assert LinkedExistingFileResponse.model_validate(linked).model_dump() == linked


def test_page_view_and_bulk_template_routes_expose_typed_results() -> None:
    from backend.api import vault_views_routes
    from backend.domains.vault.citations import lookup_routes

    assert (
        _route(vault_views_routes.router, "get_page_views").response_model
        is vault_views_routes.PageViewsResponse
    )
    upsert_route = _route(vault_views_routes.router, "upsert_page_view")
    assert upsert_route.response_model is vault_views_routes.PageViewMutationResponse
    assert upsert_route.response_model_exclude_none is True
    assert (
        _route(lookup_routes.router, "bulk_apply_template").response_model
        is lookup_routes.BulkPageMutationResponse
    )

    payload = {
        "updated": 1,
        "updated_ids": ["page-1"],
        "updated_with_etags": [{"page_id": "page-1", "etag": "etag-1"}],
        "skipped": [],
        "conflicts": [],
        "errors": [],
    }
    assert (
        lookup_routes.BulkPageMutationResponse.model_validate(payload).model_dump()
        == payload
    )
