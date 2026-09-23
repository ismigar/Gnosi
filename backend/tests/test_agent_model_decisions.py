"""Optional decision models must remain inside the principal's model policy."""

from __future__ import annotations

import json
import asyncio
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest

from backend.services import agent_model_decisions as decisions
from backend.services.agent_model_strategy import (
    choose_agent_model, normalize_model_strategy, validate_model_strategies,
)


@pytest.fixture
def registry():
    return [
        {"provider": "alpha", "model_id": "small", "enabled": True, "quality": 1,
         "cost_in": 0.1, "cost_out": 0.2, "context_window": 128000, "tags": ["tools"]},
        {"provider": "beta", "model_id": "large", "enabled": True, "quality": 3,
         "cost_in": 2, "cost_out": 4, "context_window": 128000, "tags": ["tools", "code"]},
        {"provider": "ollama", "model_id": "local", "enabled": True, "is_local": True,
         "quality": 3, "context_window": 32000, "tags": ["tools", "code"]},
    ]


@pytest.fixture
def agent():
    return {"id": "principal", "provider": "alpha", "model": "small",
            "model_strategy": {"mode": "adaptive", "decision_engine": "jev",
                               "allowed_models": [{"provider": "beta", "model": "large"}]}}


def choose(agent, registry, **kwargs):
    return choose_agent_model("hola, què tal?", agent, registry, is_available=lambda _: True, **kwargs)


def test_legacy_default_and_malformed_alternatives():
    assert normalize_model_strategy({}) == {
        "schema_version": 1, "mode": "pinned", "allowed_models": [], "decision_engine": "rules",
    }
    assert normalize_model_strategy({"model_strategy": {"allowed_models": 3}})["allowed_models"] == []


def test_save_round_trip_and_local_privacy_boundary(agent, registry):
    saved = validate_model_strategies([agent], registry)[0]
    assert saved["model_strategy"]["decision_engine"] == "jev"
    assert choose(saved, registry)["selected"]["model"] == "small"
    agent.update(provider="ollama", model="local")
    agent["model_strategy"]["allowed_models"] = []
    with pytest.raises(ValueError, match="local-only"):
        validate_model_strategies([agent], registry)


def test_automatic_rules_work_without_jev(agent, registry):
    agent["model_strategy"]["decision_engine"] = "rules"
    selector = Mock(side_effect=AssertionError("No external call"))
    assert choose(agent, registry, selector=selector)["selected"]["model"] == "small"
    complex_route = choose_agent_model("analitza aquesta arquitectura de codi", agent, registry,
                                      is_available=lambda _: True, selector=selector)
    assert complex_route["selected"] == {"provider": "beta", "model": "large"}
    selector.assert_not_called()


def test_jev_can_select_only_from_authorized_candidates(agent, registry):
    selector = Mock(return_value=decisions.ModelDecision("beta:large", 0.93, "selected"))
    result = choose(agent, registry, selector=selector)
    assert result["selected"] == {"provider": "beta", "model": "large"}
    assert result["selection_reason"] == "decision_jev"
    assert result["fallback_models"] == [{"provider": "alpha", "model": "small"}]
    assert len(selector.call_args.args[1]) == 2
    selector.return_value = decisions.ModelDecision("ollama:local", 1, "selected")
    result = choose(agent, registry, selector=selector)
    assert result["selected"]["model"] == "small"
    assert result["decision"]["status"] == "invalid_response"


@pytest.mark.parametrize("status", ["low_confidence", "missing_credentials", "timeout", "invalid_response"])
def test_decision_failures_preserve_internal_routing(agent, registry, status):
    selector = Mock(return_value=decisions.ModelDecision(status=status))
    result = choose(agent, registry, selector=selector)
    assert result["selected"]["model"] == "small"
    assert result["decision"]["status"] == status


def test_pinned_and_resilient_modes_do_not_consult_jev(agent, registry):
    selector = Mock(side_effect=AssertionError("No external call"))
    for mode in ("pinned", "resilient"):
        agent["model_strategy"]["mode"] = mode
        assert choose(agent, registry, selector=selector)["selected"]["model"] == "small"
    selector.assert_not_called()


def test_local_profile_never_leaks_to_decision_adapter(agent, registry):
    registry.append({**registry[2], "model_id": "other"})
    agent.update(provider="ollama", model="local")
    agent["model_strategy"]["allowed_models"] = [{"provider": "ollama", "model": "other"}]
    selector = Mock(side_effect=AssertionError("No external call"))
    result = choose(agent, registry, selector=selector)
    assert result["decision"]["status"] == "local_only"
    selector.assert_not_called()


@pytest.mark.parametrize("patch,usage", [
    ({"enabled": False}, {}),
    ({"tags": []}, {}),
    ({"monthly_quota": 10}, {"beta:large": 10}),
    ({"context_window": 1}, {}),
])
def test_disabled_incompatible_exhausted_and_small_models_are_never_candidates(agent, registry, patch, usage):
    registry[1].update(patch)
    selector = Mock()
    result = choose(agent, registry, selector=selector, usage=usage)
    assert result["selected"]["model"] == "small"
    assert result["fallback_models"] == []
    selector.assert_not_called()


def test_budget_constraints_apply_before_jev_and_to_fallbacks(agent, registry):
    selector = Mock()
    result = choose(agent, registry, selector=selector, budget={"cost_cap_usd": 10, "spent_usd": 8})
    assert result["selected"]["model"] == "small"
    assert result["fallback_models"] == []
    result = choose(agent, registry, selector=selector, budget={"cost_cap_usd": 10, "spent_usd": 10})
    assert result["selected"]["model"] == ""
    assert result["fallback_models"] == []
    selector.assert_not_called()


def test_unavailable_primary_does_not_bypass_policy(agent, registry):
    registry[0]["enabled"] = False
    result = choose(agent, registry)
    assert result["selected"]["model"] == "large"
    assert result["fallback_models"] == []


def response_payload(**answer):
    return {"model": "jev-latest", "answers": {"route": {
        "type": "choice", "choice": "m1", "confidence": 0.9,
        "probabilities": {"m0": 0.05, "m1": 0.95}, **answer,
    }}, "usage": {"input_tokens": 100, "output_tokens": 5}}


@pytest.mark.parametrize("patch", [
    {"choice": "invented"}, {"confidence": float("nan")}, {"confidence": True},
    {"confidence": 2}, {"type": "score"}, {"probabilities": {"m0": 0.1}},
    {"probabilities": {"m0": 0.9, "m1": 0.9}},
    {"probabilities": {"m0": 0.9, "m1": 0.1}},
])
def test_invalid_provider_output_is_rejected(patch):
    result = decisions.parse_jev_decision(response_payload(**patch), ["alpha:small", "beta:large"])
    assert result.route is None
    assert result.status == "invalid_response"


def test_uncertain_probability_is_not_hidden_by_confidence():
    result = decisions.parse_jev_decision(
        response_payload(probabilities={"m0": 0.4, "m1": 0.6}), ["alpha:small", "beta:large"],
    )
    assert result.status == "low_confidence"


@pytest.fixture
def jev_transport(monkeypatch):
    recorded = Mock()
    monkeypatch.setattr(decisions, "UsageStore", lambda: SimpleNamespace(record=recorded))
    monkeypatch.setattr(decisions, "resolve_provider_api_key", lambda *_: "test-only-secret")
    original_client = httpx.Client

    def install(handler):
        monkeypatch.setattr(decisions.httpx, "Client", lambda **kwargs: original_client(
            transport=httpx.MockTransport(handler), **kwargs,
        ))
    return install, recorded


def test_jev_wire_contract_data_minimization_and_accounting(jev_transport, registry):
    install, recorded = jev_transport
    seen = []

    def handler(request):
        seen.append(request)
        assert str(request.url) == decisions.JEV_ENDPOINT
        assert request.headers["authorization"] == "Bearer test-only-secret"
        body = json.loads(request.content)
        assert body["model"] == "jev-latest"
        assert set(body["state"]) == {"request", "request_characters", "truncated"}
        assert body["state"]["truncated"] is True
        assert len(body["state"]["request"]) == decisions.MAX_REQUEST_CHARS
        assert set(body["questions"]["route"]["criteria"]) == {"m0", "m1"}
        return httpx.Response(200, json=response_payload())

    install(handler)
    result = decisions.decide_with_jev("x" * 15000, registry[:2], provider_config={}, budget={})
    assert result.route == "beta:large"
    assert len(seen) == 1
    assert recorded.call_args.args[:4] == ("typesafe", "jev-latest", 100, 5)
    assert recorded.call_args.kwargs["cost_usd"] == pytest.approx(0.0000042)


def test_timeouts_are_bounded_and_do_not_retry(jev_transport, registry):
    install, recorded = jev_transport
    calls = []

    def handler(request):
        calls.append(request)
        assert request.extensions["timeout"]["read"] == 3.0
        raise httpx.ReadTimeout("test")

    install(handler)
    assert decisions.decide_with_jev("hello", registry[:2], provider_config={}, budget={}).status == "timeout"
    assert len(calls) == 1
    recorded.assert_called_once()


def test_redirect_never_receives_credentials(jev_transport, registry):
    install, _ = jev_transport
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(307, headers={"Location": "https://untrusted.invalid"})

    install(handler)
    assert decisions.decide_with_jev("hello", registry[:2], provider_config={}, budget={}).route is None
    assert len(calls) == 1


def test_disabled_missing_credentials_and_cap_prevent_network(monkeypatch, registry):
    network = Mock(side_effect=AssertionError("Must not make a request"))
    monkeypatch.setattr(decisions.httpx, "Client", network)
    key = Mock(return_value=None)
    monkeypatch.setattr(decisions, "resolve_provider_api_key", key)
    assert decisions.decide_with_jev("hello", registry[:2], provider_config={"enabled": False}, budget={}).status == "disabled"
    key.assert_not_called()
    assert decisions.decide_with_jev("hello", registry[:2], provider_config={}, budget={}).status == "missing_credentials"
    key.return_value = "fake"
    assert decisions.decide_with_jev("hello", registry[:2], provider_config={}, budget={"cost_cap_usd": 0}).status == "budget_limit"
    network.assert_not_called()


def test_runtime_wires_policy_limits_and_adapter(monkeypatch, registry, agent):
    from backend.domains.agent import workflow_setup as setup

    monkeypatch.setattr(setup, "load_registry", lambda: registry)
    monkeypatch.setattr(setup, "quality_scores", lambda: {})
    monkeypatch.setattr(setup, "current_routing_limits", lambda: ({}, {"cost_cap_usd": 10, "spent_usd": 8}))
    engine = Mock(return_value=Mock(side_effect=AssertionError("Only one affordable model")))
    monkeypatch.setattr(setup, "decision_selector", engine)
    profile = setup.ProfileSetup({}, {}, [], agent, "principal", None)
    result = setup._select_model_route(profile, llm_mode="agent_default", llm_provider=None,
                                       llm_model=None, user_message="hello",
                                       dependencies=SimpleNamespace(provider_is_available=lambda *_: True))
    assert result[:2] == ("alpha", "small")
    assert engine.call_args.args[2]["spent_usd"] == 8
    assert engine.call_args.args[0] == "jev"


@pytest.mark.parametrize("mode, expected_builds", [("pinned", 1), ("adaptive", 2), ("resilient", 2)])
def test_adaptive_routing_is_recomputed_for_each_turn(monkeypatch, agent, mode, expected_builds):
    from backend.domains.agent.routes import workflow

    agent["model_strategy"]["mode"] = mode
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(
        agent_cache={}, mcp_client=SimpleNamespace(), tools_list=[{"name": "ready"}],
    )))
    monkeypatch.setattr("backend.services.mcp_tool_contributions.refresh_mcp_tool_contributions", lambda *_: None)
    monkeypatch.setattr(workflow, "prepare_agent_runtime", lambda *_, **__: ({}, agent, None))
    builds = []

    async def create(*_, **kwargs):
        builds.append(kwargs["user_message"])
        return object(), {"provider": "alpha", "model": "small"}

    monkeypatch.setattr(workflow, "create_agent_workflow", create)

    async def run():
        await workflow.get_agent_workflow(request, "principal", user_message="hola")
        await workflow.get_agent_workflow(request, "principal", user_message="analitza aquesta arquitectura")

    asyncio.run(run())
    assert len(builds) == expected_builds


def test_decision_call_budget_reserves_capacity_for_the_answer(monkeypatch):
    from backend.services import agent_execution as execution

    reserve = Mock()
    monkeypatch.setattr(execution.store, "reserve_model_call", reserve)
    monkeypatch.setattr(execution, "revalidate_scope", lambda _: None)
    monkeypatch.setattr(execution, "current_scope", lambda: "test-scope")
    token = execution._run.set("test-run")
    limit = execution._call_limit.set(2)
    try:
        assert execution.reserve_decision_call() is True
        reserve.assert_called_once_with("test-scope", "test-run", 1)
        reserve.side_effect = RuntimeError("budget exhausted")
        assert execution.reserve_decision_call() is False
    finally:
        execution._run.reset(token)
        execution._call_limit.reset(limit)
