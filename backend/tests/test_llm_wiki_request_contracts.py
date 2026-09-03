"""Focused compatibility checks for named LLM Wiki request bodies."""

from __future__ import annotations

import asyncio
from typing import get_args

import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute
from pydantic import BaseModel


def _route(endpoint_name: str) -> APIRoute:
    from backend.api import vault_routes

    return next(
        route
        for route in vault_routes.router.routes
        if isinstance(route, APIRoute) and route.endpoint.__name__ == endpoint_name
    )


def _body_annotation(endpoint_name: str) -> object:
    route = _route(endpoint_name)
    assert route.body_field is not None
    return route.body_field.field_info.annotation


def test_request_models_declare_fields_without_coercing_legacy_json() -> None:
    from backend.domains.vault.knowledge import contracts, jobs_routes

    cases: list[tuple[type[BaseModel], dict[str, object], set[str]]] = [
        (
            contracts.LlmWikiConfigUpdateRequest,
            {
                "version": "legacy-invalid",
                "ui_locale": ["ca"],
                "brain_table_id": {"id": 1},
                "target_table": False,
                "source_tables": "legacy-invalid",
                "index_field_ids": 7,
                "brain_roles": [],
                "source_contract_revision": {},
                "configured": "yes",
            },
            {
                "version",
                "ui_locale",
                "brain_table_id",
                "target_table",
                "source_tables",
                "index_field_ids",
                "brain_roles",
                "source_contract_revision",
                "configured",
            },
        ),
        (
            contracts.LlmWikiBrainCreateRequest,
            {"name": ["Brain"], "ui_locale": 2, "language": {"legacy": True}},
            {"name", "ui_locale", "language"},
        ),
        (
            jobs_routes.BrainGlossaryRequest,
            {"heard": ["alpha"], "meant": {"value": "beta"}},
            {"heard", "meant"},
        ),
    ]

    for model, payload, properties in cases:
        parsed = model.model_validate({**payload, "unknown_2x_field": "ignored"})
        assert parsed.model_dump(exclude_unset=True) == payload
        schema = model.model_json_schema()
        assert schema["type"] == "object"
        assert set(schema["properties"]) == properties


def test_routes_bind_the_named_request_models() -> None:
    from backend.domains.vault.knowledge import contracts, jobs_routes

    assert _body_annotation("put_llm_wiki_config") is contracts.LlmWikiConfigUpdateRequest
    assert contracts.LlmWikiBrainCreateRequest in get_args(
        _body_annotation("create_standard_llm_wiki_brain")
    )
    assert jobs_routes.BrainSuggestionAcceptRequest in get_args(
        _body_annotation("llm_wiki_accept_suggestion")
    )
    assert _body_annotation("llm_wiki_glossary_learn") is jobs_routes.BrainGlossaryRequest

    config_body = _route("put_llm_wiki_config").body_field
    brain_body = _route("create_standard_llm_wiki_brain").body_field
    accept_body = _route("llm_wiki_accept_suggestion").body_field
    glossary_body = _route("llm_wiki_glossary_learn").body_field
    assert config_body is not None and config_body.field_info.is_required() is True
    assert glossary_body is not None and glossary_body.field_info.is_required() is True
    assert brain_body is not None and brain_body.field_info.is_required() is False
    assert accept_body is not None and accept_body.field_info.is_required() is False


def test_config_request_transmits_only_supplied_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    from backend.domains.configuration import llm_wiki as configuration
    from backend.domains.vault.knowledge import config_routes
    from backend.domains.vault.knowledge.contracts import LlmWikiConfigUpdateRequest

    captured: list[object] = []

    async def fake_put_config(payload: object, dependencies: object) -> dict[str, object]:
        captured.extend((payload, dependencies))
        return {"accepted": True}

    monkeypatch.setattr(configuration, "put_config", fake_put_config)
    request = LlmWikiConfigUpdateRequest.model_validate(
        {"brain_table_id": None, "source_tables": "legacy-invalid", "future": 1}
    )

    result = asyncio.run(config_routes.put_llm_wiki_config(request))

    assert result == {"accepted": True}
    assert captured[0] == {"brain_table_id": None, "source_tables": "legacy-invalid"}
    assert captured[1] is config_routes._LLM_WIKI_CONFIG_DEPENDENCIES


def test_glossary_keeps_endpoint_coercion_and_ignores_unknown_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.domains.vault.knowledge import jobs_routes
    from backend.services import llm_wiki_assist

    received: list[tuple[str, str]] = []

    def fake_learn_pair(heard: str, meant: str) -> int:
        received.append((heard, meant))
        return 3

    monkeypatch.setattr(llm_wiki_assist, "learn_pair", fake_learn_pair)
    request = jobs_routes.BrainGlossaryRequest.model_validate(
        {"heard": ["alpha"], "meant": {"value": "beta"}, "future": True}
    )

    result = asyncio.run(jobs_routes.llm_wiki_glossary_learn(request))

    assert result == {"pairs": 3}
    assert received == [("['alpha']", "{'value': 'beta'}")]


@pytest.mark.parametrize("payload", [None, {}, {"future": [1, None]}])
def test_retired_accept_route_always_keeps_410(payload: object) -> None:
    from backend.domains.vault.knowledge import jobs_routes

    request = (
        jobs_routes.BrainSuggestionAcceptRequest.model_validate(payload)
        if isinstance(payload, dict)
        else None
    )
    with pytest.raises(HTTPException) as caught:
        asyncio.run(jobs_routes.llm_wiki_accept_suggestion("proposal", request))

    assert caught.value.status_code == 410
    assert caught.value.detail == "Connection proposals cannot create permanent notes"


def test_optional_body_models_preserve_missing_and_explicit_null_fields() -> None:
    from backend.domains.vault.knowledge import config_routes, contracts

    empty = contracts.LlmWikiBrainCreateRequest.model_validate({})
    explicit_null = contracts.LlmWikiBrainCreateRequest.model_validate({"name": None})

    assert len(config_routes._contract_payload(None)) == 0
    assert len(config_routes._contract_payload(empty)) == 0
    assert config_routes._contract_payload(explicit_null) == {"name": None}
