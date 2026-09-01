"""Typed response contracts for Vault Summary plugin settings and output."""

from __future__ import annotations

from fastapi.routing import APIRoute


def _routes() -> dict[tuple[str, str], APIRoute]:
    from backend.api import vault_routes

    wanted = {
        ("GET", "/plugins/{plugin_id}/settings"),
        ("PUT", "/plugins/{plugin_id}/settings"),
        ("POST", "/plugins/vault-summary/summarize"),
    }
    return {
        (method, route.path): route
        for route in vault_routes.router.routes
        if isinstance(route, APIRoute)
        for method in route.methods
        if (method, route.path) in wanted
    }


def test_vault_summary_routes_publish_typed_models() -> None:
    from backend.domains.configuration.api import plugin_models

    routes = _routes()

    assert (
        routes[("GET", "/plugins/{plugin_id}/settings")].response_model
        is plugin_models.PluginSettingsResponse
    )
    assert (
        routes[("PUT", "/plugins/{plugin_id}/settings")].response_model
        is plugin_models.PluginSettingsResponse
    )
    assert (
        routes[("POST", "/plugins/vault-summary/summarize")].response_model
        is plugin_models.VaultPluginSummaryResponse
    )


def test_vault_summary_models_preserve_historical_shapes() -> None:
    from backend.domains.configuration.api import plugin_models

    settings = {
        "settings": {
            "model": "openai:gpt-5-mini",
            "provider_extension": {"temperature": 0.2},
        }
    }
    summary = {
        "summary": "# Research\n\n- One fact",
        "model": "openai:gpt-5-mini",
    }

    assert plugin_models.PluginSettingsResponse.model_validate(settings).model_dump() == settings
    assert plugin_models.VaultPluginSummaryResponse.model_validate(summary).model_dump() == summary
