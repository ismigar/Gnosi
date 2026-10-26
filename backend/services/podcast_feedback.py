"""Bounded writing guidance for every retained, independently confirmed finding."""
from __future__ import annotations

from collections.abc import Callable
from copy import deepcopy
import json
from typing import Any, TYPE_CHECKING

from backend.services.agent_behavior import resource
from backend.services.agent_execution_models import AgentOperation
from backend.services.podcast_briefing import _object

if TYPE_CHECKING:
    from backend.services.podcast_briefing import _Briefing


def _guidance_request(context: _Briefing, findings: list[dict[str, Any]], byte_budget: int) -> AgentOperation:
    schema = _object({'guidance': _object({row['finding_id']: {
        'type': 'string', 'minLength': 1, 'maxLength': byte_budget,
        'pattern': r'^[\x20-\x21\x23-\x5B\x5D-\x7E]+$'} for row in findings})})
    return context.request('podcast.coverage.digest', {'confirmed_findings': findings, 'guidance_byte_budget': byte_budget}, schema).model_copy(
        update={'options': {'feedback_contract': resource('operations/podcast/feedback-contract.md')}})


def _guidance(context: _Briefing, findings: list[dict[str, Any]], byte_budget: int) -> list[list[Any]]:
    identified = [{'finding_id': f'finding:{index}', 'finding': deepcopy(finding)}
                  for index, finding in enumerate(findings)]
    batches: list[list[dict[str, Any]]] = [[]]
    limit = min(40_000, context.budget)
    for row in identified:
        candidate = [*batches[-1], row]
        if batches[-1] and (len(candidate) > 8 or context.cost(_guidance_request(context, candidate, byte_budget)) > limit):
            batches.append([])
        batches[-1].append(row)
        if context.cost(_guidance_request(context, batches[-1], byte_budget)) > limit:
            raise RuntimeError('podcast_feedback_context_insufficient')
    rows: list[list[Any]] = []
    for batch in batches:
        def checked(value: dict[str, Any]) -> None:
            if any(not text.strip() for text in value['guidance'].values()):
                raise ValueError('podcast_feedback_guidance_empty')
            for key, text in value['guidance'].items():
                # Portable provider regex anchors may accept a final newline locally.
                if not text.isascii() or not text.isprintable() or '"' in text or '\\' in text:
                    raise ValueError(f'podcast_feedback_guidance_ascii: {key} requires printable ASCII '
                                     'without double quotes, backslashes or line breaks.')
                # Both JSON layers are charged by operation_input's conservative counter.
                wire = len(json.dumps(json.dumps(text, ensure_ascii=False), ensure_ascii=False).encode()) - 6
                if wire > byte_budget:
                    raise ValueError(f'podcast_feedback_guidance_budget: {key} needs at most '
                                     f'{byte_budget} serialized UTF8 bytes; received {wire}. '
                                     'Shorten the English correction while retaining its essential qualification.')
        result = context.stage(_guidance_request(context, batch, byte_budget), checked)
        rows.extend([row['finding_id'], row['finding']['kind'],
                     deepcopy(row['finding']['source_part_ids']), result['guidance'][row['finding_id']]]
                    for row in batch)
    return rows


def fit_feedback(context: _Briefing, data: dict[str, Any], request: AgentOperation,
                 request_for: Callable[[dict[str, Any]], AgentOperation]) -> tuple[dict[str, Any], AgentOperation]:
    limit = min(80_000, context.budget)
    if context.cost(request) <= limit:
        return data, request
    findings = data.get('feedback')
    if not isinstance(findings, list) or not findings:
        raise RuntimeError('podcast_theme_context_insufficient')
    # Original findings stay in their audit/confirmation checkpoints. Only the writer's
    # transport changes; source membership, whole-day ledger and final audits stay intact.
    rows = [[f'finding:{index}', f['kind'], deepcopy(f['source_part_ids']), '']
            for index, f in enumerate(findings)]
    revised = {**data, 'feedback': {'encoding': 'finding_guidance_v1',
        'columns': ['finding_id', 'kind', 'source_part_ids', 'guidance'], 'rows': rows}}
    available = limit - context.cost(request_for(revised)) - 1024
    byte_budget = min(160, available // len(findings))
    if byte_budget < 1:
        raise RuntimeError('podcast_feedback_context_insufficient')
    revised['feedback']['rows'] = _guidance(context, findings, byte_budget)
    result = request_for(revised)
    if context.cost(result) > limit:
        raise RuntimeError('podcast_feedback_context_insufficient')
    return revised, result
