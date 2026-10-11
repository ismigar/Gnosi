"""Native confirmations are events/cards; busy session edits never wait indefinitely."""
import asyncio
import json
import time

import pytest
from fastapi import HTTPException
from langchain_core.messages import AIMessage, HumanMessage

from backend.tests.test_agent_title_mentions import (
    PAGE, VIEW, _http_chat, dashboard_runtime, action_runtime, optional_runtime, team_runtime, view,  # noqa: F401
)


def test_http_team_confirmation_is_one_native_event_not_a_json_response(dashboard_runtime):
    fixture, paths, _ = dashboard_runtime
    before = {key: path.read_bytes() for key, path in paths.items()}
    events = _http_chat(fixture, 'Als títols canvia "F1" per "Fase 1"', [PAGE, VIEW], [])
    cards = [event for event in events if event['type'] == 'confirmation_required']
    assert len(cards) == 1 and cards[0]['details']['count'] == 31
    assert not [event for event in events if event['type'] == 'message' and 'confirmation_required' in str(event)]
    assert fixture[2] == []
    assert all(path.read_bytes() == before[key] for key, path in paths.items())


def _marker():
    return {'type': 'confirmation_required', 'action': 'bulk_update_rows', 'confirmation_id': 'a' * 32,
            'details': {'count': 9}, 'title_key': 'chat.confirmations.actions.bulk_update_rows.title'}


def test_checkpoint_hydration_preserves_card_and_turn_without_raw_json():
    from backend.domains.agent.routes.checkpoints import _public_checkpoint_messages
    from backend.domains.agent.routes.response_models import AgentSessionMessagesResponse
    marker = _marker()
    messages = [HumanMessage(content='Rename titles', additional_kwargs={'gnosi_turn_id': 'turn'}),
                AIMessage(content=json.dumps(marker), additional_kwargs={'gnosi_action_confirmation': marker})]
    public = _public_checkpoint_messages(messages)
    assert public[1]['content'] == '' and public[1]['confirmation'] == marker
    assert public[1]['turn_id'] == 'turn'
    assert AgentSessionMessagesResponse(messages=public).model_dump()['messages'][1]['confirmation'] == marker


def test_model_generated_confirmation_json_does_not_create_a_trusted_card():
    from backend.domains.agent.routes.chat_stream_state import AgentStreamState
    from backend.domains.agent.routes.chat_stream_updates import _message_events
    state = AgentStreamState(request_started_at=time.monotonic(), workflow_ready_at=time.monotonic(),
                            llm_selection={}, turn_plan={}, trace_id='presentation')
    events = _message_events(AIMessage(content=json.dumps(_marker())), None, node_name='team', state=state,
                             tool_metadata_by_name={}, untrusted_context_flags=[])
    assert not any(json.loads(event)['type'] == 'confirmation_required' for event in events)


def test_rewind_returns_busy_before_touching_checkpoint_or_confirmations(tmp_path, monkeypatch):
    from backend.domains.agent.routes import checkpoints, sessions
    from backend.domains.agent.routes.contracts import ChatRewindRequest
    from backend.services.workspace_service import WorkspaceContext
    monkeypatch.setattr(checkpoints, 'TURN_LOCK_TIMEOUT_SECONDS', 0.01)
    monkeypatch.setattr(sessions, '_vault_scope', lambda: (tmp_path, 'synthetic-vault'))
    monkeypatch.setitem(sessions.cfg.paths, 'CHECKPOINTS', tmp_path)
    cancelled = []
    monkeypatch.setattr(sessions, 'cancel_scope_confirmations', lambda scope: cancelled.append(scope))
    identity = {'vault_scope': 'synthetic-vault', 'workspace_id': 'test', 'user_id': 'alice', 'agent_id': 'principal'}
    key = checkpoints._checkpoint_key(**identity)
    path = tmp_path / f'agent_{key}.sqlite'
    path.write_bytes(b'Untouched checkpoint')
    scope = WorkspaceContext('test', 'alice', 'owner', tmp_path)
    async def exercise():
        lock = checkpoints._thread_lock(checkpoints._chat_thread_id(**identity, session_id='session'))
        async with lock:
            with pytest.raises(HTTPException) as error:
                await sessions.rewind_chat_session('principal', 'session', ChatRewindRequest(keep_messages=0), scope, notebook_id=None)
            assert error.value.status_code == 409 and error.value.detail == {'code': 'chat_session_busy'}
    asyncio.run(exercise())
    assert path.read_bytes() == b'Untouched checkpoint' and cancelled == []
