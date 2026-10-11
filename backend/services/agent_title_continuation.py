"""Carry a verified title action across turns without inferring new write scope."""
from __future__ import annotations

import json
from typing import Any

from backend.domains.agent.title_followups import canonical_title_request, followup_pairs, title_assent
from backend.domains.agent.title_replacements import active_title_scope, title_replacements, title_target, title_view_revisions
from backend.services.agent_execution_models import ExecutionScope
from backend.services.agent_team_context import visible_text

MARKER = 'gnosi_title_action'


def _legacy_marker(message: Any, owner_id: str, scope: ExecutionScope) -> dict[str, Any] | None:
    """Recover older confirmed previews using their scoped server execution evidence."""
    from backend.services import agent_execution_store as runs, agent_team_store as artifacts
    from backend.services.agent_execution_trace import events
    try:
        confirmation = json.loads(message.text)
    except (ValueError, TypeError):
        return None
    if not isinstance(confirmation, dict) or confirmation.get('type') != 'confirmation_required':
        return None
    identifier = confirmation.get('confirmation_id')
    if not isinstance(identifier, str) or len(identifier) != 32:
        return None
    with runs.connect() as db:
        if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_team_artifacts'").fetchone():
            return None
        row = db.execute("""SELECT a.run_id,a.payload FROM agent_team_artifacts a
            JOIN agent_runs r ON r.run_id=a.run_id
            JOIN json_each(a.payload,'$.confirmations') c
            WHERE a.kind='task' AND r.user_id=? AND r.workspace_id=? AND r.vault_path=?
            AND json_extract(r.payload,'$.agent_id')=?
            AND json_extract(c.value,'$.confirmation_id')=? LIMIT 1""",
            (scope.user_id, scope.workspace_id, scope.vault_path, owner_id, identifier)).fetchone()
    if row is None:
        return None
    task = json.loads(row['payload'])
    plan = artifacts.get(scope, row['run_id'], 'plan')
    if title_replacements(plan.get('original', '')) is None:
        return None
    for event in events(scope, task['run_id'], limit=100)['events']:
        value = event.get('value', {})
        if event['kind'] == 'tool.request' and value.get('name') == 'bulk_update_rows':
            arguments = value.get('call', {}).get('args', {})
            if arguments.get('view_scope'):
                return {'owner_id': owner_id, 'request': plan['original'], 'view_scope': arguments['view_scope']}
    return None


def _history_intent(messages: list[Any], owner_id: str, scope: ExecutionScope) -> dict[str, Any] | None:
    """An unrelated human turn breaks the chain; assistant prose never supplies operands."""
    pending = []
    for message in reversed(messages[-24:]):
        if message.type == 'human':
            text = visible_text(message)
            if message.additional_kwargs.get('gnosi_extra_context') or title_target(text):
                return None
            pairs = title_replacements(text) or followup_pairs(text)
            if pairs:
                pending.append(pairs)
            elif not title_assent(text):
                return None
        elif message.type == 'ai':
            marker = message.additional_kwargs.get(MARKER) or _legacy_marker(message, owner_id, scope)
            if marker:
                if marker.get('owner_id') != owner_id:
                    return None
                result = dict(marker)
                if pending:
                    result['request'] = canonical_title_request(pending[0])
                return result
    return None


def resolve_title_turn(original: str, state: dict[str, Any], refs: list[dict[str, Any]],
                       owner_id: str, scope: ExecutionScope) -> tuple[str, dict[str, Any] | None, bool]:
    """Return canonical action, persistent context, and whether scope needs clarification.

    Resolved assent prepares a fresh preview; it never confirms or replays a write.
    """
    from backend.domains.agent.responses import _response_language
    pairs = title_replacements(original)
    followup = followup_pairs(original)
    if pairs is None and followup is None and not title_assent(original):
        return original, None, False
    if pairs and 'bulk_update_rows' not in state.get('turn_authorized_tool_names', []):
        return original, None, False
    messages = list(state.get('messages') or [])
    current = messages[-1] if messages else None
    selected = active_title_scope(refs)
    if pairs is None and current and current.additional_kwargs.get('gnosi_extra_context'):
        return original, None, False
    try:
        revisions = title_view_revisions(selected) if selected else []
    except (ValueError, KeyError):
        revisions = []
    prior = None if pairs else _history_intent(messages[:-1], owner_id, scope)
    if pairs is None:
        if prior is None:
            return original, None, followup is not None
        if revisions != [prior.get('view_scope')]:
            return original, None, True
        pairs = followup or title_replacements(prior['request'])
        if not pairs:
            return original, None, True
        original = canonical_title_request(pairs, _response_language(original))
    if not revisions:
        return original, None, True
    return original, {'owner_id': owner_id, 'request': original, 'view_scope': revisions[0]}, False


def prepare_title_turn(original: str, state: dict[str, Any], refs: list[dict[str, Any]],
                       owner_id: str, scope: ExecutionScope, *, operation_mode: bool
                       ) -> tuple[str, dict[str, Any], dict[str, Any], str]:
    from backend.domains.agent.title_replacements import title_response
    if operation_mode:
        return original, state, {}, ''
    original, marker, needs_scope = resolve_title_turn(original, state, refs, owner_id, scope)
    if needs_scope:
        return original, state, {}, title_response(original, 'scope')
    if marker:
        state = {**state, 'user_request': original, 'turn_authorized_tool_names': ['bulk_update_rows']}
    return original, state, {MARKER: marker} if marker else {}, ''
