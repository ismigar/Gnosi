"""Ground model criticisms in exact supplied evidence before automatic rewrites."""
from __future__ import annotations

from typing import Any, Callable, cast

from openai import LengthFinishReasonError

from backend.services.podcast_briefing import _object


def _confirmation_choices(data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Resolve application-owned references without editing model-origin findings."""
    choices: dict[str, dict[str, Any]] = {}
    candidates = data['candidate_findings']
    if not isinstance(candidates, list):
        raise ValueError('podcast_audit_confirmation_invalid_scope')
    for candidate in candidates:
        if (not isinstance(candidate, dict) or set(candidate) != {'finding_id', 'finding'}
                or not isinstance(candidate['finding_id'], str) or not candidate['finding_id']
                or candidate['finding_id'] in choices or not isinstance(candidate['finding'], dict)):
            raise ValueError('podcast_audit_confirmation_invalid_scope')
        choices[candidate['finding_id']] = candidate['finding']
    return choices


def _schema(data: dict[str, Any]) -> dict[str, Any]:
    if 'candidate_findings' in data:
        choices = _confirmation_choices(data)
        return _object({'confirmed_finding_ids': {'type': 'array', 'uniqueItems': True,
            'maxItems': len(choices), 'items': {'type': 'string', 'enum': list(choices) or ['']}}})
    ids = [b['part_id'] for b in data.get('briefs', [])]
    kinds = ['omission', 'production', 'duplicate']
    if not data.get('whole_episode'):
        kinds.append('distortion')
    if data.get('review_focus') == 'fidelity':
        kinds = ['distortion']
    elif data.get('review_focus') == 'coverage':
        kinds = ['omission']
    source_references: dict[str, Any] = {'type': 'array', 'uniqueItems': True,
        'items': {'type': 'string', 'enum': ids or ['']}}
    if not data.get('whole_episode') and data.get('review_focus') in {'fidelity', 'coverage'}:
        source_references['minItems'] = 1
    finding = _object({
        'kind': {'type': 'string', 'enum': kinds},
        'detail': {'type': 'string', 'minLength': 1, 'maxLength': 500},
        'narration_quotes': {'type': 'array', 'maxItems': 2, 'uniqueItems': True,
            'items': {'type': 'string', 'minLength': 8, 'maxLength': 400}},
        'source_part_ids': source_references,
        'evidence_quote': {'type': 'string', 'maxLength': 400},
    })
    return _object({'issues': {'type': 'array', 'maxItems': 32, 'items': finding}})


def _validate(result: dict[str, Any], data: dict[str, Any]) -> None:
    narration = data.get('narration', '\n\n'.join(s['narration'] for s in data.get('sections', [])))
    if not data.get("whole_episode") and (not data.get("briefs") or
            any(not str(brief.get("source_text", "")).strip() for brief in data["briefs"])):
        raise ValueError("podcast_audit_original_evidence_missing")
    if 'candidate_findings' in data:
        choices = _confirmation_choices(data)
        selected = result.get('confirmed_finding_ids')
        if (set(result) != {'confirmed_finding_ids'} or not isinstance(selected, list)
                or any(not isinstance(key, str) or key not in choices for key in selected)
                or len(selected) != len(set(selected))):
            raise ValueError('podcast_audit_confirmation_invalid_reference')
        original_data = {key: value for key, value in data.items() if key != 'candidate_findings'}
        _validate({'issues': [choices[key] for key in selected]}, original_data)
        return
    for issue in result['issues']:
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
                         for key in ('source_text', 'title')]
        if not evidence or not any(evidence in value for value in available):
            raise ValueError('podcast_audit_invented_evidence_quote')


def _confirm(context: Any, data: dict[str, Any], issues: list[dict[str, Any]],
             request: Callable[..., Any]) -> list[dict[str, Any]]:
    batches: list[list[dict[str, Any]]] = [[]]
    limit = min(80_000, context.budget)
    for index, issue in enumerate(issues):
        choice = {'finding_id': f'finding:{index}', 'finding': issue}
        candidate = {**data, 'candidate_findings': [*batches[-1], choice]}
        if batches[-1] and context.cost(request(context, 'audit', candidate, _schema(candidate))) > limit:
            batches.append([])
        batches[-1].append(choice)
        single = {**data, 'candidate_findings': batches[-1]}
        if context.cost(request(context, 'audit', single, _schema(single))) > limit:
            raise RuntimeError('podcast_review_context_insufficient')
    confirmed = []
    for batch in batches:
        confirmation = {**data, 'candidate_findings': batch}
        result = _stage(context, confirmation, request)
        confirmed.extend(result['issues'])
    return confirmed


def _stage(context: Any, data: dict[str, Any], request: Callable[..., Any]) -> dict[str, Any]:
    """Split only exhausted or timed-out work; an indivisible failure never approves."""
    try:
        result = cast(dict[str, Any], context.stage(
            request(context, 'audit', data, _schema(data)), lambda r: _validate(r, data)))
        if 'candidate_findings' in data:
            choices = _confirmation_choices(data)
            return {'issues': [choices[key] for key in result['confirmed_finding_ids']]}
        return result
    except (LengthFinishReasonError, TimeoutError):
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
        except (LengthFinishReasonError, TimeoutError):
            exhausted = True
        else:
            return _confirm(context, data, result['issues'], request) if result['issues'] else []
    key = 'subjects' if data.get('whole_episode') else 'briefs'
    values = data[key]
    if len(values) < 2:
        raise RuntimeError('podcast_review_indivisible_work_exhausted')
    middle = len(values) // 2
    return [issue for part in (values[:middle], values[middle:])
            for issue in review(context, {**data, key: part}, request)]
