"""Exercise Flex/cache on the actual SDK boundary and conservative money holds."""
from __future__ import annotations

import asyncio
from decimal import Decimal
import json
from types import SimpleNamespace

import httpx
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
import pytest

from backend.domains.agent.structured_output import constrain_output
from backend.services import ai_usage_ledger as ledger, reading_budget
from backend.services.ai_usage_transport import instrument
from backend.services.openai_usage_pricing import measured
from backend.services.reading_performance import MODEL, prepare


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    from backend.config import app_config
    from backend.agent import model_catalog, model_router
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(app_config, "load_params", lambda **kwargs: SimpleNamespace(paths={}, get=lambda *a: None))
    monkeypatch.setattr(ledger, "context_metadata", lambda: dict(agent_id="test", agent_name="", operation="",
        origin="", run_id="", workspace_id="", user_id="", profile=""))
    monkeypatch.setattr(model_catalog, "catalog_model_cost", lambda *a: {"cost_in": 2, "cost_out": 10})
    monkeypatch.setattr(model_router, "load_registry", lambda **kw: [])


def source(passage="Quotation: A \\\"B\\\"; ètica.\nSecond line."):
    return {"operation": "knowledge.process-source.phase", "input": json.dumps({
        "reading_engine": "semantic", "phase": "interpret", "chunks": [{"text": passage}],
        "global_map": "A shared map with caveats", "instruction": "Retain every qualification",
        "available_originals": [{"text": passage, "page": 281}], "unknown_future_field": [1, 2]}),
        "data": {}, "options": {}, "language": "ca", "sources": [], "output_schema": {"type": "object"}}


def text(blocks):
    return "".join(block["text"] for block in blocks)


def test_shared_prefix_is_stable_and_complete_values_are_lossless():
    model = ChatOpenAI(model=MODEL, api_key="fake", reasoning_effort="high")
    system = "Complete skill instruction. " * 300
    inputs = [source(), source("Another complete source ending.")]
    prefixes = []
    for payload in inputs:
        original = HumanMessage(content=json.dumps(payload))
        bound, messages = prepare(model, [SystemMessage(content=system), original])
        restored = json.loads(text(messages[1].content))
        assert json.loads(restored.pop("input")) == json.loads(payload["input"])
        assert restored == {key: value for key, value in payload.items() if key != "input"}
        assert text(messages[0].content) == system
        assert original.content == json.dumps(payload)
        assert bound.kwargs["service_tier"] == "flex"
        assert bound.bound.reasoning_effort == "high"
        prefixes.append(messages[1].content[0])
    assert prefixes[0] == prefixes[1]
    assert "Another complete" not in prefixes[1]["text"]


def test_transport_selection_is_not_exposed_as_a_different_reading_instruction():
    from backend.services.agent_behavior import operation_input
    from backend.services.agent_execution_models import AgentOperation
    request = AgentOperation(skill_id="knowledge", operation="knowledge.process-source.phase",
        input="Complete original", options={"reading_prose": True, "reading_performance": False, "reading_review_notes": 10})
    baseline = operation_input(request)
    optimized = operation_input(request.model_copy(update={"options": {**request.options, "reading_performance": True}}))
    assert baseline == optimized
    assert json.loads(baseline)["options"] == {"reading_prose": True}


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.parametrize("responses", [False, True])
@pytest.mark.parametrize("reported_zero", [False, True])
def test_sdk_preserves_schema_and_sends_flex_breakpoints_and_prices_returned_usage(asynchronous, responses, reported_zero, monkeypatch):
    requests = []
    def respond(request):
        requests.append(json.loads(request.content))
        response = {"id": "chatcmpl-proof", "object": "chat.completion", "created": 1,
            "model": MODEL, "service_tier": "flex", "choices": [{"index": 0, "finish_reason": "stop",
            "message": {"role": "assistant", "content": '{"answer":"faithful"}'}}],
            "usage": {"prompt_tokens": 2000, "completion_tokens": 100, "total_tokens": 2100,
                "prompt_tokens_details": {"cached_tokens": 1024, "cache_write_tokens": 512},
                "completion_tokens_details": {"reasoning_tokens": 20}}}
        if reported_zero:
            response["usage"]["cost"] = 0
        if responses:
            response.update(id="resp-proof", object="response", created_at=1, status="completed",
                output=[{"id": "msg-proof", "type": "message", "role": "assistant", "status": "completed",
                    "content": [{"type": "output_text", "text": '{"answer":"faithful"}', "annotations": []}]}])
            response["usage"]["input_tokens"] = response["usage"].pop("prompt_tokens")
            response["usage"]["output_tokens"] = response["usage"].pop("completion_tokens")
            response["usage"]["input_tokens_details"] = response["usage"].pop("prompt_tokens_details")
            response["usage"]["output_tokens_details"] = response["usage"].pop("completion_tokens_details")
        return httpx.Response(200, json=response)
    schema = {"type": "object", "properties": {"answer": {"type": "string"}},
              "required": ["answer"], "additionalProperties": False}
    identifier = reading_budget.configure(.50)
    client = httpx.Client(transport=httpx.MockTransport(respond))
    async_client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
    def construct(**kwargs):
        kwargs.setdefault("use_responses_api", responses)
        return ChatOpenAI(http_client=client, http_async_client=async_client, **kwargs)
    monkeypatch.setattr("langchain_openai.ChatOpenAI", construct)
    from backend.domains.agent.llm import get_llm
    model = get_llm(provider="openai", model=MODEL, api_key="fake", timeout=120,
                    reasoning_effort="high" if responses else None).bind(max_tokens=16384)
    model = constrain_output(model, "openai", schema)
    model, messages = prepare(model, [SystemMessage(content="All skill text. " * 600),
                                      HumanMessage(content=json.dumps(source()))])
    with reading_budget.session(identifier):
        result = asyncio.run(model.ainvoke(messages)) if asynchronous else model.invoke(messages)
    assert "faithful" in (text(result.content) if isinstance(result.content, list) else result.content)
    assert len(requests) == 1
    sent = requests[0]
    assert sent["service_tier"] == "flex"
    assert sent["prompt_cache_options"] == {"mode": "explicit", "ttl": "30m"}
    if responses:
        assert sent["reasoning"]["effort"] == "high"
        assert sent["text"]["format"]["strict"] is True
        messages = sent["input"]
    else:
        assert sent["response_format"]["json_schema"]["strict"] is True
        messages = sent["messages"]
    assert messages[0]["content"][0]["prompt_cache_breakpoint"] == {"mode": "explicit"}
    assert json.loads(text(messages[1]["content"]))["operation"] == "knowledge.process-source.phase"
    with ledger.connect() as db:
        row = dict(db.execute("SELECT * FROM usage_calls").fetchone())
        pricing = json.loads(db.execute("SELECT details FROM usage_pricing").fetchone()[0])
    expected = ((Decimal(464) + Decimal(1024)*Decimal(".05") + Decimal(512)*Decimal("1.25"))*2 + 100*10)/2/1_000_000
    assert Decimal(pricing["cost_usd"]) == expected
    assert Decimal(row["cost_usd"]) == (0 if reported_zero else expected)
    assert row["cost_source"] == ("reported" if reported_zero else "estimated")
    assert row["cached_tokens"] == 1024 and pricing["cache_write_tokens"] == 512
    budget = reading_budget.status(identifier)
    assert budget["spent_usd"] == 0  # A measured tariff estimate is not an invoice.
    assert budget["reserved_usd"] == .0033  # Confirmed Flex, all input as writes, +10%.
    assert pricing["billing_confirmed"] is False
    client.close()
    asyncio.run(async_client.aclose())


@pytest.mark.parametrize("change", ["missing_writes", "unknown_tier", "invalid_counts", "other_model", "new_tariff", "long_ttl"])
def test_incomplete_or_unknown_accounting_does_not_release_holds(change):
    usage = {"input_tokens_details": {"cached_tokens": 100, "cache_write_tokens": 200}}
    args = dict(provider="openai", model=MODEL, tokens={"input_tokens": 1000, "output_tokens": 100},
                usage=usage, rates={"cost_in": 2, "cost_out": 10}, tier="flex", options={"ttl": "30m"})
    if change == "missing_writes": del usage["input_tokens_details"]["cache_write_tokens"]
    if change == "unknown_tier": args["tier"] = "auto"
    if change == "invalid_counts": usage["input_tokens_details"]["cached_tokens"] = 1001
    if change == "other_model": args["model"] = "gpt-6-luna"
    if change == "new_tariff": args["rates"]["cost_in"] = 3
    if change == "long_ttl": args["options"]["ttl"] = "12h"
    assert measured(**args) is None


def test_cache_write_premium_is_reserved_before_transport_and_cap_stops_call():
    calls = []
    model = instrument(ChatOpenAI(model=MODEL, api_key="fake", max_tokens=16384,
        http_client=httpx.Client(transport=httpx.MockTransport(lambda req: calls.append(req)))), "openai", MODEL)
    model, messages = prepare(model, [SystemMessage(content="Source reading"), HumanMessage(content=json.dumps(source()))])
    with reading_budget.session(reading_budget.configure(.001)), pytest.raises(reading_budget.ReadingBudgetError):
        model.invoke(messages)
    assert calls == []


def test_long_context_surcharge_and_nonzero_hold_are_preserved():
    result = measured("openai", MODEL, {"input_tokens": 300000, "output_tokens": 1000},
        {"input_tokens_details": {"cached_tokens": 200000, "cache_write_tokens": 50000}},
        {"cost_in": 2, "cost_out": 10}, "flex", {"ttl": "30m"})
    assert Decimal(result["cost_usd"]) == Decimal(".2525")
    assert Decimal(result["reservation_bound_usd"]) == Decimal(".83325")


@pytest.mark.parametrize("url,extra", [("https://proxy.invalid/v1", None),
    ("https://api.openai.com/v1", {"service_tier": "default"}),
    ("https://api.openai.com/v1", {"max_output_tokens": 128000})])
def test_flex_cannot_price_a_proxy_or_body_override(url, extra):
    model = ChatOpenAI(model=MODEL, api_key="fake", base_url=url, extra_body=extra)
    with pytest.raises(ValueError):
        prepare(model, [SystemMessage(content="Instructions"), HumanMessage(content=json.dumps(source()))])


def test_explicit_flex_reserves_its_tariff_and_keeps_atomic_ceiling():
    identifier = reading_budget.configure(.5)
    with reading_budget.session(identifier):
        for call in ("one", "two", "three", "four", "five"):
            reading_budget.reserve(call, "source", {"max_tokens": 16384, "service_tier": "flex"},
                                   {"cost_in": 2, "cost_out": 10}, "openai", MODEL)
        with pytest.raises(reading_budget.ReadingBudgetError):
            reading_budget.reserve("six", "source", {"max_tokens": 16384, "service_tier": "flex"},
                                   {"cost_in": 2, "cost_out": 10}, "openai", MODEL)
    assert 0 < reading_budget.status(identifier)["reserved_usd"] <= .5
