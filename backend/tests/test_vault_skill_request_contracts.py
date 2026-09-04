"""Named, compatibility-preserving request contracts for Vault skills."""

from __future__ import annotations

import asyncio

from fastapi import BackgroundTasks, FastAPI
import pytest

from backend.api import vault_routes
from backend.domains.vault.citations import lookup_routes
from backend.domains.vault.citations import web_capture
from backend.domains.vault.citations.request_contracts import (
    UrlTranslationRequest,
    request_payload as citation_payload,
)
from backend.domains.vault.translation import routes
from backend.domains.vault.drupal import matching as drupal_matching
from backend.domains.vault.translation import page_service
from backend.domains.vault.translation.request_contracts import (
    ExecuteButtonActionRequest,
    GenerateButtonActionRequest,
    MatchDrupalRowsRequest,
    SyncDrupalRowRequest,
    SyncDrupalRowsRequest,
    TranslatePageRequest,
    TranslateRowRequest,
    TranslateRowsRequest,
    VaultSkillRequest,
    request_payload,
)


REQUEST_MODELS = {
    "/api/vault/skills/sync-drupal-row": SyncDrupalRowRequest,
    "/api/vault/skills/sync-drupal-rows": SyncDrupalRowsRequest,
    "/api/vault/skills/match-drupal-rows": MatchDrupalRowsRequest,
    "/api/vault/skills/translate-row": TranslateRowRequest,
    "/api/vault/skills/translate-rows": TranslateRowsRequest,
    "/api/vault/skills/generate-button-action": GenerateButtonActionRequest,
    "/api/vault/skills/execute-button-action": ExecuteButtonActionRequest,
    "/api/vault/skills/translate-page": TranslatePageRequest,
    "/api/vault/translate-url": UrlTranslationRequest,
}


def _openapi() -> dict[str, object]:
    app = FastAPI()
    app.include_router(routes.router, prefix="/api/vault")
    return app.openapi()


def test_selected_routes_reference_distinct_named_request_models() -> None:
    schema = _openapi()
    paths = schema["paths"]
    assert isinstance(paths, dict)

    for path, request_model in REQUEST_MODELS.items():
        body_schema = paths[path]["post"]["requestBody"]["content"]["application/json"]["schema"]
        assert body_schema == {"$ref": f"#/components/schemas/{request_model.__name__}"}


def test_models_publish_every_property_consumed_by_the_handlers() -> None:
    expected = {
        SyncDrupalRowRequest: {"item_id", "button_action", "publish", "scope", "push_media"},
        SyncDrupalRowsRequest: {"item_ids", "scope", "publish", "push_media"},
        MatchDrupalRowsRequest: {"table_id", "bundle", "item_ids", "dry_run"},
        TranslateRowRequest: {"item_id", "target_languages", "button_action"},
        TranslateRowsRequest: {"item_ids", "target_languages", "button_action"},
        GenerateButtonActionRequest: {"prompt", "fields"},
        ExecuteButtonActionRequest: {"note_id", "button_action", "button_config"},
        TranslatePageRequest: {"page_id", "target_languages", "button_action"},
        UrlTranslationRequest: {"url"},
    }
    components = _openapi()["components"]
    assert isinstance(components, dict)
    schemas = components["schemas"]

    for model, properties in expected.items():
        model_schema = schemas[model.__name__]
        assert set(model_schema["properties"]) == properties
        assert model_schema["additionalProperties"] is True


@pytest.mark.parametrize("model", list(REQUEST_MODELS.values()))
def test_models_preserve_malformed_values_unknown_fields_and_omission(
    model: type[VaultSkillRequest] | type[UrlTranslationRequest],
) -> None:
    raw = {
        next(iter(model.model_fields)): {"legacy": [1, False, None]},
        "future_extension": {"nested": ["untouched", 2]},
    }
    parsed = model.model_validate(raw)
    if isinstance(parsed, VaultSkillRequest):
        assert request_payload(parsed) == raw
    else:
        assert citation_payload(parsed) == raw

    empty = model.model_validate({})
    if isinstance(empty, VaultSkillRequest):
        assert request_payload(empty) == {}
    else:
        assert citation_payload(empty) == {}


def test_absent_and_explicit_null_remain_distinct() -> None:
    assert request_payload(SyncDrupalRowRequest.model_validate({})) == {}
    assert request_payload(SyncDrupalRowRequest.model_validate({"publish": None})) == {
        "publish": None
    }


def test_downstream_routes_receive_exact_supplied_payloads(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    received: list[tuple[str, dict[str, object]]] = []

    async def match(
        tasks: BackgroundTasks,
        payload: dict[str, object],
        dependencies: object,
    ) -> dict[str, object]:
        assert isinstance(tasks, BackgroundTasks)
        assert dependencies is matching_dependencies
        received.append(("match", payload))
        return {"status": "ok"}

    async def translate_page(
        tasks: BackgroundTasks,
        payload: dict[str, object],
        dependencies: object,
    ) -> dict[str, object]:
        assert isinstance(tasks, BackgroundTasks)
        assert dependencies is page_dependencies
        received.append(("page", payload))
        return {"status": "ok"}

    async def capture_url(payload: dict[str, object], dependencies: object) -> dict[str, object]:
        received.append(("url", payload))
        return {
            "source": "web",
            "identifier": "https://example.test",
            "suggested": {},
            "error": None,
        }

    matching_dependencies = object()
    page_dependencies = object()
    monkeypatch.setattr(drupal_matching, "match_drupal_rows", match)
    monkeypatch.setattr(
        vault_routes, "_drupal_matching_dependencies", lambda: matching_dependencies
    )
    monkeypatch.setattr(page_service, "translate_page", translate_page)
    monkeypatch.setattr(vault_routes, "_PAGE_TRANSLATION_DEPENDENCIES", page_dependencies)
    monkeypatch.setattr(web_capture, "capture_url", capture_url)

    async def exercise() -> None:
        await routes.match_drupal_rows(
            BackgroundTasks(),
            MatchDrupalRowsRequest.model_validate(
                {"table_id": 42, "dry_run": None, "extension": [1, 2]}
            ),
        )
        await routes.translate_page(
            BackgroundTasks(),
            TranslatePageRequest.model_validate(
                {"page_id": False, "target_languages": "malformed", "extension": {"v": 3}}
            ),
        )
        await lookup_routes.translate_url(
            UrlTranslationRequest.model_validate(
                {"url": ["malformed"], "extension": {"provider": "future"}}
            )
        )

    asyncio.run(exercise())

    assert received == [
        ("match", {"table_id": 42, "dry_run": None, "extension": [1, 2]}),
        (
            "page",
            {"page_id": False, "target_languages": "malformed", "extension": {"v": 3}},
        ),
        ("url", {"url": ["malformed"], "extension": {"provider": "future"}}),
    ]


def test_existing_mapping_callers_receive_a_copy() -> None:
    payload: dict[str, object] = {"item_id": "row", "extension": 3}
    copied = request_payload(payload)

    assert copied == payload
    assert copied is not payload
