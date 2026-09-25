"""Behavior contracts for the extracted AI editor routes."""

import asyncio

import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute

from backend.services import agent_execution
from backend.domains.configuration.ai.content_routes import (
    CorrectTextResponse,
    CorrectPayload,
    GenerateContentResponse,
    GeneratePayload,
    router,
    build_generation_prompt,
    correct_text,
    generate_content,
)


def test_editor_ai_routes_publish_typed_response_contracts() -> None:
    routes = {
        route.endpoint.__name__: route
        for route in router.routes
        if isinstance(route, APIRoute)
    }

    assert routes["generate_content"].response_model is GenerateContentResponse
    assert routes["correct_text"].response_model is CorrectTextResponse


def test_translation_prompt_preserves_target_language() -> None:
    prompt = build_generation_prompt(
        GeneratePayload(mode="translate", context="Bon dia", language="French")
    )

    assert "translate it into French" in prompt
    assert "--- TEXT ---\nBon dia" in prompt


def test_generate_content_uses_editor_context(monkeypatch: pytest.MonkeyPatch) -> None:
    observed: list[tuple[str, str]] = []

    def fake_generate(operation: str, prompt: str, user_message: str) -> tuple[str, str]:
        assert operation == "writing"
        observed.append((prompt, user_message))
        return "Generated", "local"

    monkeypatch.setattr(agent_execution, "generate_for", fake_generate)

    result = asyncio.run(
        generate_content(GeneratePayload(prompt="Expand", context="Current page"))
    )

    assert result == {"content": "Generated", "provider": "local"}
    assert observed[0][1] == "Expand"
    assert "Current page" in observed[0][0]


def test_correct_text_preserves_source_excerpt(monkeypatch: pytest.MonkeyPatch) -> None:
    observed: list[tuple[str, str]] = []

    def fake_generate(operation: str, prompt: str, user_message: str) -> tuple[str, str]:
        assert operation == "writing"
        observed.append((prompt, user_message))
        return "Text corregit", "groq"

    monkeypatch.setattr(agent_execution, "generate_for", fake_generate)

    result = asyncio.run(correct_text(CorrectPayload(text="Text incorrekte", language="ca")))

    assert result == {"corrected": "Text corregit", "provider": "groq"}
    assert observed[0][1] == "Text incorrekte"
    assert "Catalan" in observed[0][0]


def test_generate_content_maps_provider_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail_generate(_operation: str, _prompt: str, _user_message: str) -> tuple[str, str]:
        raise TimeoutError("provider timed out")

    monkeypatch.setattr(agent_execution, "generate_for", fail_generate)

    with pytest.raises(HTTPException) as raised:
        asyncio.run(generate_content(GeneratePayload(prompt="Expand")))

    assert raised.value.status_code == 504


@pytest.mark.parametrize(("incident", "detail"), [
    ("plugin_profile_unavailable:builtin:mail", "The plugin profile is unavailable"),
    ("principal_agent_unavailable", "No active principal agent is configured"),
    ("principal_agent_model_unavailable", "The selected profile's model is unavailable"),
    ("agent_skill_unavailable:core.gnosi-operation-writing", "missing the required skill: core.gnosi-operation-writing"),
])
def test_editor_reports_the_specific_principal_configuration_issue(monkeypatch, incident, detail):
    def unavailable(*args, **kwargs):
        raise RuntimeError(incident)
    monkeypatch.setattr(agent_execution, "generate_for", unavailable)
    with pytest.raises(HTTPException) as raised:
        asyncio.run(generate_content(GeneratePayload(prompt="Write")))
    assert raised.value.status_code == 503
    assert detail in raised.value.detail
