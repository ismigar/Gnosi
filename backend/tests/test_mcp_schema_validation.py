"""MCP contracts retain schemas and validate exact JSON values before dispatch."""
import asyncio
from copy import deepcopy

import pytest
from jsonschema import ValidationError
from langchain_core.utils.function_calling import convert_to_openai_tool

from backend.agent.tools import bind_model_tools, create_mcp_tool, get_mcp_tools, provider_tool_definitions


class Client:
    def __init__(self):
        self.calls = []

    async def call_server_tool(self, server, name, args):
        self.calls.append((server, name, args))
        return args


SCHEMA = {
    "type": "object", "additionalProperties": False,
    "$defs": {"record": {"type": "object", "additionalProperties": False,
        "properties": {"kind": {"enum": ["page", "table"]},
            "count": {"type": "integer", "minimum": 1},
            "label": {"type": "string", "pattern": "^[a-z]+$"}},
        "required": ["kind", "count"]}},
    "properties": {"records": {"type": "array", "minItems": 1,
        "items": {"$ref": "#/$defs/record"}}, "limit": {"type": "integer"}},
    "required": ["records"],
}


def tool(client, schema=None):
    return create_mcp_tool({"name": "save", "description": "Save records",
        "inputSchema": deepcopy(SCHEMA if schema is None else schema)}, client, server_name="test")


def test_model_receives_complete_schema_and_optional_values_remain_absent():
    client = Client()
    handler = tool(client)
    assert handler.args_schema == SCHEMA
    advertised = convert_to_openai_tool(provider_tool_definitions([handler])[0])["function"]["parameters"]
    assert advertised == SCHEMA
    args = {"records": [{"kind": "page", "count": 2}]}
    assert asyncio.run(handler.ainvoke(args)) == args
    assert client.calls == [("test", "save", args)]
    assert "limit" not in client.calls[0][2]


@pytest.mark.parametrize("args", [
    {}, {"records": []}, {"records": [{"kind": "unknown", "count": 1}]},
    {"records": [{"kind": "page", "count": "1"}]},
    {"records": [{"kind": "page", "count": True}]},
    {"records": [{"kind": "page", "count": 0}]},
    {"records": [{"kind": "page", "count": 1, "extra": 2}]},
    {"records": [{"kind": "page", "count": 1, "label": "UPPER"}]},
    {"records": [{"kind": "page", "count": 1}], "extra": 1},
    {"records": [{"kind": "page", "count": 1}], "limit": None},
])
def test_invalid_arguments_never_reach_connector(args):
    client = Client()
    with pytest.raises(ValidationError):
        asyncio.run(tool(client).ainvoke(args))
    assert client.calls == []


def test_remote_references_cannot_trigger_network_access():
    client = Client()
    with pytest.raises(ValueError, match="local references"):
        tool(client, {"type": "object", "properties": {
            "value": {"$ref": "https://example.invalid/schema.json"}}})
    assert client.calls == []


def test_malformed_schema_does_not_remove_valid_tools():
    definitions = [{"name": "invalid", "inputSchema": {"type": "unknown"}},
        {"name": "valid", "description": "Valid", "inputSchema": SCHEMA}]
    assert [value.name for value in get_mcp_tools(definitions, Client())] == ["valid"]


@pytest.mark.parametrize("value", [{"hidden"}, (1, 2), float("nan"), {1: "value"}])
def test_non_json_values_do_not_reach_connector(value):
    client = Client()
    handler = tool(client, {"type": "object", "properties": {"value": {}}})
    with pytest.raises((ValueError, ValidationError)):
        asyncio.run(handler.ainvoke({"value": value}))
    assert client.calls == []


RECURSIVE_SCHEMA = {
    "type": "object", "$defs": {"node": {"type": "object",
        "properties": {"value": {"type": "integer"}, "child": {"$ref": "#/$defs/node"}},
        "required": ["value"], "additionalProperties": False}},
    "properties": {"node": {"$ref": "#/$defs/node"}},
    "required": ["node"], "additionalProperties": False,
}


def test_actual_provider_binding_preserves_recursive_contract():
    from jsonschema import Draft202012Validator
    from langchain_openai import ChatOpenAI
    client = Client()
    handler = tool(client, RECURSIVE_SCHEMA)
    # bind_tools performs the real provider conversion; no network/model call.
    bound = bind_model_tools(ChatOpenAI(model="gpt-4o", api_key="test-not-a-real-key"), [handler])
    advertised = bound.kwargs["tools"][0]["function"]["parameters"]
    assert advertised == RECURSIVE_SCHEMA
    bad = {"node": {"value": 1, "child": {"value": "wrong"}}}
    good = {"node": {"value": 1, "child": {"value": 2}}}
    assert not Draft202012Validator(advertised).is_valid(bad)
    assert Draft202012Validator(advertised).is_valid(good)
    with pytest.raises(ValidationError):
        asyncio.run(handler.ainvoke(bad))
    assert client.calls == []


def test_json_transport_preserves_recursive_contract():
    from backend.agent.json_tool_model import JsonToolModel
    handler = tool(Client(), RECURSIVE_SCHEMA)
    bound = JsonToolModel(object()).bind_tools([handler])
    assert bound.schemas[0]["parameters"] == RECURSIVE_SCHEMA


@pytest.mark.parametrize("reference", ["#/$defs/missing", "#missingAnchor", "#/properties/not-a-schema/type"])
def test_dangling_local_refs_are_isolated_before_binding(reference):
    schema = {"type": "object", "properties": {
        "value": {"$ref": reference}, "not-a-schema": {"type": "string"}}}
    definitions = [{"name": "bad", "inputSchema": schema},
        {"name": "good", "inputSchema": RECURSIVE_SCHEMA}]
    with pytest.raises(ValueError, match="MCP.*reference"):
        create_mcp_tool(definitions[0], Client())
    handlers = get_mcp_tools(definitions, Client())
    assert [handler.name for handler in handlers] == ["good"]
    assert convert_to_openai_tool(provider_tool_definitions(handlers)[0])["function"]["parameters"] == RECURSIVE_SCHEMA


def test_local_anchor_refs_and_example_data_are_valid():
    schema = {"type": "object", "$defs": {
        "value": {"$anchor": "value", "type": "integer"}},
        "properties": {"value": {"$ref": "#value"}},
        "examples": [{"literal": {"$ref": "https://example.invalid/not-a-schema-ref"}}]}
    handler = tool(Client(), schema)
    assert asyncio.run(handler.ainvoke({"value": 1})) == {"value": 1}



def test_conversation_graph_binds_exact_recursive_mcp_schema(monkeypatch):
    from langchain_core.messages import HumanMessage
    from backend.models.agent_skills import CatalogOrigin, OriginType, ToolDescriptor
    from backend.tests.test_agent_skill_runtime import RecordingLlm, _agent, _runtime, _workflow

    class Provider(RecordingLlm):
        def __init__(self):
            super().__init__()
            self.advertised = []

        def bind_tools(self, tools, **kwargs):
            self.advertised.extend(convert_to_openai_tool(item) for item in tools)
            return super().bind_tools(tools, **kwargs)

    handler = create_mcp_tool({'name': 'tree', 'description': 'Read tree',
        'inputSchema': RECURSIVE_SCHEMA}, Client(), exposed_name='mcp_s_tree', server_name='s')
    descriptor = ToolDescriptor(id='mcp.s.tree', name='Tree',
        origin=CatalogOrigin(type=OriginType.MCP, id='s'), input_schema=RECURSIVE_SCHEMA)
    llm = Provider()
    graph, _ = _workflow(monkeypatch, _agent(skill_ids=['user.tree']),
        _runtime(assigned=('user.tree',), active=('user.tree',), tools=(handler,), descriptors=(descriptor,)), llm)
    graph.compile().invoke({'messages': [HumanMessage(content='Read the tree')],
        'active_skill_ids': ['user.tree'], 'current_user_role': 'owner',
        'turn_authorized_tool_names': ['mcp_s_tree'],
        'turn_plan': {'allowed_tool_names': ['mcp_s_tree']}})
    advertised = [item['function']['parameters'] for item in llm.advertised
        if item['function']['name'] == 'mcp_s_tree']
    assert advertised and all(schema == RECURSIVE_SCHEMA for schema in advertised)
