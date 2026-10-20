"""An error event is not a useful answer or a successful agent operation."""

import asyncio
import json
import time
from types import SimpleNamespace

import pytest

from backend.domains.agent.routes import chat_stream_errors as errors
from backend.domains.agent.routes.chat_stream_state import AgentStreamState
from backend.domains.agent.routes.contracts import ChatRequest
from backend.domains.agent.routes.shared import _agent_stream_error_code

LANGUAGES = {
    'ca': ('Busca totes les entrades de la taula Cervell Digital.', ['L’eina', 'No he pogut', 'La resposta', 'L’agent', 'Aquesta conversa', 'El model', 'La conversa', 'El proveïdor', 'S’ha', 'El compte', 'Les credencials']),
    'es': ('Busca todas las entradas de la tabla Cervell Digital.', ['La herramienta', 'No he podido', 'La respuesta', 'El agente', 'Esta conversación', 'El modelo', 'La conversación', 'El proveedor', 'Se ha', 'La cuenta', 'Las credenciales']),
    'en': ('Find all entries in the Cervell Digital table.', ['The tool', 'I could not', 'The generated', 'The response', 'The agent', 'This conversation', 'The model', 'The conversation', 'The provider', 'Provider', 'Invalid provider']),
    'fr': ('Trouve toutes les entrées de la table Cervell Digital.', ['L’outil', 'Je n’ai pas pu', 'La réponse', 'L’agent', 'Cette conversation', 'Le modèle', 'La conversation', 'Le fournisseur', 'La limite', 'Le compte', 'Les identifiants', 'Une erreur']),
}


@pytest.mark.parametrize('language', LANGUAGES)
@pytest.mark.parametrize('failure', [
    'agent_execution_tool_revoked', 'agent_execution_skill_revoked',
    'agent_execution_scope_or_skill_mismatch', 'agent_execution_membership_revoked',
    'agent_execution_vault_unavailable', 'agent_budget_exceeded',
    'agent_turn_incomplete_limit_reached', 'agent_model_context_exceeded',
    'agent_invalid_result', 'agent_empty_result', 'turn_timeout', 'loop', 'busy',
    'tool_use_failed', 'context_length_exceeded', 'schema_invalid', 'content_filter',
    'rate_limit', 'insufficient_credit', 'auth', 'not_found', 'timeout', 'server_error', 'unexpected',
])
def test_failure_events_keep_language_code_and_unsuccessful_outcome(monkeypatch, language, failure):
    from langgraph.errors import GraphRecursionError
    from backend.domains.agent.routes.checkpoints import SessionBusyError
    from backend.domains.agent.routes.contracts import FAILURE_MESSAGES

    private_detail = 'synthetic-secret-token /private/synthetic/vault'
    if failure == 'turn_timeout':
        error = TimeoutError(private_detail)
    elif failure == 'loop':
        error = GraphRecursionError(private_detail)
    elif failure == 'busy':
        error = SessionBusyError(private_detail)
    elif failure == 'unexpected':
        error = ValueError(private_detail)
    else:
        error = RuntimeError(failure + ':' + private_detail)
    reason = failure if failure in FAILURE_MESSAGES else None
    replay = []
    monkeypatch.setattr(errors, '_failure_reason', lambda *_args, **_kwargs: reason)
    monkeypatch.setattr(errors, 'record_replay_event', lambda *args: replay.append(args))
    monkeypatch.setattr(errors, 'record_quality_signal', lambda *_args, **_kwargs: None)
    monkeypatch.setattr(errors, 'model_evidence', lambda *_args, **_kwargs: None)
    monkeypatch.setattr(errors, 'safe_error_detail', lambda *_args, **_kwargs: 'Internal error [deadbeef]: ValueError')
    message, prefixes = LANGUAGES[language]
    state = AgentStreamState(request_started_at=time.monotonic(), workflow_ready_at=time.monotonic(),
        llm_selection={}, turn_plan={}, trace_id='localized-failure', answer_count=0)

    async def collect():
        return [json.loads(event) async for event in errors.stream_error_events(
            error, state=state, vault_scope='vault',
            workspace_context=SimpleNamespace(workspace_id='workspace', user_id='user'),
            agent_id='agent', session_id='session', turn_timeout_seconds=77,
            chat_req=ChatRequest(message=message))]

    events = asyncio.run(collect())
    result = events[0]
    assert result['type'] == 'error' and state.stream_failed
    assert result['content_language'] == language
    assert any(result['content'].startswith(prefix) for prefix in prefixes), result['content']
    assert private_detail not in result['content'] and 'RuntimeError' not in result['content']
    assert result['code'] == replay[0][2]['error_code']
    assert result['recovery']['automatic'] is False
    assert events[-1]['type'] == 'done' and events[-1]['has_response'] is False
    assert events[-1]['message_count'] == 0
    if failure == 'turn_timeout':
        assert '77' in result['content'] and result['code'] == 'agent_turn_timeout'
    if failure == 'unexpected':
        assert 'deadbeef' in result['content'] and 'ValueError' not in result['content']


@pytest.mark.parametrize('language', LANGUAGES)
def test_repeated_model_failure_preserves_scoped_evidence_and_localized_window(monkeypatch, language):
    scopes = []
    def evidence(*_args, scope_key):
        scopes.append(scope_key)
        return {'reasons': {'schema_invalid': 3}}
    monkeypatch.setattr(errors, 'model_evidence', evidence)
    content = errors._friendly_stream_error(RuntimeError('schema_invalid'), reason='schema_invalid',
        provider='test', model_id='fixture', reliability_scope='vault:workspace:user',
        turn_timeout_seconds=77, language=language)
    assert scopes == ['vault:workspace:user']
    assert '3' in content and '30' in content
    if language != 'en':
        assert 'This model' not in content


@pytest.mark.parametrize("answer_count", [0, 2])
def test_done_counts_only_preexisting_answers_or_confirmations(monkeypatch, answer_count):
    monkeypatch.setattr(errors, "_failure_reason", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(errors, "record_replay_event", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(errors, "record_quality_signal", lambda *_args, **_kwargs: None)
    state = AgentStreamState(
        request_started_at=time.monotonic(), workflow_ready_at=time.monotonic(),
        llm_selection={}, turn_plan={}, trace_id="error-outcome", answer_count=answer_count,
    )
    async def collect():
        return [json.loads(event) async for event in errors.stream_error_events(
            RuntimeError("agent_budget_exceeded"), state=state, vault_scope="vault",
            workspace_context=SimpleNamespace(workspace_id="workspace", user_id="user"),
            agent_id="agent", session_id="session", turn_timeout_seconds=120,
            chat_req=ChatRequest(message="Troba les files"),
        )]
    events = asyncio.run(collect())
    assert events[-1]["type"] == "done"
    assert events[-1]["message_count"] == answer_count
    assert events[-1]["has_response"] is (answer_count > 0)
    assert events[0]["code"] == "agent_budget_exceeded"
    assert "No he pogut completar" in events[0]["content"]
    assert "Internal error" not in events[0]["content"]


@pytest.mark.parametrize("code,word", [
    ("agent_execution_tool_revoked", "permissions"),
    ("agent_execution_skill_revoked", "permissions"),
    ("agent_turn_incomplete_limit_reached", "limits"),
    ("agent_model_context_exceeded", "limits"),
    ("agent_invalid_result", "format"),
])
def test_known_local_errors_have_stable_codes_and_recoverable_messages(code, word):
    exception = RuntimeError(code)
    assert _agent_stream_error_code(exception) == code
    content = errors._friendly_stream_error(
        exception, reason=None, provider="test", model_id="test", reliability_scope="test",
        turn_timeout_seconds=120,
    )
    assert word in content
    assert "Internal error" not in content
