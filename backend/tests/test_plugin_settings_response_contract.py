"""Typed response contracts used by the frontend plugin Settings clients."""

from __future__ import annotations

from typing import Any

from fastapi.routing import APIRoute


def _route(handler_name: str) -> APIRoute:
    from backend.api import vault_routes

    return next(
        route
        for route in vault_routes.router.routes
        if isinstance(route, APIRoute) and route.endpoint.__name__ == handler_name
    )


def test_llm_wiki_settings_routes_publish_exact_response_models() -> None:
    from backend.domains.vault.knowledge import config_routes, jobs_routes

    expected = {
        "get_llm_wiki_config": config_routes.LlmWikiSettingsResponse,
        "put_llm_wiki_config": config_routes.LlmWikiSettingsResponse,
        "create_standard_llm_wiki_brain": (
            config_routes.LlmWikiCreatedSettingsResponse
        ),
        "llm_wiki_maintenance": jobs_routes.LlmWikiMaintenanceResponse,
    }
    for handler_name, response_model in expected.items():
        route = _route(handler_name)
        assert route.response_model is response_model
        assert route.response_model_exclude_unset is True


def test_llm_wiki_settings_response_preserves_dynamic_payload() -> None:
    from backend.domains.vault.knowledge.config_routes import LlmWikiSettingsResponse

    payload: dict[str, Any] = {
        "config": {
            "brain_table_id": "brain",
            "source_tables": [{"table_id": "resources", "custom": "kept"}],
            "future_setting": {"enabled": True},
        },
        "brain": {"table_id": "brain", "name": "Brain", "configured": True},
        "eligible_index_properties": [{"id": "topic", "type": "select"}],
        "index_options": {"topic": [{"label": "AI", "value": "AI"}]},
        "capabilities": {
            "modules": {"yt_dlp": True},
            "binaries": {"ffmpeg": True},
            "supported_extensions": [".pdf"],
            "streaming": True,
            "ocr": False,
            "ocr_languages": [],
            "ocr_missing_languages": ["cat"],
            "transcription": False,
            "future_capability": "kept",
        },
        "validation": {"valid": True, "missing": []},
        "processed_resources": ["resource-1"],
        "resource_statuses": {"resource-1": "ready"},
        "enabled": True,
    }

    serialized = LlmWikiSettingsResponse.model_validate(payload).model_dump(
        mode="json",
        exclude_unset=True,
    )

    assert serialized == payload


def test_plugin_inventory_response_preserves_manifest_extensions() -> None:
    from backend.domains.configuration.api.plugin_models import (
        ConfigurationInstalledPluginsResponse,
    )

    payload = {
        "plugins": [
            {
                "manifest": {
                    "id": "example",
                    "name": "Example",
                    "version": "1.0.0",
                    "permissions": ["settings"],
                    "future_manifest_key": "kept",
                },
                "enabled": True,
                "granted": ["settings"],
                "provenance": {"signedBy": "publisher"},
            }
        ]
    }

    serialized = ConfigurationInstalledPluginsResponse.model_validate(payload).model_dump(
        mode="json",
        exclude_unset=True,
    )

    assert serialized == payload
