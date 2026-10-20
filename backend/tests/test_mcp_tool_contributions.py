"""MCP tools require read-only annotations before skills can reference them."""

import asyncio

import pytest
from pathlib import Path

from backend.services.context_vars import active_vault_path
from backend.services.agent_skill_catalog import get_tool_catalog
from backend.services.mcp_tool_contributions import (
    refresh_mcp_tool_contributions,
)


class _Client:
    async def call_server_tool(self, server, name, arguments):
        return {"server": server, "name": name, "arguments": arguments}


def test_only_annotated_read_only_mcp_tools_enter_governed_catalog(
    tmp_path: Path,
):
    token = active_vault_path.set(tmp_path)
    client = _Client()
    try:
        refresh_mcp_tool_contributions(
            [
                {
                    "server": "mail",
                    "name": "search_messages",
                    "description": "Search mail.",
                    "annotations": {"readOnlyHint": True},
                    "inputSchema": {
                        "type": "object",
                        "properties": {"query": {"type": "string"}},
                        "required": ["query"],
                    },
                },
                {
                    "server": "mail",
                    "name": "delete_message",
                    "annotations": {"destructiveHint": True},
                },
                {
                    "server": "legacy",
                    "name": "unknown_effect",
                },
            ],
            client,
            trusted_policies={("mail", "search_messages"): {
                "effects": ["read"], "minimum_role": "viewer", "confirmation": "none",
            }},
        )

        catalog = get_tool_catalog()
        descriptor = catalog.get("mcp.mail.search_messages")
        assert descriptor is not None
        assert [effect.value for effect in descriptor.effects] == ["read"]
        assert catalog.get("mcp.mail.delete_message") is None
        assert catalog.get("mcp.legacy.unknown_effect") is None

        handler = catalog.get_handler("mcp.mail.search_messages")
        result = asyncio.run(handler.ainvoke({"query": "invoice"}))
        assert result == {
            "server": "mail",
            "name": "search_messages",
            "arguments": {"query": "invoice"},
        }
    finally:
        refresh_mcp_tool_contributions([], None)
        active_vault_path.reset(token)


def test_hints_or_embedded_policy_cannot_authorize_tools():
    from backend.services.mcp_tool_contributions import _provider
    try:
        refresh_mcp_tool_contributions([
            {"server": "mail", "name": "read", "annotations": {"readOnlyHint": True}},
            {"server": "mail", "name": "write", "policy": {
                "effects": ["external_write"], "minimum_role": "editor", "confirmation": "always"}},
        ], _Client(), trusted_policies={})
        assert list(_provider()) == []
    finally:
        refresh_mcp_tool_contributions([], None)


def test_host_authorized_mcp_write_uses_existing_confirmation_flow(tmp_path, monkeypatch):
    import json
    from types import SimpleNamespace
    from backend.agent import action_confirmations as confirmations
    from backend.domains.agent.policy import _tool_policy_wrapper
    from backend.services.mcp_tool_contributions import _provider

    monkeypatch.setattr(confirmations, "_database_path", lambda: tmp_path / "confirmations.sqlite")
    scope = {"vault_scope": "vault", "workspace_id": "personal", "user_id": "user",
        "role": "editor", "agent_id": "agent", "session_id": "session"}
    try:
        refresh_mcp_tool_contributions([{"server": "mail", "name": "save_draft",
            "inputSchema": {"type": "object", "properties": {"body": {"type": "string"}},
                "required": ["body"], "additionalProperties": False}}], _Client(),
            trusted_policies={("mail", "save_draft"): {"effects": ["external_write"],
                "minimum_role": "editor", "confirmation": "always"}})
        registration, = _provider()
        descriptor = registration.descriptor
        handler = registration.handler
        wrapper = _tool_policy_wrapper({handler.name: {
            "minimum_role": descriptor.minimum_role, "confirmation": descriptor.confirmation.value,
            "_descriptor": descriptor,
        }})
        calls = []
        request = SimpleNamespace(tool_call={"id": "call-1", "name": handler.name,
            "args": {"body": "exact draft"}}, state={"current_user_role": "viewer"})
        assert wrapper(request, lambda _: calls.append(True)).status == "error"
        request.state = {"current_user_role": "editor", "active_skill_ids": ["user.mail"]}
        with confirmations.confirmation_context(**scope):
            request.tool_call["args"] = {"body": "exact draft", "extra": "not allowed"}
            assert wrapper(request, lambda _: calls.append(True)).status == "error"
            assert confirmations.list_confirmations(scope) == []
            request.tool_call["args"] = {"body": "exact draft"}
            result = wrapper(request, lambda _: calls.append(True))
        event = json.loads(result.content)
        assert event["action"] == "governed_tool"
        assert calls == []
        claimed = confirmations.claim_confirmation(event["confirmation_id"], scope)
        assert claimed["arguments"]["tool_id"] == "mcp.mail.save_draft"
        assert claimed["arguments"]["tool_arguments"] == {"body": "exact draft"}
        # The approved API re-resolves the descriptor, role, digest and handler.
        from backend.domains.agent.routes import confirmations as approval_routes
        monkeypatch.setattr(approval_routes, "prepare_agent_runtime", lambda *_args, **_kwargs: (
            {}, {"id": "agent"}, SimpleNamespace(tool_descriptors=(descriptor,), tools=(handler,))))
        monkeypatch.setattr(approval_routes, "record_capability_event", lambda *_args, **_kwargs: None)
        output = asyncio.run(approval_routes._execute_governed_tool(
            claimed["arguments"], scope=scope, vault=tmp_path))
        assert output["arguments"] == {"body": "exact draft"}
        confirmations.finish_confirmation(event["confirmation_id"], result=output)
    finally:
        refresh_mcp_tool_contributions([], None)


def test_invalid_host_policies_are_isolated():
    from backend.services.mcp_tool_contributions import _provider
    definitions = [{"server": "s", "name": name} for name in ["unsafe", "badrole", "valid"]]
    try:
        refresh_mcp_tool_contributions(definitions, _Client(), trusted_policies={
            ("s", "unsafe"): {"effects": ["external_write"], "minimum_role": "editor", "confirmation": "none"},
            ("s", "badrole"): {"effects": ["external_write"], "minimum_role": "Viewer", "confirmation": "always"},
            ("s", "valid"): {"effects": ["read"], "minimum_role": "viewer", "confirmation": "none"},
        })
        assert [item.descriptor.id for item in _provider()] == ["mcp.s.valid"]
    finally:
        refresh_mcp_tool_contributions([], None)


def test_legacy_profile_allowlist_cannot_bypass_host_policy_or_minimum_role(monkeypatch):
    from types import SimpleNamespace
    from backend.config import mcp_config
    from backend.domains.agent.policy import _tool_policy_wrapper
    from backend.domains.agent.runtime_tools import _safe_mcp_definitions
    from backend.services.mcp_tool_contributions import _provider

    policy = {("s", "secrets"): {"effects": ["read", "personal_data"],
        "minimum_role": "admin", "confirmation": "none"}}
    definition = {"server": "s", "name": "secrets", "annotations": {"readOnlyHint": True}}
    monkeypatch.setattr(mcp_config, "MCP_TOOL_POLICIES", policy)
    # Even configured reads cannot enter the descriptor-free legacy path.
    assert _safe_mcp_definitions([definition], ["secrets"]) == []
    try:
        refresh_mcp_tool_contributions([definition], _Client())
        registration, = _provider()
        descriptor = registration.descriptor
        handler = registration.handler
        assert descriptor.minimum_role == "admin"
        assert [effect.value for effect in descriptor.effects] == ["read", "personal_data"]
        wrapper = _tool_policy_wrapper({handler.name: {
            "minimum_role": descriptor.minimum_role,
            "confirmation": descriptor.confirmation.value,
            "effects": [effect.value for effect in descriptor.effects],
            "_descriptor": descriptor,
        }})
        calls = []
        request = SimpleNamespace(tool_call={"id": "call", "name": handler.name, "args": {}},
            state={"current_user_role": "viewer"})
        assert wrapper(request, lambda _: calls.append(True)).status == "error"
        assert calls == []
        request.state["current_user_role"] = "admin"
        wrapper(request, lambda _: calls.append(True))
        assert calls == [True]
    finally:
        refresh_mcp_tool_contributions([], None)
    from backend.domains.agent.workflow_setup import _brain_tool_list
    ungoverned = SimpleNamespace(name="delete_all")
    assert ungoverned not in _brain_tool_list(
        supports_tools=True, notebook_context_only=False, context_tools=[],
        runtime_tools=[], legacy_bundle_active=True, mcp_tools=[ungoverned])
    monkeypatch.setattr(mcp_config, "MCP_TOOL_POLICIES", {})
    assert _safe_mcp_definitions([{
        "server": "s", "name": "delete_all", "annotations": {"destructiveHint": True},
    }], ["delete_all"]) == []


@pytest.mark.parametrize('schema', [
    {'type': 'object', 'required': ['query']},
    {'type': 'object', 'required': ['query'],
        '$defs': {'Query': {'type': 'object', 'properties': {'query': {'type': 'string', 'minLength': 1}},
            'required': ['query'], 'additionalProperties': False}},
        'allOf': [{'$ref': '#/$defs/Query'}]},
])
def test_composed_mcp_schema_survives_catalog_and_full_confirmation_flow(schema, tmp_path, monkeypatch):
    import json
    from types import SimpleNamespace
    from backend.agent import action_confirmations as confirmations
    from backend.domains.agent.policy import _tool_policy_wrapper
    from backend.domains.agent.routes import confirmations as approval_routes

    monkeypatch.setattr(confirmations, '_database_path', lambda: tmp_path / 'confirmations.sqlite')
    scope = {'vault_scope': 'vault', 'workspace_id': 'personal', 'user_id': 'user',
        'role': 'editor', 'agent_id': 'agent', 'session_id': 'session'}
    token = active_vault_path.set(tmp_path)
    try:
        refresh_mcp_tool_contributions([{'server': 'composed', 'name': 'save', 'inputSchema': schema}], _Client(),
            trusted_policies={('composed', 'save'): {'effects': ['external_write'],
                'minimum_role': 'editor', 'confirmation': 'always'}})
        catalog = get_tool_catalog()
        descriptor = catalog.get('mcp.composed.save')
        assert descriptor is not None
        assert descriptor.input_schema == schema
        handler = catalog.get_handler(descriptor.id)
        assert handler.args_schema == schema
        wrapper = _tool_policy_wrapper({handler.name: {'minimum_role': descriptor.minimum_role,
            'confirmation': descriptor.confirmation.value, '_descriptor': descriptor}})
        calls = []
        request = SimpleNamespace(tool_call={'id': 'call', 'name': handler.name, 'args': {}},
            state={'current_user_role': 'editor', 'active_skill_ids': ['user.test']})
        with confirmations.confirmation_context(**scope):
            invalid_args = [{}]
            if 'allOf' in schema:
                invalid_args.extend([{'query': 3}, {'query': ''}, {'query': 'ok', 'extra': True}])
            for args in invalid_args:
                request.tool_call['args'] = args
                assert wrapper(request, lambda _: calls.append(True)).status == 'error'
                assert confirmations.list_confirmations(scope) == []
            request.tool_call['args'] = {'query': 'exact'}
            event = json.loads(wrapper(request, lambda _: calls.append(True)).content)
        assert calls == []
        claimed = confirmations.claim_confirmation(event['confirmation_id'], scope)
        monkeypatch.setattr(approval_routes, 'prepare_agent_runtime', lambda *_args, **_kwargs: (
            {}, {'id': 'agent'}, SimpleNamespace(tool_descriptors=(descriptor,), tools=(handler,))))
        monkeypatch.setattr(approval_routes, 'record_capability_event', lambda *_args, **_kwargs: None)
        result = asyncio.run(approval_routes._execute_governed_tool(claimed['arguments'], scope=scope, vault=tmp_path))
        assert result['arguments'] == {'query': 'exact'}
        confirmations.finish_confirmation(event['confirmation_id'], result=result)
    finally:
        refresh_mcp_tool_contributions([], None)
        active_vault_path.reset(token)


def test_mcp_descriptors_reject_malformed_schema_without_weakening_core_contract():
    from pydantic import ValidationError
    from backend.models.agent_skills import CatalogOrigin, OriginType, ToolDescriptor
    for schema in [{'type': 'object', 'required': 'query'}, {'type': 'object', 'properties': {'query': {'type': 'invalid'}}}]:
        with pytest.raises(ValidationError):
            ToolDescriptor(id='mcp.test.invalid', name='Invalid',
                origin=CatalogOrigin(type=OriginType.MCP, id='test'), input_schema=schema)
    with pytest.raises(ValidationError, match='undefined properties'):
        ToolDescriptor(id='core.test-required', name='Core',
            origin=CatalogOrigin(type=OriginType.CORE, id='gnosi'),
            input_schema={'type': 'object', 'required': ['query']})
