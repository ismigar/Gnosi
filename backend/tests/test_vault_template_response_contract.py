"""Typed JSON and binary contracts for the Vault template marketplace."""

from __future__ import annotations

from fastapi.responses import Response
from fastapi.routing import APIRoute


def _routes() -> dict[str, APIRoute]:
    from backend.api import vault_templates_routes

    names = {
        "list_template_catalog",
        "create_vault_from_template",
        "preview_template_export",
        "export_vault_template",
        "submit_vault_template",
    }
    return {
        route.endpoint.__name__: route
        for route in vault_templates_routes.router.routes
        if isinstance(route, APIRoute) and route.endpoint.__name__ in names
    }


def test_vault_template_routes_publish_json_models_and_keep_binary_export() -> None:
    from backend.api import vault_templates_routes

    routes = _routes()

    assert (
        routes["list_template_catalog"].response_model
        is vault_templates_routes.TemplateCatalogResponse
    )
    assert (
        routes["create_vault_from_template"].response_model
        is vault_templates_routes.CreatedVaultTemplateResponse
    )
    assert (
        routes["preview_template_export"].response_model
        is vault_templates_routes.TemplateExportPreviewResponse
    )
    assert (
        routes["submit_vault_template"].response_model
        is vault_templates_routes.TemplateSubmissionResponse
    )
    assert routes["export_vault_template"].response_model is None
    assert routes["export_vault_template"].response_class is Response


def test_vault_template_models_preserve_dynamic_catalog_and_preview_fields() -> None:
    from backend.api import vault_templates_routes

    catalog = {
        "templates": [
            {
                "id": "research",
                "version": "1.0.0",
                "name": "Research",
                "extension": {"featured": True},
            }
        ],
        "submissionConfigured": True,
        "signedBy": "official",
    }
    preview = {
        "included": [{"path": "Wiki/Index.md", "size": 120}],
        "excluded": [{"path": ".env", "reason": "secret"}],
        "findings": [{"path": "Wiki/Index.md", "kind": "email"}],
        "totalSize": 120,
    }

    assert (
        vault_templates_routes.TemplateCatalogResponse.model_validate(catalog).model_dump(
            exclude_unset=True
        )
        == catalog
    )
    assert (
        vault_templates_routes.TemplateExportPreviewResponse.model_validate(
            preview
        ).model_dump()
        == preview
    )
