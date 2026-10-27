"""Exercise malformed provider envelopes through the pinned SDK's real parser."""
from __future__ import annotations

import asyncio
from copy import deepcopy
import importlib
import json
from types import SimpleNamespace

from langchain_openai import ChatOpenAI
from openai import InternalServerError
import pytest

from backend.domains.agent.structured_output import constrain_output
from backend.services import openrouter_response_validation as validation

SCHEMA = {"type": "object", "properties": {"ok": {"type": "boolean"}},
          "required": ["ok"], "additionalProperties": False}
VALID = {"id": "gen-valid", "object": "chat.completion", "created": 1, "model": "fixture",
         "choices": [{"index": 0, "finish_reason": "stop", "message": {
             "role": "assistant", "content": '{"ok":true}'}}]}


@pytest.fixture
def events(monkeypatch):
    from backend.services import agent_execution_trace, ai_usage_transport
    records = []
    monkeypatch.setattr(agent_execution_trace, "record", lambda kind, value: records.append((kind, value)))
    monkeypatch.setattr(ai_usage_transport, "observe", lambda value: None)
    # Retry counts, request identity and response handling use the actual SDK;
    # omit only wall-clock backoff from these network-free transport tests.
    from openai import _base_client
    monkeypatch.setattr(_base_client.BaseClient, "_calculate_retry_timeout", lambda *args, **kwargs: 0)
    return records


def invoke(library, asynchronous, payloads, *, retries=2, headers=None):
    http = importlib.import_module(library)
    sent = []
    def respond(request):
        sent.append(request)
        payload = payloads[min(len(sent) - 1, len(payloads) - 1)]
        if payload is None:
            return http.Response(200, content=b"null", headers={"content-type": "application/json", **(headers or {})})
        if isinstance(payload, dict) and "_raw_invalid_json" in payload:
            return http.Response(200, content=payload["_raw_invalid_json"].encode(),
                                 headers={"content-type": "application/json", **(headers or {})})
        return http.Response(200, json=deepcopy(payload), headers=headers)
    def prepared(client):
        kwargs = {"http_async_client" if asynchronous else "http_client": client}
        model = ChatOpenAI(model="fixture", api_key="fixture", base_url="https://openrouter.invalid/api/v1",
                           max_retries=retries, timeout=12, extra_body={"provider": {
                               "order": ["xiaomi"], "allow_fallbacks": False}}, **kwargs)
        validation.install(model)
        validation.install(model)
        assert len([hook for hook in client.event_hooks["response"] if hasattr(hook, "_gnosi_endpoint")]) == 1
        return constrain_output(model, "openrouter", SCHEMA)
    async def run():
        async with http.AsyncClient(transport=http.MockTransport(respond)) as client:
            return await prepared(client).ainvoke("fixture")
    try:
        if asynchronous:
            result = asyncio.run(run())
        else:
            with http.Client(transport=http.MockTransport(respond)) as client:
                result = prepared(client).invoke("fixture")
        return result, sent
    except Exception as error:
        error.test_requests = sent
        raise


@pytest.mark.parametrize("library", ["httpx", "httpx2"])
@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.parametrize("bad", [None, "Invalid envelope", [None], {"_raw_invalid_json": "<html>unavailable</html>"}, {"id": "gen-null", "choices": None}, {"choices": []}, {}, {"choices": [None]},
    {"choices": [{"index": 0, "message": None, "finish_reason": "stop"}]},
    {"choices": [{"message": {"role": "assistant", "content": ["invalid"]}}]},
    {"choices": [{"message": {"role": "assistant", "content": None, "tool_calls": [None]}}]},
    {"error": {"code": 502, "message": "temporarily unavailable"}, "choices": None},
    {"error": {"code": 408, "message": "temporarily unavailable"}, "choices": None},
    {"error": {"code": 503, "message": "temporarily unavailable"}, "choices": None}])
def test_malformed_reply_uses_existing_sdk_retry_and_identical_payload(events, library, asynchronous, bad):
    result, sent = invoke(library, asynchronous, [bad, VALID])
    assert result.content == '{"ok":true}'
    assert len(sent) == 2 and sent[0].content == sent[1].content
    assert [request.headers["x-stainless-retry-count"] for request in sent] == ["0", "1"]
    body = json.loads(sent[0].content)
    assert body["provider"] == {"order": ["xiaomi"], "allow_fallbacks": False, "require_parameters": True}
    assert body["response_format"]["json_schema"]["schema"] == SCHEMA
    assert events[0][0] == "provider.response_invalid"
    assert events[0][1]["upstream_http_status"] == 200
    assert events[0][1]["normalized_sdk_status"] == 502


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.parametrize("retries,expected", [(0, 1), (2, 3)])
def test_exhaustion_keeps_configured_attempt_limit(events, asynchronous, retries, expected):
    with pytest.raises(InternalServerError) as caught:
        invoke("httpx2", asynchronous, [{"id": "gen-null", "choices": None}], retries=retries)
    assert len(caught.value.test_requests) == expected
    assert caught.value.response.headers["x-gnosi-upstream-http-status"] == "200"
    assert caught.value.body == {"id": "gen-null", "choices": None}


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.parametrize("payload,headers", [
    ({"error": {"code": 402, "message": "insufficient credit"}}, {}),
    ({**VALID, "error": {"code": 402, "message": "insufficient credit"}}, {}),
    ({**VALID, "refusal": "declined"}, {}),
    ({**VALID, "choices": [{"index": 0, "finish_reason": "stop", "message": {
        "role": "assistant", "content": '{"ok":true}', "refusal": "declined"}}]}, {}),
    ({"error": {"code": 429, "type": "insufficient_quota"}}, {}),
    ({"error": {"code": 502, "metadata": {"provider_error_code": "insufficient_quota"}}}, {}),
    ({"error": {"code": 503, "metadata": {"provider_error_code": 403}}}, {}),
    ({"error": {"code": 502, "message": "content filter"}, "choices": None}, {}),
    ({"choices": None, "refusal": "declined"}, {}),
    ({"choices": None, "native_finish_reason": "content_filter"}, {}),
    ({"choices": None, "usage": {"prompt_tokens": 10, "completion_tokens": 2}}, {}),
    ({"choices": None}, {"x-should-retry": "false"}),
    ({"choices": None}, {"retry-after": "121"}),
    ({"choices": None}, {"retry-after-ms": "NaN"}),
    ({"choices": None}, {"retry-after": "Infinity"}),
    ("Insufficient credits", {}),
    ([{"usage": {"prompt_tokens": 2}}], {}),
    ([{"refusal": "declined"}], {}),
    ({"error": {"code": 429, "message": "Rate limit exceeded"}, "choices": None}, {"x-ratelimit-limit-req-minute": "0"}),
    ({"error": {"code": 429, "message": "Quota exceeded. Insufficient credits"}, "choices": None}, {}),
])
def test_terminal_envelopes_never_retry_or_become_content(events, asynchronous, payload, headers):
    with pytest.raises(validation.ProviderResponseError) as caught:
        invoke("httpx2", asynchronous, [payload, VALID], headers=headers)
    assert len(caught.value.test_requests) == 1
    assert caught.value.response.status_code == 200 and caught.value.body == payload
    assert events[0][1]["normalized_sdk_status"] is None


def test_hook_never_buffers_streams_or_other_endpoints():
    def response(url, body):
        return SimpleNamespace(status_code=200, headers={"content-type": "application/json"},
            request=SimpleNamespace(url=url, content=json.dumps(body).encode()))
    endpoint = ("https", "openrouter.invalid", "/api/v1/chat/completions")
    assert not validation._eligible(response("https://openrouter.invalid/api/v1/chat/completions", {"stream": True}), endpoint)
    assert not validation._eligible(response("https://elsewhere.invalid/api/v1/chat/completions", {}), endpoint)
    assert not validation._eligible(response("https://openrouter.invalid/api/v1/responses", {}), endpoint)


def test_instrumentation_preserves_clients_and_installs_only_for_openrouter(monkeypatch):
    from backend.services.ai_usage_transport import instrument
    model = ChatOpenAI(model="fixture", api_key="fixture")
    clients = [model.root_client._client, model.root_async_client._client]
    instrument(model, "other", "fixture")
    assert not any(getattr(h, "_gnosi_endpoint", None) for c in clients for h in c.event_hooks["response"])
    instrument(model, "openrouter", "fixture")
    assert clients == [model.root_client._client, model.root_async_client._client]
    assert all(any(getattr(h, "_gnosi_endpoint", None) for h in c.event_hooks["response"]) for c in clients)


@pytest.mark.parametrize("asynchronous", [False, True])
def test_full_supported_sdk_cooldown_window_is_preserved(events, asynchronous):
    result, sent = invoke("httpx2", asynchronous, [{"choices": None}, VALID], headers={"retry-after": "90"})
    assert result.content == '{"ok":true}' and len(sent) == 2
    assert events[0][1]["retry_after_seconds"] == 90


def test_local_diagnostic_failure_is_terminal_not_a_connection_retry(events, monkeypatch):
    from backend.services import agent_execution_trace
    def fail(*args):
        raise TypeError("Synthetic local diagnostic defect")
    monkeypatch.setattr(agent_execution_trace, "record", fail)
    with pytest.raises(validation.ProviderResponseError, match="diagnostics_failed") as caught:
        invoke("httpx2", False, [{"choices": None}, VALID])
    assert len(caught.value.test_requests) == 1 and isinstance(caught.value.__cause__, TypeError)


def test_ordinary_chat_refusal_keeps_native_behavior(events):
    import httpx2
    payload = {**VALID, "choices": [{"index": 0, "finish_reason": "stop", "message": {
        "role": "assistant", "content": "I cannot help with that request.", "refusal": "declined"}}]}
    sent = []
    def respond(request):
        sent.append(request)
        return httpx2.Response(200, json=payload)
    with httpx2.Client(transport=httpx2.MockTransport(respond)) as client:
        model = ChatOpenAI(model="fixture", api_key="fixture", max_retries=0,
            base_url="https://openrouter.invalid/api/v1", http_client=client)
        validation.install(model)
        result = model.invoke("fixture")
    assert result.content == "I cannot help with that request." and len(sent) == 1 and events == []
