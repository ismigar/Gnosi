"""Typed OpenAPI and payload-preservation contract for AI registry APIs."""

from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.routing import APIRoute

from backend.agent import model_catalog
from backend.api import ai_routes
from backend.domains.configuration.ai import contracts


TARGET_RESPONSE_MODELS = {
    ("GET", "/ai/catalog"): "AiCatalogResponse",
    ("GET", "/ai/models"): "ModelRegistryResponse",
    ("PUT", "/ai/models"): "ModelRegistryUpdateResponse",
    ("GET", "/ai/model-catalog"): "ModelCatalogResponse",
    ("GET", "/ai/model-comparison"): "ModelComparisonResponse",
    ("GET", "/ai/usage"): "AiUsageResponse",
    ("GET", "/ai/usage/history"): "AiUsageHistoryResponse",
}


def _api_routes() -> list[APIRoute]:
    return [route for route in ai_routes.router.routes if isinstance(route, APIRoute)]


def _route(method: str, path: str) -> APIRoute:
    return next(
        route
        for route in _api_routes()
        if route.path == path and method in (route.methods or set())
    )


def _focused_openapi() -> dict[str, Any]:
    app = FastAPI()
    app.include_router(ai_routes.router, prefix="/api")
    return app.openapi()


def test_ai_registry_routes_expose_concrete_response_models() -> None:
    for operation, model_name in TARGET_RESPONSE_MODELS.items():
        route = _route(*operation)

        assert route.response_model is not None
        assert route.response_model.__name__ == model_name


def test_ai_registry_openapi_types_success_responses_and_models_request() -> None:
    openapi = _focused_openapi()
    paths = openapi["paths"]

    for (method, route_path), model_name in TARGET_RESPONSE_MODELS.items():
        route = _route(method, route_path)
        operation = paths[f"/api{route.path_format}"][method.lower()]
        response_schema = operation["responses"]["200"]["content"]["application/json"]["schema"]

        assert response_schema == {"$ref": f"#/components/schemas/{model_name}"}

    models_route = _route("PUT", "/ai/models")
    models_operation = paths[f"/api{models_route.path_format}"]["put"]
    request_schema = models_operation["requestBody"]["content"]["application/json"]["schema"]

    assert request_schema == {"$ref": "#/components/schemas/ModelsPayload"}


def test_ai_catalog_and_model_catalog_preserve_provider_extensions() -> None:
    catalog_payload = {
        "catalog": {
            "providers": [
                {
                    "id": "openai",
                    "name": "OpenAI",
                    "icon": "openai",
                    "models": ["gpt-test"],
                    "models_count": 1,
                    "is_local": False,
                    "live": True,
                    "env": ["OPENAI_API_KEY"],
                    "doc": "https://example.test/docs",
                    "base_url": "",
                    "base_url_hint": "https://api.example.test/v1",
                    "model_name": "",
                    "credential_ref": None,
                    "has_api_key": False,
                    "connected": False,
                    "configured": True,
                    "enabled": True,
                }
            ]
        },
        "config": {
            "providers": {
                "openai": {
                    "enabled": True,
                    "provider_extension": {"region": "eu"},
                }
            },
            "disconnected_providers": [],
        },
    }
    model_catalog_payload = {
        "schema": 3,
        "source": "vendored",
        "providers": [
            {
                "id": "ollama",
                "name": "Ollama (Local)",
                "is_local": True,
                "env": [],
                "api": "",
                "npm": "",
                "doc": "https://ollama.com",
                "models": [
                    {
                        "id": "local-test",
                        "name": "local-test",
                        "cost_in": 0.0,
                        "cost_out": 0.0,
                        "context_window": 8192,
                        "tags": ["fast"],
                        "quality": 1,
                        "release_date": "",
                        "runtime_extension": "metal",
                    }
                ],
                "connected": True,
                "configured": False,
                "enabled": True,
                "has_api_key": False,
                "base_url": "",
                "provider_extension": {"runtime": "local"},
            }
        ],
    }

    catalog = contracts.AiCatalogResponse.model_validate(catalog_payload)
    model_catalog_response = contracts.ModelCatalogResponse.model_validate(model_catalog_payload)

    assert catalog.model_dump(exclude_unset=True) == catalog_payload
    assert model_catalog_response.model_dump(exclude_unset=True, by_alias=True) == (
        model_catalog_payload
    )


def test_ai_registry_response_preserves_optional_and_custom_model_fields() -> None:
    payload = {
        "models": [
            {
                "provider": "openai",
                "model_id": "gpt-test",
                "enabled": True,
                "cost_in": 0.4,
                "price_from_catalog": True,
                "provider_extension": {"tier": "batch"},
            }
        ],
        "configured_models": [],
        "budget": {"monthly_cost_cap": 15.0, "custom_policy": "warn"},
        "default": [],
        "currency": {
            "code": "EUR",
            "symbol": "€",
            "usd_rate": 0.86,
            "source": "static",
            "fetched_at": "",
        },
    }

    response = contracts.ModelRegistryResponse.model_validate(payload)

    assert response.model_dump(exclude_unset=True) == payload


def test_ai_comparison_and_usage_contracts_preserve_wire_payloads() -> None:
    currency = {
        "code": "EUR",
        "symbol": "€",
        "usd_rate": 0.86,
        "source": "static",
        "fetched_at": "",
    }
    usage_row = {
        "provider": "openai",
        "model_id": "gpt-test",
        "in": 120,
        "out": 30,
        "cost_usd": 0.001,
        "cost_ccy": 0.0009,
    }
    comparison_payload = {
        "source": "Artificial Analysis",
        "source_url": "https://artificialanalysis.ai",
        "fetched_at": "2026-08-29T12:00:00+00:00",
        "intelligence_index_version": {"release": 4},
        "count": 1,
        "models": [
            {
                "id": "model-1",
                "slug": "model-1",
                "name": "Model 1",
                "creator": "Example",
                "release_date": "2026-08-01",
                "input_price": 0.2,
                "output_price": 0.8,
                "context_window": 128000,
                "speed": 80.0,
                "latency": 0.4,
                "intelligence": 65.0,
                "coding": 60.0,
                "agentic": None,
                "tags": ["code"],
                "modes": ["text"],
                "routes": [
                    {
                        "provider": "openai",
                        "provider_name": "OpenAI",
                        "model_id": "model-1",
                        "model_name": "Model 1",
                        "is_local": False,
                        "cost_in": 0.2,
                        "cost_out": 0.8,
                        "context_window": 128000,
                        "quality": 3,
                        "tags": ["code"],
                    }
                ],
                "profile": "expert",
                "external_extension": {"benchmark": "v4"},
            }
        ],
        "currency": currency,
        "fallback": False,
    }
    usage_payload = {
        "period": "2026-08",
        "currency": currency,
        "spent_usd": 0.001,
        "spent_ccy": 0.0009,
        "cap_ccy": None,
        "cap_usd": None,
        "ratio": None,
        "over_cap": False,
        "budget": {"prefer_local": True},
        "per_model": [usage_row],
    }
    history_payload = {
        "currency": currency,
        "periods": {
            "2026-08": {
                "period": "2026-08",
                "total_usd": 0.001,
                "total_ccy": 0.0009,
                "models": [usage_row],
            }
        },
    }

    comparison = contracts.ModelComparisonResponse.model_validate(comparison_payload)
    usage = contracts.AiUsageResponse.model_validate(usage_payload)
    history = contracts.AiUsageHistoryResponse.model_validate(history_payload)

    assert comparison.model_dump(exclude_unset=True) == comparison_payload
    assert usage.model_dump(exclude_unset=True, by_alias=True) == usage_payload
    assert history.model_dump(exclude_unset=True, by_alias=True) == history_payload


def test_models_payload_keeps_legacy_manual_invalid_row_error(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    params_path = tmp_path / "params.yaml"
    params_path.write_text("{}\n", encoding="utf-8")
    monkeypatch.setattr(
        ai_routes,
        "load_params",
        lambda strict_env=False: SimpleNamespace(params_source=params_path),
    )
    monkeypatch.setattr(model_catalog, "catalog_price_index", lambda: {})
    monkeypatch.setattr(model_catalog, "catalog_model_metadata_index", lambda: {})
    payload = contracts.ModelsPayload.model_validate({"models": ["invalid-row"]})

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            ai_routes.set_model_registry(
                payload,
                cast(Request, SimpleNamespace()),
            )
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "cada model necessita provider i model_id"
