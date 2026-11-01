"""Response contracts for translation routes."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from fastapi import BackgroundTasks, HTTPException
from fastapi.routing import APIRoute

from backend.api import vault_routes
from backend.domains.vault.translation import routes as translation_routes


def _route(handler_name: str) -> APIRoute:
    return next(
        route
        for route in vault_routes.router.routes
        if isinstance(route, APIRoute) and route.endpoint.__name__ == handler_name
    )


def _translation_result(item_id: str) -> dict[str, Any]:
    return {
        "item_id": item_id,
        "source_lang": "ca",
        "created": [
            {
                "id": f"{item_id}-en",
                "lang": "en",
                "providers": ["fake"],
                "title": "Translated",
                "extension": {"confidence": 0.9},
            }
        ],
        "updated": [],
        "skipped": [{"lang": "fr", "reason": "disabled", "retryable": False}],
    }


def test_routes_expose_exact_models_without_changing_methods_or_status() -> None:
    expected = {
        "translate_row": (
            "/skills/translate-row",
            translation_routes.TranslateRowResponse,
        ),
        "translate_rows": (
            "/skills/translate-rows",
            translation_routes.TranslateRowsResponse,
        ),
        "translate_page": (
            "/skills/translate-page",
            translation_routes.TranslatePageResponse,
        ),
        "execute_button_action": (
            "/skills/execute-button-action",
            translation_routes.ExecuteButtonActionResponse,
        ),
    }

    for handler_name, (path, response_model) in expected.items():
        route = _route(handler_name)
        assert route.path == path
        assert route.methods == {"POST"}
        assert route.status_code is None
        assert route.response_model is response_model
        assert response_model.model_config["extra"] == "allow"


def test_translate_row_and_bulk_preserve_dynamic_results_and_per_row_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        translation_routes._legacy,
        "_load_translate_row_skill",
        lambda: (object(), object()),
    )
    monkeypatch.setattr(translation_routes._legacy, "_read_deepl_key", lambda: "secret")

    async def translate_row(
        item_id: str,
        target_languages: list[Any],
        **kwargs: Any,
    ) -> dict[str, Any]:
        assert target_languages == ["en", "fr"]
        assert kwargs["deepl_api_key"] == "secret"
        if item_id == "bad-row":
            raise HTTPException(
                status_code=409,
                detail={"code": "not_translatable", "languages": ["en", "fr"]},
            )
        return _translation_result(item_id)

    monkeypatch.setattr(translation_routes._legacy, "_do_translate_row", translate_row)

    single_response = asyncio.run(
        translation_routes.translate_row(
            BackgroundTasks(),
            {
                "item_id": "row-1",
                "target_languages": ["en", "fr"],
                "button_action": "translate_row",
            },
        )
    )
    expected_single = {"status": "ok", **_translation_result("row-1")}
    assert single_response == expected_single
    assert (
        translation_routes.TranslateRowResponse.model_validate(single_response).model_dump()
        == expected_single
    )

    bulk_response = asyncio.run(
        translation_routes.translate_rows(
            BackgroundTasks(),
            {
                "item_ids": ["row-1", "bad-row", "row-1"],
                "target_languages": ["en", "fr"],
                "button_action": "translate_row",
            },
        )
    )
    expected_bulk = {
        "status": "ok",
        "count": 1,
        "results": [_translation_result("row-1")],
        "errors": [
            {
                "item_id": "bad-row",
                "detail": {
                    "code": "not_translatable",
                    "languages": ["en", "fr"],
                },
            }
        ],
    }
    assert bulk_response == expected_bulk
    assert (
        translation_routes.TranslateRowsResponse.model_validate(bulk_response).model_dump()
        == expected_bulk
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(translation_routes.translate_rows(BackgroundTasks(), {"item_ids": []}))
    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "item_ids must be a non-empty list"


def test_translate_page_preserves_delegated_dynamic_shape_and_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    expected = {
        "status": "ok",
        "page_id": "page-1",
        "source_lang": "ca",
        "created": [
            {
                "id": "page-en",
                "lang": "en",
                "providers": ["fake"],
                "title": "Page",
                "extension": {"segments": 4},
            }
        ],
        "updated": [],
        "skipped": [],
        "extension": {"duration_ms": 12},
    }

    async def translate_page(
        background_tasks: BackgroundTasks,
        payload: dict[str, Any],
        dependencies: Any,
    ) -> dict[str, Any]:
        assert isinstance(background_tasks, BackgroundTasks)
        assert payload == {"page_id": "page-1", "target_languages": ["en"]}
        assert dependencies is translation_routes._legacy._PAGE_TRANSLATION_DEPENDENCIES
        return expected

    monkeypatch.setattr(
        translation_routes._legacy.translation_page_service,
        "translate_page",
        translate_page,
    )
    response = asyncio.run(
        translation_routes.translate_page(
            BackgroundTasks(),
            {"page_id": "page-1", "target_languages": ["en"]},
        )
    )

    assert response == expected
    assert (
        translation_routes.TranslatePageResponse.model_validate(response).model_dump() == expected
    )

    async def fail_translate_page(
        _background_tasks: BackgroundTasks,
        _payload: dict[str, Any],
        _dependencies: Any,
    ) -> dict[str, Any]:
        raise HTTPException(status_code=404, detail="Page not found")

    monkeypatch.setattr(
        translation_routes._legacy.translation_page_service,
        "translate_page",
        fail_translate_page,
    )
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            translation_routes.translate_page(
                BackgroundTasks(),
                {"page_id": "missing", "target_languages": ["en"]},
            )
        )
    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "Page not found"
