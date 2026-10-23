"""Ground model criticisms in exact supplied evidence before automatic rewrites."""
from __future__ import annotations

from typing import Any, Callable

from backend.services.podcast_briefing import _object


def _schema(data: dict[str, Any]) -> dict[str, Any]:
    ids = [b['part_id'] for b in data.get('briefs', [])]
    kinds = ['omission', 'production', 'duplicate']
    if not data.get('whole_episode'):
        kinds.append('distortion')
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
        result = context.stage(request(context, 'audit', confirmation, schema),
                               lambda r: _validate(r, confirmation))
        confirmed.extend(result['issues'])
    return confirmed


def review(context: Any, data: dict[str, Any], request: Callable[..., Any]) -> list[str]:
    schema = _schema(data)
    result = context.stage(request(context, 'audit', data, schema), lambda r: _validate(r, data))
    issues = _confirm(context, data, result['issues'], request, schema) if result['issues'] else []
    return [f"{i['detail']} Evidence: {i['evidence_quote']} Draft: {' / '.join(i['narration_quotes'])}"
            for i in issues]
