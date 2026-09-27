"""Check the actual provider payload, including existing tools and routing policy."""
import json

import httpx
import pytest
from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI

from backend.domains.agent.structured_output import constrain_output
from backend.domains.llm_wiki.directed_reading import ACTION_SCHEMA


def test_schema_reaches_provider_and_preserves_tools_routing_and_reasoning():
    requests = []
    def respond(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json={
            "id": "fixture", "model": "fixture", "object": "chat.completion",
            "choices": [{"index": 0, "finish_reason": "stop", "message": {
                "role": "assistant", "content": '{"action":"index","arguments":{}}',
            }}],
        })
    original_extra = {"provider": {"order": ["fixture"], "allow_fallbacks": False},
                      "reasoning": {"effort": "low"}}
    with httpx.Client(transport=httpx.MockTransport(respond)) as transport:
        model = ChatOpenAI(model="fixture", api_key="fixture", max_retries=0,
                           base_url="https://openrouter.invalid/api/v1", http_client=transport,
                           extra_body=original_extra)
        with_tools = model.bind_tools([{"type": "function", "function": {
            "name": "help", "strict": True, "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        }}]).bind(extra_body={"provider": {"ignore": ["excluded"]}})
        constrained = constrain_output(with_tools, "openrouter", ACTION_SCHEMA)
        response = constrained.invoke([HumanMessage(content="Return one JSON action.")])
    assert json.loads(response.content)["action"] == "index"
    assert len(requests) == 1
    payload = requests[0]
    assert payload["response_format"] == {"type": "json_schema", "json_schema": {
        "name": "gnosi_operation", "strict": True, "schema": ACTION_SCHEMA,
    }}
    assert payload["provider"] == {"order": ["fixture"], "allow_fallbacks": False,
                                   "ignore": ["excluded"], "require_parameters": True}
    assert payload["reasoning"] == {"effort": "low"}
    assert payload["tools"][0]["function"]["name"] == "help"
    assert "require_parameters" not in original_extra["provider"]
    assert "response_format" not in with_tools.kwargs


def test_responses_transport_receives_schema_in_its_native_format():
    model = ChatOpenAI(model="fixture", api_key="fixture", use_responses_api=True,
                       use_previous_response_id=False, store=False)
    constrained = constrain_output(model, "openrouter", ACTION_SCHEMA)
    payload = model._get_request_payload([HumanMessage(content="Return JSON")], **constrained.kwargs)
    assert payload["text"]["format"] == {
        "type": "json_schema", "name": "gnosi_operation", "strict": True, "schema": ACTION_SCHEMA,
    }
    assert payload["extra_body"]["provider"]["require_parameters"] is True
    assert payload["store"] is False


def test_generic_object_contract_uses_json_mode_without_inventing_fields():
    model = ChatOpenAI(model="fixture", api_key="fixture")
    constrained = constrain_output(model, "openrouter", {"type": "object"})
    assert constrained.kwargs["response_format"] == {"type": "json_object"}
    assert constrained.kwargs["extra_body"]["provider"]["require_parameters"] is True


@pytest.mark.parametrize("provider,schema", [("other", ACTION_SCHEMA), ("openrouter", None)])
def test_unstructured_calls_and_other_transports_are_unchanged(provider, schema):
    model = object()
    assert constrain_output(model, provider, schema) is model


def test_unsupported_binding_never_silently_weakens_the_requested_format():
    with pytest.raises(ValueError, match="cannot enforce"):
        constrain_output(object(), "openrouter", ACTION_SCHEMA)


def test_operation_graph_binds_schema_after_optional_tools(monkeypatch):
    from backend.domains.agent import operation_graph
    from backend.domains.agent.team_help import TeamHelp
    requests = []
    def respond(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json={
            "id": "fixture", "model": "fixture", "object": "chat.completion",
            "choices": [{"index": 0, "finish_reason": "stop", "message": {
                "role": "assistant", "content": '{"action":"index","arguments":{}}',
            }}],
        })
    monkeypatch.setattr(operation_graph, "_invoke_agent_model", lambda model, messages, state: model.invoke(messages))
    with httpx.Client(transport=httpx.MockTransport(respond)) as transport:
        model = ChatOpenAI(model="fixture", api_key="fixture", max_retries=0,
                           base_url="https://openrouter.invalid/api/v1", http_client=transport)
        graph = operation_graph.operation_workflow(model, "Return JSON", 32000,
            team_help=TeamHelp({}, True), provider="openrouter", output_schema=ACTION_SCHEMA).compile()
        for help_allowed in [True, False]:
            result = graph.invoke({"messages": [HumanMessage(content="Return JSON")],
                                   "team_help_allowed": help_allowed})
            assert json.loads(result["messages"][-1].content)["action"] == "index"
    assert requests[0]["tools"][0]["function"]["strict"] is True
    assert "tools" not in requests[1]
    assert all(r["response_format"]["json_schema"]["schema"] == ACTION_SCHEMA for r in requests)


def test_fallback_tool_transport_keeps_its_protocol_and_validates_final_answer():
    from backend.agent.json_tool_model import JsonToolModel
    from backend.domains.agent.team_help import HELP_TOOL
    requests = []
    def respond(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json={
            "id": "fixture", "model": "fixture", "object": "chat.completion",
            "choices": [{"index": 0, "finish_reason": "stop", "message": {
                "role": "assistant", "content": json.dumps({"action": "finish", "text":
                    '{"action":"index","arguments":{}}'}),
            }}],
        })
    with httpx.Client(transport=httpx.MockTransport(respond)) as transport:
        model = ChatOpenAI(model="fixture", api_key="fixture", max_retries=0,
                           base_url="https://openrouter.invalid/api/v1", http_client=transport)
        wrapped = JsonToolModel(model).bind_tools([HELP_TOOL])
        constrained = constrain_output(wrapped, "openrouter", ACTION_SCHEMA)
        response = constrained.invoke([HumanMessage(content="Return JSON")])
    assert json.loads(response.content) == {"action": "index", "arguments": {}}
    assert constrained.schemas == wrapped.schemas
    assert requests[0]["response_format"] == {"type": "json_object"}
    assert requests[0]["provider"]["require_parameters"] is True
    unwrapped = constrain_output(JsonToolModel(model), "openrouter", ACTION_SCHEMA)
    assert unwrapped.model.kwargs["response_format"]["type"] == "json_schema"
