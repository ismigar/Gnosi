"""Reasoning settings reach OpenRouter, including stateless tool round trips."""

import json
import time
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest
import requests
import yaml
from fastapi import HTTPException
from langchain_core.messages import HumanMessage, ToolMessage

from backend.services import model_reasoning as reasoning

LUNA = "openai/gpt-6-luna"


@pytest.fixture(autouse=True)
def offline_metadata(monkeypatch, tmp_path):
    monkeypatch.setattr(reasoning, "_cached", dict(reasoning._VERIFIED))
    monkeypatch.setattr(reasoning, "_checked_at", time.monotonic())
    monkeypatch.setattr(reasoning, "_cache_path", lambda: tmp_path / "reasoning.json")


def test_provider_metadata_distinguishes_missing_null_and_mandatory():
    parsed = reasoning.parse_openrouter_models({"data": [
        {"id": "missing", "reasoning": {"default_enabled": True}},
        {"id": "all", "reasoning": {"supported_efforts": None}},
        {"id": "limited", "reasoning": {"supported_efforts": ["high", "low", "none", "low", "bogus"], "mandatory": True, "default_effort": "high"}},
    ]})
    assert parsed["missing"]["supported_efforts"] == []
    assert parsed["all"]["supported_efforts"] == list(reasoning.EFFORTS)
    assert parsed["limited"]["supported_efforts"] == ["low", "high"]
    assert parsed["limited"]["default_effort"] == "high"


def test_offline_fallback_is_bounded_and_failed_refresh_is_cached(monkeypatch):
    monkeypatch.setattr(reasoning, "_cached", None)
    fetch = Mock(side_effect=requests.ConnectionError("offline"))
    monkeypatch.setattr(requests, "get", fetch)
    assert reasoning.reasoning_options("openrouter", LUNA)["default_effort"] == "medium"
    assert reasoning.reasoning_options("openrouter", "unknown")["supported_efforts"] == []
    assert reasoning.reasoning_options("other", LUNA)["supported_efforts"] == []
    assert fetch.call_count == 1


def test_live_missing_efforts_override_offline_snapshot(monkeypatch):
    monkeypatch.setattr(reasoning, "_checked_at", 0)
    response = Mock()
    response.json.return_value = {"data": [{"id": LUNA, "reasoning": {}}]}
    monkeypatch.setattr(requests, "get", Mock(return_value=response))
    assert reasoning.reasoning_options("openrouter", LUNA)["supported_efforts"] == []


def test_verified_provider_metadata_survives_offline_restart(monkeypatch):
    monkeypatch.setattr(reasoning, "_checked_at", 0)
    response = Mock()
    response.json.return_value = {"data": [{"id": "other/model", "reasoning": {"supported_efforts": ["low", "high"]}}]}
    fetch = Mock(return_value=response)
    monkeypatch.setattr(requests, "get", fetch)
    assert reasoning.reasoning_options("openrouter", "other/model")["supported_efforts"] == ["low", "high"]
    monkeypatch.setattr(reasoning, "_cached", None)
    fetch.side_effect = requests.ConnectionError("offline")
    assert reasoning.reasoning_options("openrouter", "other/model")["supported_efforts"] == ["low", "high"]


def test_settings_validate_and_persist_effort_without_losing_other_agent_fields(tmp_path, monkeypatch):
    from backend.domains.configuration.api import settings
    from backend.agent import model_router

    monkeypatch.setattr(model_router, "load_registry", lambda: [])
    agent = {"id": "sources", "provider": "openrouter", "model": LUNA,
             "reasoning_effort": "medium", "persona": "Preserve sources", "skill_ids": ["search"]}
    payload = {"ai": {"agents": [agent]}}
    merged = {}
    settings._validate_agent_strategies(payload, merged)
    path = tmp_path / "settings.yaml"
    settings._write_config(path, merged)
    assert yaml.safe_load(path.read_text())["ai"]["agents"][0].items() >= agent.items()
    agent["reasoning_effort"] = "minimal"  # Luna does not support this gateway level.
    with pytest.raises(HTTPException) as error:
        settings._validate_agent_strategies(payload, {})
    assert error.value.status_code == 400
    assert yaml.safe_load(path.read_text())["ai"]["agents"][0]["reasoning_effort"] == "medium"


@pytest.mark.parametrize("provider,model,expected", [
    ("openrouter", LUNA, "medium"),
    ("openrouter", "other/model", None),
    ("openai", LUNA, None),
])
def test_workflow_scopes_effort_to_the_assistants_route(monkeypatch, provider, model, expected):
    from backend.domains.agent import workflow_setup as setup

    agent = {"provider": "openrouter", "model": LUNA, "reasoning_effort": "medium"}
    profile = setup.ProfileSetup({}, {}, [], agent, "sources", None)
    monkeypatch.setattr(setup, "_select_model_route", lambda *_, **__: (provider, model, {}))
    model_factory = Mock(return_value=Mock())
    dependencies = SimpleNamespace(get_llm=model_factory, resolve_provider_api_key=lambda *_: "test-key",
                                   provider_fallbacks=lambda *_, **__: [])
    result, _ = setup.resolve_model(profile, llm_mode="agent_default", llm_provider=None,
                                    llm_model=None, user_message="Hi", timeout=10, dependencies=dependencies)
    assert result is not None
    assert model_factory.call_args.kwargs.get("reasoning_effort") == expected


def test_default_llm_reads_each_assistants_saved_effort(monkeypatch):
    from backend.domains.agent import llm

    agents = [{"id": "sources", "provider": "openrouter", "model": LUNA, "reasoning_effort": "medium"},
              {"id": "other", "provider": "openrouter", "model": LUNA}]
    monkeypatch.setattr(llm, "load_params", lambda **_: SimpleNamespace(ai={"agents": agents, "providers": {}}))
    monkeypatch.setattr(llm, "resolve_provider_api_key", lambda *_: "test-key")
    model_factory = Mock(return_value=SimpleNamespace(model_name=LUNA))
    monkeypatch.setattr(llm, "get_llm", model_factory)
    llm.get_default_llm_with_meta(agent_id="sources")
    assert model_factory.call_args.kwargs["reasoning_effort"] == "medium"
    llm.get_default_llm_with_meta(agent_id="other")
    assert "reasoning_effort" not in model_factory.call_args.kwargs


def test_openrouter_wire_payload_preserves_effort_and_tool_reasoning(monkeypatch):
    from backend.domains.agent.llm import get_llm
    from langchain_openai import ChatOpenAI

    sent = []

    def respond(request):
        assert str(request.url) == "https://openrouter.ai/api/v1/responses"
        sent.append(json.loads(request.content))
        output = [
            {"id": "rs_1", "type": "reasoning", "summary": [], "encrypted_content": "opaque-reasoning"},
            {"id": "fc_1", "type": "function_call", "call_id": "call_1", "name": "find_source", "arguments": '{"query":"test"}', "status": "completed"},
        ] if len(sent) == 1 else [
            {"id": "msg_2", "type": "message", "role": "assistant", "status": "completed",
             "content": [{"type": "output_text", "text": "Done", "annotations": []}]},
        ]
        return httpx.Response(200, json={"id": f"resp_{len(sent)}", "object": "response",
            "created_at": 1, "status": "completed", "model": LUNA, "output": output,
            "usage": {"input_tokens": 5, "output_tokens": 2, "total_tokens": 7}})

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        # Exercise the production model_factory while replacing only HTTP transport.
        monkeypatch.setattr("langchain_openai.ChatOpenAI", lambda **kwargs: ChatOpenAI(http_client=client, **kwargs))
        llm = get_llm("openrouter", LUNA, api_key="test-key", timeout=10, reasoning_effort="medium")
        assert llm is not None
        bound = llm.bind_tools([{"type": "function", "function": {"name": "find_source", "description": "Find a source", "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}}}])
        first = bound.invoke([HumanMessage(content="Find a source")])
        assert first.tool_calls[0]["name"] == "find_source"
        final = bound.invoke([HumanMessage(content="Find a source"), first,
                              ToolMessage(content="Source found", tool_call_id="call_1")])
        assert final.text == "Done"
    for body in sent:
        assert body["model"] == LUNA
        assert body["reasoning"] == {"effort": "medium"}
        assert body["store"] is False
        assert "previous_response_id" not in body
        assert body["tools"][0]["name"] == "find_source"
    assert any(item.get("encrypted_content") == "opaque-reasoning" for item in sent[1]["input"])
    assert any(item.get("type") == "function_call_output" and item["call_id"] == "call_1" for item in sent[1]["input"])


def test_default_luna_uses_stateless_responses_and_other_defaults_stay_unchanged():
    from backend.domains.agent.llm import get_llm

    luna = get_llm("openrouter", LUNA, api_key="test-key")
    assert luna.use_responses_api is True
    assert luna.reasoning is None
    other = get_llm("openrouter", "other/model", api_key="test-key")
    assert other.reasoning is None
    assert other.use_responses_api is not True
