"""Ground model criticisms in exact supplied evidence before automatic rewrites."""
from __future__ import annotations

from typing import Any, Callable, cast

from openai import LengthFinishReasonError

from backend.services.podcast_briefing import _object


def _schema(data: dict[str, Any]) -> dict[str, Any]:
    ids = [b['part_id'] for b in data.get('briefs', [])]
    kinds = ['omission', 'production', 'duplicate']
    if not data.get('whole_episode'):
        kinds.append('distortion')
    if data.get('review_focus') == 'fidelity':
        kinds = ['distortion']
    elif data.get('review_focus') == 'coverage':
        kinds = ['omission']
    finding = _object({
        'kind': {'type': 'string', 'enum': kinds},
        'detail': {'type': 'string', 'minLength': 1, 'maxLength': 500},
        'narration_quotes': {'type': 'array', 'maxItems': 2, 'uniqueItems': True,
            'items': {'type': 'string', 'minLength': 8, 'maxLength': 400}},
        'source_part_ids': {'type': 'array', 'uniqueItems': True,
            'items': {'type': 'string', 'enum': ids or ['']}},
        'evidence_quote': {'type': 'string', 'maxLength': 400},
    })
    return _object({'issues': {'type': 'array', 'maxItems': 32, 'items': finding}})


def _validate(result: dict[str, Any], data: dict[str, Any]) -> None:
    narration = data.get('narration', '\n\n'.join(s['narration'] for s in data.get('sections', [])))
    for issue in result['issues']:
        if 'candidate_findings' in data and issue not in data['candidate_findings']:
            raise ValueError('podcast_audit_confirmation_changed_finding')
        kind, quotes, ids = issue['kind'], issue['narration_quotes'], issue['source_part_ids']
        if any(quote not in narration for quote in quotes):
            raise ValueError('podcast_audit_invented_narration_quote')
        expected = {'omission': 0, 'distortion': 1, 'production': 1, 'duplicate': 2}[kind]
        if len(quotes) != expected:
            raise ValueError('podcast_audit_quote_count')
        evidence = issue['evidence_quote']
        if kind in {'production', 'duplicate'}:
            if ids or evidence:
                raise ValueError('podcast_audit_unexpected_source_claim')
            continue
        if data.get('whole_episode'):
            available = [subject for group in data['subjects'] for subject in group]
            if ids:
                raise ValueError('podcast_audit_subject_ledger_has_no_source_ids')
        else:
            if not ids:
                raise ValueError('podcast_audit_missing_evidence_ids')
            available = [str(b.get(key, '')) for b in data['briefs'] if b['part_id'] in ids
                         for key in ('topic', 'title', 'summary', 'quote')]
        if not evidence or not any(evidence in value for value in available):
            raise ValueError('podcast_audit_invented_evidence_quote')


def _confirm(context: Any, data: dict[str, Any], issues: list[dict[str, Any]],
             request: Callable[..., Any], schema: dict[str, Any]) -> list[dict[str, Any]]:
    batches: list[list[dict[str, Any]]] = [[]]
    limit = min(80_000, context.budget)
    for issue in issues:
        candidate = {**data, 'candidate_findings': [*batches[-1], issue]}
        if batches[-1] and context.cost(request(context, 'audit', candidate, schema)) > limit:
            batches.append([])
        batches[-1].append(issue)
        single = {**data, 'candidate_findings': batches[-1]}
        if context.cost(request(context, 'audit', single, schema)) > limit:
            raise RuntimeError('podcast_review_context_insufficient')
    confirmed = []
    for batch in batches:
        confirmation = {**data, 'candidate_findings': batch}
        result = _stage(context, confirmation, request)
        confirmed.extend(result['issues'])
    return confirmed


def _stage(context: Any, data: dict[str, Any], request: Callable[..., Any]) -> dict[str, Any]:
    """Split only exhausted work; a failed indivisible leaf never approves."""
    try:
        return cast(dict[str, Any], context.stage(
            request(context, 'audit', data, _schema(data)), lambda r: _validate(r, data)))
    except LengthFinishReasonError:
        key = 'candidate_findings' if 'candidate_findings' in data else (
            'subjects' if data.get('whole_episode') else 'briefs')
        values = data[key]
        if len(values) < 2:
            raise
        middle = len(values) // 2
        leaves = [_stage(context, {**data, key: part}, request)
                  for part in (values[:middle], values[middle:])]
        return {'issues': [issue for leaf in leaves for issue in leaf['issues']]}


def review(context: Any, data: dict[str, Any], request: Callable[..., Any]) -> list[dict[str, Any]]:
    schema = _schema(data)
    operation = request(context, 'audit', data, schema)
    exhausted = context.cost(operation) > min(80_000, context.budget)
    if not exhausted:
        try:
            result = context.stage(operation, lambda r: _validate(r, data))
        except LengthFinishReasonError:
            exhausted = True
        else:
            return _confirm(context, data, result['issues'], request, schema) if result['issues'] else []
    key = 'subjects' if data.get('whole_episode') else 'briefs'
    values = data[key]
    if len(values) < 2:
        raise RuntimeError('podcast_review_indivisible_work_exhausted')
    middle = len(values) // 2
    return [issue for part in (values[:middle], values[middle:])
            for issue in review(context, {**data, key: part}, request)]
