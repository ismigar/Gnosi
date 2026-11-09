"""Lossless draft references and native schemas behind a stable cache prefix."""
from copy import deepcopy
import asyncio
import json

import httpx
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
import pytest

from backend.domains.agent.structured_output import constrain_output
from backend.domains.llm_wiki.semantic_quote_contracts import reference_draft_quotes
from backend.services.reading_cache_transport import format_after_prefix
from backend.services.reading_performance import MODEL, prepare


def test_draft_reference_roundtrip_preserves_order_unicode_and_other_fields():
    quotes = {1: 'Una veu: "ètica".\n', 2: 'A qualification.', 3: 'Another author.'}
    note = {"title": "Distinct voices", "body_md": "Keep every caveat.",
            "quotes": [quotes[2], quotes[1], quotes[2]], "properties": {"x": ["A"]}}
    before = deepcopy(note)
    compact = reference_draft_quotes(note, quotes)
    assert compact["quote_ids"] == [2, 1, 2]
    restored = {key: value for key, value in compact.items() if key != "quote_ids"}
    restored["quotes"] = [quotes[number] for number in compact["quote_ids"]]
    assert restored == before and note == before


@pytest.mark.parametrize("quotes,literal", [
    ({1: "Repeated.", 2: "Repeated."}, "Repeated."),
    ({1: "Complete original."}, "original"),
])
def test_ambiguous_or_partial_draft_quote_remains_literal(quotes, literal):
    note = {"quotes": [literal], "title": "A note"}
    assert reference_draft_quotes(note, quotes) == note


def test_native_variable_schemas_leave_cached_prefix_identical_and_strict():
    base = ChatOpenAI(model=MODEL, api_key="fake", use_responses_api=True, reasoning_effort="high")
    original_client = base.root_client
    messages = [SystemMessage(content="Complete shared instruction. " * 300), HumanMessage(content="All originals.")]
    schemas = [{"type": "object", "properties": {name: {"type": "string"}},
                "required": [name], "additionalProperties": False} for name in ("first", "second")]
    prefixes = []
    for schema in schemas:
        bound, prepared = prepare(constrain_output(base, "openai", schema), messages)
        payload = bound.bound._get_request_payload(prepared, **bound.kwargs)
        before = deepcopy(payload)
        sent = format_after_prefix(payload)
        assert payload == before
        assert sent["text"]["format"] == {"type": "text"}
        assert sent["input"][1]["text"]["format"]["schema"] == schema
        assert sent["input"][1]["text"]["format"]["strict"] is True
        assert sent["input"][2:] == before["input"][1:]
        assert sent["reasoning"]["effort"] == "high" and sent["service_tier"] == "flex"
        prefixes.append((sent["text"], sent["input"][0]))
        assert bound.bound.root_client is not original_client
    assert prefixes[0] == prefixes[1]
    assert base.root_client is original_client
    assert isinstance(messages[0].content, str)


def test_format_update_does_not_touch_other_models_tiers_or_json_mode():
    original = {"model": MODEL, "service_tier": "flex", "input": [{"role": "system", "content": "Complete."}],
                "text": {"format": {"type": "json_schema", "strict": True, "schema": {"type": "object"}}}}
    for changed in ({"model": "other"}, {"service_tier": "default"},
                    {"text": {"format": {"type": "json_object"}}}, {"input": []}):
        payload = {**original, **changed}
        assert format_after_prefix(payload) == payload


def test_native_contract_deduplication_preserves_all_original_values_and_strict_schema():
    from backend.services.agent_behavior import operation_input
    from backend.services.agent_execution_models import AgentOperation
    schema = {"type": "object", "properties": {"answer": {"type": "string"}},
              "required": ["answer"], "additionalProperties": False}
    original = {"reading_engine": "semantic", "phase": "verify", "global_map": "A joint map.",
                "instruction": "Preserve caveats.", "notes": [{"text": 'Original "ètica".\nFull ending.'}]}
    request = AgentOperation(skill_id="knowledge", operation="knowledge.process-source.phase",
        input=json.dumps(original, ensure_ascii=False), data={"future": ["Keep exactly"]}, output_schema=schema)
    model = ChatOpenAI(model=MODEL, api_key="fake", use_responses_api=True, reasoning_effort="high")
    bound, messages = prepare(constrain_output(model, "openai", schema), [SystemMessage(content="All instructions."),
                               HumanMessage(content=operation_input(request))])
    before = bound.bound._get_request_payload(messages, **bound.kwargs)
    after = format_after_prefix(before)
    outgoing = json.loads("".join(block["text"] for block in after["input"][2]["content"]))
    assert "output_schema" not in outgoing
    outgoing["output_schema"] = after["input"][1]["text"]["format"]["schema"]
    expected = json.loads(operation_input(request))
    assert json.loads(outgoing.pop("input")) == json.loads(expected.pop("input")) == original
    assert outgoing == expected
    assert after["input"][2]["content"][0] == before["input"][1]["content"][0]


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.parametrize("surface", ["ordinary", "resource_raw", "root_raw", "root_streaming"])
def test_actual_sdk_raw_hierarchies_keep_the_exact_format_update(asynchronous, surface):
    from openai import OpenAI, AsyncOpenAI
    from backend.services.reading_cache_transport import _Client
    sent = []
    def respond(request):
        sent.append(json.loads(request.content))
        return httpx.Response(200, json={"id": "resp-synthetic", "object": "response", "created_at": 1,
                                       "status": "completed", "model": MODEL, "output": []})
    params = {"model": MODEL, "service_tier": "flex", "input": [{"role": "system", "content": "Complete instruction."},
        {"role": "user", "content": "Complete source."}], "text": {"format": {"type": "json_schema", "name": "reading",
        "strict": True, "schema": {"type": "object", "properties": {"answer": {"type": "string"}},
                                    "required": ["answer"], "additionalProperties": False}}}}
    def resource(client):
        wrapped = _Client(client)
        return {"ordinary": lambda: wrapped.responses, "resource_raw": lambda: wrapped.responses.with_raw_response,
                "root_raw": lambda: wrapped.with_raw_response.responses,
                "root_streaming": lambda: wrapped.with_streaming_response.responses}[surface]()
    async def run_async():
        async with AsyncOpenAI(api_key="fake", http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)), max_retries=0) as client:
            if surface == "root_streaming":
                async with resource(client).create(**params) as response: await response.parse()
            else:
                await resource(client).create(**params)
    if asynchronous:
        asyncio.run(run_async())
    else:
        with OpenAI(api_key="fake", http_client=httpx.Client(transport=httpx.MockTransport(respond)), max_retries=0) as client:
            if surface == "root_streaming":
                with resource(client).create(**params) as response: response.parse()
            else:
                resource(client).create(**params)
    assert len(sent) == 1
    assert sent[0]["text"]["format"] == {"type": "text"}
    assert sent[0]["input"][1]["text"]["format"] == params["text"]["format"]
