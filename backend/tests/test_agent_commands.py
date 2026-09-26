import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from backend.services.agent_commands import normalize_command, resolve_command, validate_commands


@pytest.mark.parametrize('value', ['/TRADUCTOR', ' /traductor '])
def test_normalizes_commands(value):
    assert normalize_command(value) == '/traductor'


@pytest.mark.parametrize('value', ['/1agent', '/àgent', '/a/b', '/a b', '/', 42, '/' + 'a' * 33])
def test_rejects_invalid_commands(value):
    with pytest.raises(ValueError, match='agent_command_invalid'):
        normalize_command(value)


def test_unique_even_for_disabled_agents():
    with pytest.raises(ValueError, match='agent_command_duplicate'):
        validate_commands([{'command': '/translator'}, {'command': '/TRANSLATOR', 'enabled': False}])
    agents = [{'command': ' /TRANSLATOR '}, {}, {'command': ''}]
    validate_commands(agents)
    assert agents[0]['command'] == '/translator'


@pytest.mark.parametrize('message', ['hello', 'Use /traductor now', 'https://example.org', '/tmp/file text', '`/traductor` text'])
def test_only_leading_command_tokens_are_routed(message):
    assert resolve_command(message, []) is None


def test_explicit_selection_strips_only_command():
    agent = {'id': 'translator', 'command': '/traductor'}
    assert resolve_command('  /TRADUCTOR Translate\nthis text', [agent]) == ('translator', 'Translate\nthis text')
    assert agent == {'id': 'translator', 'command': '/traductor'}


@pytest.mark.parametrize('patch', [{'enabled': False}, {'plugin_suspended': True}, {'managed_by': 'llm-wiki'}])
def test_unavailable_agent_never_falls_back(patch):
    with pytest.raises(ValueError, match='agent_command_unavailable'):
        resolve_command('/traductor text', [{'id': 't', 'command': '/traductor', **patch}])


def test_unknown_and_empty_requests_never_fall_back():
    with pytest.raises(ValueError, match='agent_command_unknown'):
        resolve_command('/missing text', [])
    with pytest.raises(ValueError, match='agent_command_request_required'):
        resolve_command('/traductor', [{'id': 't', 'command': '/traductor'}])


def test_route_selects_executor_and_preserves_conversation(monkeypatch, tmp_path):
    from backend.domains.agent.routes import chat_route as route
    from backend.domains.agent.routes import learning_context
    from backend.services import principal_agent_migration
    from backend.services.workspace_service import WorkspaceContext

    monkeypatch.setattr(principal_agent_migration, 'ensure_migrated', lambda: {'agents': [{'id': 'translator', 'command': '/traductor'}]})
    monkeypatch.setattr(route, '_vault_scope', lambda: (tmp_path, 'scope'))
    monkeypatch.setattr(learning_context, 'prepare_learning_context', lambda *args: ('', [], '', None))
    workflow = AsyncMock(side_effect=HTTPException(418, 'stop before execution'))
    monkeypatch.setattr(route, 'get_agent_workflow', workflow)
    req = route.ChatRequest(agent_id='conversation', profile_id='other', message='/traductor Translate this', active_skill_ids=['source-skill'])
    with pytest.raises(HTTPException) as error:
        asyncio.run(route.chat_endpoint(SimpleNamespace(), req, WorkspaceContext('w', 'u', 'editor', tmp_path)))
    assert error.value.status_code == 418
    assert workflow.call_args.args[1] == 'translator'
    assert workflow.call_args.kwargs['direct_agent'] is True
    assert workflow.call_args.kwargs['user_message'] == 'Translate this'
    assert workflow.call_args.kwargs['active_skill_ids'] is None
    assert req.agent_id == 'conversation'
    assert req.profile_id == 'other'
    assert req.message == '/traductor Translate this'


def test_direct_workflow_disables_team_only_for_this_turn(monkeypatch):
    from backend.domains.agent.routes import workflow
    from backend.services import mcp_tool_contributions

    profile = {'id': 'translator', 'model': 'fixed', 'provider': 'fake', 'team': {'enabled': True}, 'skill_ids': ['translate']}
    monkeypatch.setattr(workflow, 'prepare_agent_runtime', lambda *args, **kwargs: ({}, profile, SimpleNamespace()))
    monkeypatch.setattr(mcp_tool_contributions, 'refresh_mcp_tool_contributions', lambda *args: None)
    factory = AsyncMock(return_value=(object(), {}))
    monkeypatch.setattr(workflow, 'create_agent_workflow', factory)
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace()))
    asyncio.run(workflow.get_agent_workflow(request, 'translator', direct_agent=True))
    prepared = factory.call_args.kwargs['prepared_agent_data']
    assert prepared == {**profile, 'team': {'enabled': False}}
    assert profile['team']['enabled'] is True
    assert request.app.state.agent_cache == {}


def test_settings_validate_and_preserve_command(monkeypatch):
    from backend.agent import model_router
    from backend.domains.configuration.api.settings import _validate_agent_strategies

    monkeypatch.setattr(model_router, 'load_registry', lambda: [{'provider': 'fake', 'model_id': 'fixed', 'enabled': True}])
    row = {'id': 'translator', 'provider': 'fake', 'model': 'fixed', 'command': ' /TRADUCTOR '}
    merged = {}
    _validate_agent_strategies({'ai': {'agents': [row]}}, merged)
    assert merged['ai']['agents'][0]['command'] == '/traductor'
    with pytest.raises(HTTPException) as error:
        _validate_agent_strategies({'ai': {'agents': [row, {**row, 'id': 'other'}]}}, {})
    assert error.value.status_code == 400
    assert error.value.detail == 'agent_command_duplicate'
