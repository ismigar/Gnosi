"""Provider refusals remain failed calls while raw accounting survives parsing."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import httpx
import pytest
from langchain_openai import ChatOpenAI
from openai import ContentFilterFinishReasonError

from backend.services import ai_usage_ledger as ledger
from backend.services import ai_usage_transport as transport


@pytest.fixture
def runtime(tmp_path, monkeypatch):
    from backend.agent import model_catalog, model_router
    from backend.services import ai_usage_openrouter

    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path))
    metadata = {key: "" for key in (
        "agent_id", "agent_name", "operation", "origin", "profile", "run_id",
        "workspace_id", "user_id",
    )}
    monkeypatch.setattr(ledger, "context_metadata", lambda: dict(metadata))
    monkeypatch.setattr(model_catalog, "catalog_model_cost", lambda *args: None)
    monkeypatch.setattr(model_router, "load_registry", lambda **kwargs: [
        {"provider": "openrouter", "model_id": "fixture", "profile": "expert"},
    ])
    scheduled = []
    monkeypatch.setattr(ai_usage_openrouter, "schedule", lambda *args: scheduled.append(args))
    token = transport._active.set(None)
    yield scheduled
    transport._active.reset(token)


def refusal_payload(with_usage):
    payload = {
        "id": "gen-refusal", "object": "chat.completion", "created": 1,
        "model": "actual-provider-model",
        "choices": [{"index": 0, "message": {
            "role": "assistant", "content": None, "refusal": "Provider declined",
        }, "finish_reason": "content_filter"}],
    }
    if with_usage:
        payload["usage"] = {
            "prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12,
            "cost": 0.0042,
        }
    return payload


def assert_failed_call(scheduled, with_usage):
    with ledger.connect() as db:
        calls = [dict(row) for row in db.execute("SELECT * FROM usage_calls")]
        generations = [dict(row) for row in db.execute("SELECT * FROM usage_generations")]
    assert len(calls) == len(generations) == 1
    call = calls[0]
    assert call["status"] == "failed"
    assert call["model_id"] == "actual-provider-model"
    assert generations[0]["generation_id"] == "gen-refusal"
    assert generations[0]["call_id"] == call["id"]
    assert call["input_tokens"] == (10 if with_usage else None)
    assert call["output_tokens"] == (2 if with_usage else None)
    assert call["cost_usd"] == ("0.0042" if with_usage else None)
    assert call["cost_source"] == ("reported" if with_usage else "unknown")
    assert scheduled == ([] if with_usage else [(call["id"], "gen-refusal", "fixture-key")])


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.parametrize("with_usage", [False, True])
def test_structured_refusal_retains_accounting(runtime, asynchronous, with_usage):
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(200, json=refusal_payload(with_usage))

    async def invoke_async():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            model = transport.instrument(ChatOpenAI(
                model="fixture", api_key="fixture-key", base_url="https://test.invalid",
                max_retries=0, http_async_client=client,
            ), "openrouter", "fixture")
            await model.bind(response_format={"type": "json_object"}).ainvoke("fixture")

    with pytest.raises(ContentFilterFinishReasonError):
        if asynchronous:
            asyncio.run(invoke_async())
        else:
            with httpx.Client(transport=httpx.MockTransport(respond)) as client:
                model = transport.instrument(ChatOpenAI(
                    model="fixture", api_key="fixture-key", base_url="https://test.invalid",
                    max_retries=0, http_client=client,
                ), "openrouter", "fixture")
                model.bind(response_format={"type": "json_object"}).invoke("fixture")
    assert len(requests) == 1
    assert_failed_call(runtime, with_usage)


@pytest.mark.parametrize("source", ["completion", "response"])
def test_error_metadata_recovery_uses_pending_run_without_active_context(runtime, source):
    callback = transport.UsageCallback("openrouter", "fixture", "fixture-key")
    callback.on_chat_model_start({}, [], run_id="refused")
    error = ContentFilterFinishReasonError()
    payload = refusal_payload(False)
    setattr(error, source, payload if source == "completion" else httpx.Response(200, json=payload))
    original_attributes = vars(error).copy()
    transport._active.set(None)
    callback.on_llm_error(error, run_id="refused")
    callback.on_llm_error(error, run_id="refused")
    assert vars(error) == original_attributes
    assert_failed_call(runtime, False)


def test_usage_less_chunks_preserve_earlier_identity():
    state = {"model": "configured", "raw_usage": {}}
    transport.observe({"id": "gen-first", "model": "actual"}, state=state)
    transport.observe({"id": "", "model": "", "usage": {"prompt_tokens": 7}}, state=state)
    transport.observe({"usage": None}, state=state)
    assert state["generation_id"] == "gen-first"
    assert state["actual_model"] == "actual"
    assert state["raw_usage"] == {"prompt_tokens": 7}


def test_raw_observation_never_consumes_live_body():
    class LiveBody:
        is_stream_consumed = False

        def json(self):
            pytest.fail("A live response body must not be read for accounting")

    original_error = ContentFilterFinishReasonError()

    def parse():
        raise original_error

    raw = SimpleNamespace(http_response=LiveBody(), parse=parse)
    observed = transport._observed_result(raw)
    assert isinstance(observed, transport.ObservedResource)
    with pytest.raises(ContentFilterFinishReasonError) as raised:
        observed.parse()
    assert raised.value is original_error
