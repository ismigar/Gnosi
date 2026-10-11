"""Interpret view edits once, then let the existing team prepare a checked preview."""
from __future__ import annotations

import json
from typing import Any
from jsonschema import ValidationError

from backend.domains.agent.title_edit_contract import ViewEditDecision
from backend.domains.agent.title_replacements import active_title_scope, title_replacements, title_response, title_view_revisions
from backend.services.agent_behavior import resource, revision
from backend.services.agent_execution_models import AgentOperation, ExecutionScope
from backend.services.agent_team_actions import action_candidates
from backend.services.agent_team_models import TEAM_SKILL


async def interpret_view_edit(owner: dict[str, Any], scope: ExecutionScope, root_id: str,
                              data: dict[str, Any]) -> ViewEditDecision:
    from backend.services.agent_execution import execute_operation
    from backend.services.agent_team_runtime import _profile, _snapshot, delegating
    from backend.services.agent_team_policy import team_for
    director = _profile(team_for(owner).director_id)
    snapshot, _ = _snapshot(director, owner, root_id, scope, [TEAM_SKILL], [])
    # This internal parsing phase needs neither personal memory nor document
    # context. Model policy, membership, role and budget still use the executor.
    profile = {**snapshot.profile, 'persona': '', 'context': '',
               '_execution_detailed_persona': '', '_execution_reviewed_memory': []}
    instructions = [resource('system/view-edit.md')]
    snapshot = snapshot.model_copy(update={'profile': profile, 'instructions': instructions,
        'revision': revision({'parent': snapshot.revision, 'profile': profile, 'instructions': instructions})})
    request = AgentOperation(skill_id=TEAM_SKILL, operation='team.view_edit',
        input=json.dumps(data, ensure_ascii=False, separators=(',', ':')),
        output_schema=ViewEditDecision.model_json_schema(), timeout_seconds=25,
        max_model_calls=1, parent_run_id=root_id, origin=snapshot.origin, resume_requires_parent=True)
    token = delegating.set(True)
    try:
        result = await execute_operation(request, snapshot=snapshot,
            output_validator=lambda text: ViewEditDecision.model_validate_json(text).model_dump_json())
        return ViewEditDecision.model_validate_json(result.result)
    finally:
        delegating.reset(token)


async def prepare_view_edit(owner: dict[str, Any], scope: ExecutionScope, root_id: str,
                            state: dict[str, Any], original: str, refs: list[dict[str, Any]],
                            catalog: list[dict[str, Any]]) -> tuple[dict[str, Any], str]:
    """A semantic decision authorizes only the normal confirmation preparation."""
    from backend.services.agent_title_continuation import _history_intent
    from backend.services.agent_execution_trace import record
    if (state.get('title_edit') or title_replacements(original) or len(original) > 6000
            or scope.role == 'viewer' or not active_title_scope(refs)
            or not action_candidates(catalog, {'bulk_update_rows'}, owner['id'])):
        return state, ''
    messages = list(state.get('messages') or [])
    current = messages[-1] if messages else None
    # Attachments stay with ordinary governed planning, never with this parser.
    if current and (current.additional_kwargs.get('gnosi_extra_context') or current.text != original):
        return state, ''
    try:
        revisions = title_view_revisions(active_title_scope(refs))
    except (ValueError, KeyError):
        return state, ''
    prior = _history_intent(messages[:-1], owner['id'], scope)
    if prior and [prior.get('view_scope')] != revisions:
        prior = None
    data = {'request': original, 'active_view': True,
            'previous_title_request': str(prior.get('request') or '')[:1200] if prior else ''}
    try:
        decision = await interpret_view_edit(owner, scope, root_id, data)
    except (ValueError, ValidationError, TimeoutError):
        record('team.view_edit', {'outcome': 'invalid_or_timeout'})
        return state, title_response(original, 'interpretation')
    record('team.view_edit', {'outcome': decision.kind, 'input_chars': len(json.dumps(data)),
                              'decision': decision.model_dump()})
    if decision.kind != 'edit':
        return state, decision.question
    assert decision.edit is not None
    if decision.edit.scope == 'previous_view' and prior is None:
        return state, title_response(original, 'scope')
    binding = {'owner_id': owner['id'], 'request': original, 'view_scope': revisions[0],
               'program': decision.edit.model_dump()}
    return {**state, 'user_request': original, 'title_edit': binding,
            'turn_authorized_tool_names': ['bulk_update_rows']}, ''
