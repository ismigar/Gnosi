"""Named JSON contracts and justified non-JSON response exemptions."""

from __future__ import annotations

from typing import Any, get_type_hints

from fastapi import APIRouter
from fastapi.responses import RedirectResponse, Response
from fastapi.routing import APIRoute


def _routes(router: APIRouter) -> dict[str, APIRoute]:
    return {
        route.endpoint.__name__: route for route in router.routes if isinstance(route, APIRoute)
    }


def test_selected_json_routes_publish_named_response_models() -> None:
    from backend.api import (
        ai_routes,
        microsoft_auth_routes,
        notion_oauth_routes,
        public_routes,
        tools_routes,
        vault_views_routes,
    )
    from backend.domains.configuration.ai import contracts as ai_contracts

    expected = (
        (
            public_routes.router,
            {
                "public_ping": public_routes.PublicPingResponse,
                "public_create_page": public_routes.CreatedPublicPageResponse,
                "public_clip_config": public_routes.ClipConfigResponse,
                "public_clip": public_routes.PublicClipResponse,
            },
        ),
        (
            ai_routes.router,
            {
                "validate_provider": ai_contracts.ProviderValidationResponse,
                "set_provider_credentials": ai_contracts.ProviderCredentialsResponse,
                "delete_provider": ai_contracts.ProviderDeletionResponse,
                "update_provider_status": ai_contracts.ProviderStatusResponse,
            },
        ),
        (
            notion_oauth_routes.router,
            {"disconnect": notion_oauth_routes.NotionOAuthDisconnectResponse},
        ),
        (
            tools_routes.router,
            {
                "approve_tool": tools_routes.ToolMutationResponse,
                "reject_tool": tools_routes.ToolMutationResponse,
            },
        ),
        (
            microsoft_auth_routes.router,
            {"status": microsoft_auth_routes.MicrosoftOAuthStatusResponse},
        ),
        (
            vault_views_routes.router,
            {"delete_page_view": vault_views_routes.PageViewMutationResponse},
        ),
    )

    for router, response_models in expected:
        registered = _routes(router)
        for endpoint_name, response_model in response_models.items():
            route = registered[endpoint_name]
            assert route.response_model is response_model
            assert get_type_hints(route.endpoint)["return"] is not Any

    for endpoint_name in (
        "validate_provider",
        "set_provider_credentials",
        "delete_provider",
        "update_provider_status",
    ):
        assert _routes(ai_routes.router)[endpoint_name].responses == {}

    assert _routes(public_routes.router)["public_clip"].response_model_exclude_unset
    assert _routes(public_routes.router)["public_clip_config"].response_model_exclude_unset
    assert _routes(ai_routes.router)["validate_provider"].response_model_exclude_unset
    assert _routes(tools_routes.router)["approve_tool"].response_model_exclude_unset
    assert _routes(tools_routes.router)["reject_tool"].response_model_exclude_unset
    assert _routes(vault_views_routes.router)["delete_page_view"].response_model_exclude_none


def test_only_concrete_redirect_file_and_stream_boundaries_are_unmodelled() -> None:
    from backend.api import (
        ai_routes,
        calendar_routes,
        microsoft_auth_routes,
        notion_oauth_routes,
        public_routes,
        tools_routes,
        vault_templates_routes,
        vault_views_routes,
    )

    selected = (
        public_routes.router,
        ai_routes.router,
        notion_oauth_routes.router,
        tools_routes.router,
        microsoft_auth_routes.router,
        calendar_routes.router,
        vault_views_routes.router,
        vault_templates_routes.router,
    )
    unmodelled = {
        (route.endpoint.__module__, route.endpoint.__name__): route
        for router in selected
        for route in router.routes
        if isinstance(route, APIRoute) and route.response_model is None
    }

    assert set(unmodelled) == {
        (notion_oauth_routes.__name__, "login"),
        (notion_oauth_routes.__name__, "callback"),
        (microsoft_auth_routes.__name__, "login"),
        (microsoft_auth_routes.__name__, "callback"),
        (calendar_routes.__name__, "get_ics_feed"),
        (vault_templates_routes.__name__, "export_vault_template"),
    }

    # Both OAuth modules use these endpoint names; verify every concrete
    # redirect rather than relying on the de-duplicated inventory above.
    for router in (notion_oauth_routes.router, microsoft_auth_routes.router):
        routes = _routes(router)
        for endpoint_name in ("login", "callback"):
            assert routes[endpoint_name].response_model is None
            assert get_type_hints(routes[endpoint_name].endpoint)["return"] is RedirectResponse

    calendar_feed = _routes(calendar_routes.router)["get_ics_feed"]
    template_export = _routes(vault_templates_routes.router)["export_vault_template"]
    for route in (calendar_feed, template_export):
        assert route.response_model is None
        assert route.response_class is Response
        assert get_type_hints(route.endpoint)["return"] is Response


def test_ai_provider_models_preserve_every_success_variant() -> None:
    from backend.domains.configuration.ai.contracts import (
        ProviderCredentialsResponse,
        ProviderDeletionResponse,
        ProviderStatusResponse,
        ProviderValidationResponse,
    )

    validation_failure = {"success": False, "error": "invalid"}
    validation_success = {
        "success": True,
        "response": [{"type": "text", "text": "ok"}],
    }
    credentials = {
        "status": "success",
        "provider": "openai",
        "credential_ref": "__keychain__:openai",
        "has_api_key": True,
    }
    deletion = {
        "status": "skipped",
        "message": "Provider openai not found in config",
        "removed_models": 0,
        "credential_deleted": False,
        "env_keys_deleted": [],
    }
    status = {"status": "success", "provider": "openai", "enabled": False}

    assert (
        ProviderValidationResponse.model_validate(validation_failure).model_dump(exclude_unset=True)
        == validation_failure
    )
    assert (
        ProviderValidationResponse.model_validate(validation_success).model_dump(exclude_unset=True)
        == validation_success
    )
    assert ProviderCredentialsResponse.model_validate(credentials).model_dump() == credentials
    assert ProviderDeletionResponse.model_validate(deletion).model_dump() == deletion
    assert ProviderStatusResponse.model_validate(status).model_dump() == status
