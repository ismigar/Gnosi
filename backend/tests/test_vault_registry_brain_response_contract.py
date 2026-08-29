"""Typed contracts for Vault registry and Brain-table configuration."""

from __future__ import annotations

from fastapi.routing import APIRoute


def _route(endpoint_name: str) -> APIRoute:
    from backend.api import vault_routes

    return next(
        route
        for route in vault_routes.router.routes
        if isinstance(route, APIRoute) and route.endpoint.__name__ == endpoint_name
    )


def test_registry_routes_publish_typed_models() -> None:
    from backend.domains.vault.registry import contracts, runtime  # noqa: F401

    assert _route("get_registry").response_model is contracts.VaultRegistryResponse
    assert _route("update_registry").response_model is contracts.RegistryMutationResponse


def test_registry_contract_preserves_extension_keys() -> None:
    from backend.domains.vault.registry.contracts import VaultRegistryResponse

    payload = {
        "databases": [{"id": "db-1", "name": "Knowledge"}],
        "tables": [{"id": "table-1", "name": "Notes"}],
        "views": [{"id": "view-1", "table_id": "table-1"}],
        "plugin_state": {"enabled": True},
    }

    assert VaultRegistryResponse.model_validate(payload).model_dump() == payload


def test_brain_table_routes_publish_typed_models() -> None:
    from backend.domains.vault.knowledge import config_routes  # noqa: F401
    from backend.domains.vault.knowledge import contracts

    assert _route("get_brain_table").response_model is contracts.BrainTableStatusResponse
    assert _route("set_brain_table").response_model is contracts.BrainTableSelectionResponse
    assert _route("create_brain_table").response_model is contracts.BrainTableCreateResponse
    assert _route("clear_brain_table").response_model is contracts.BrainTableClearResponse
    assert _route("get_llm_wiki_config").response_model is contracts.LlmWikiConfigResponse
    assert _route("put_llm_wiki_config").response_model is contracts.LlmWikiConfigResponse


def test_brain_table_status_contract_preserves_dashboard_shape() -> None:
    from backend.domains.vault.knowledge.contracts import BrainTableStatusResponse

    payload = {
        "table_id": "brain-1",
        "configured": True,
        "name": "Brain",
        "source_table_ids": ["references"],
        "index_field_ids": ["areas", "tags"],
    }

    assert BrainTableStatusResponse.model_validate(payload).model_dump() == payload


def test_llm_wiki_config_contract_preserves_runtime_maps() -> None:
    from backend.domains.vault.knowledge.contracts import LlmWikiConfigResponse

    payload = {
        "config": {"brain_table_id": "brain-1", "source_tables": []},
        "brain": {"table_id": "brain-1", "name": "Brain", "configured": True},
        "eligible_index_properties": [],
        "index_options": {},
        "capabilities": {"pdf": True},
        "validation": {"valid": True, "missing": []},
        "processed_resources": {"sources": {"page-1": "2026-08-29"}},
        "resource_statuses": {"sources": {"page-1": {"phase": "done"}}},
        "enabled": True,
    }

    assert LlmWikiConfigResponse.model_validate(payload).model_dump() == payload
