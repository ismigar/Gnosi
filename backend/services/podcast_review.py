"""Ground model criticisms in exact supplied evidence before automatic rewrites."""
from __future__ import annotations

import json
from typing import Any, Callable, cast

from openai import LengthFinishReasonError

from backend.services.podcast_briefing import _object


_QUOTE_COUNTS = {'omission': 0, 'distortion': 1, 'production': 1, 'duplicate': 2}


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
    def finding(kind: str, references: dict[str, Any]) -> dict[str, Any]:
        count = _QUOTE_COUNTS[kind]
        return _object({
            'kind': {'type': 'string', 'enum': [kind]},
            'detail': {'type': 'string', 'minLength': 1, 'maxLength': 500},
            'narration_quotes': {'type': 'array', 'minItems': count, 'maxItems': count,
                'uniqueItems': True, 'items': {'type': 'string', 'minLength': 8, 'maxLength': 400}},
            'source_part_ids': references,
            'evidence_quote': {'type': 'string', 'maxLength': 400},
        })

    if len(kinds) == 1:
        return _object({'issues': {'type': 'array', 'maxItems': 32,
                                  'items': finding(kinds[0], source_references)}})
    # Share the complete source enum once, keeping the same context allowance.
    result = _object({'issues': {'type': 'array', 'maxItems': 32, 'items': {'anyOf': [
        finding(kind, {'$ref': '#/$defs/source_references'}) for kind in kinds]}}})
    result['$defs'] = {'source_references': source_references}
    return result


def _validate_structure(result: dict[str, Any], data: dict[str, Any]) -> None:
    """Check every fixed finding field before considering literal-only recovery."""
    for issue in result['issues']:
        kind, ids = issue['kind'], issue['source_part_ids']
        if len(issue['narration_quotes']) != _QUOTE_COUNTS[kind]:
            raise ValueError('podcast_audit_quote_count')
        if kind in {'production', 'duplicate'}:
            if ids or issue['evidence_quote']:
                raise ValueError('podcast_audit_unexpected_source_claim')
        elif data.get('whole_episode'):
            if ids:
                raise ValueError('podcast_audit_subject_ledger_has_no_source_ids')
        elif not ids:
            raise ValueError('podcast_audit_missing_evidence_ids')


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
    _validate_structure(result, data)
    for issue in result['issues']:
        kind, quotes, ids = issue['kind'], issue['narration_quotes'], issue['source_part_ids']
        if any(quote not in narration for quote in quotes):
            raise ValueError('podcast_audit_invented_narration_quote')
        evidence = issue['evidence_quote']
        if kind in {'production', 'duplicate'}:
            continue
        if data.get('whole_episode'):
            available = [subject for group in data['subjects'] for subject in group]
        else:
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


def _partition_values(data: dict[str, Any]) -> tuple[str, list[Any]]:
    key = 'candidate_findings' if 'candidate_findings' in data else ('subjects' if data.get('whole_episode') else 'briefs')
    values = data.get(key, [])
    if key == 'subjects' and len(values) == 1 and isinstance(values[0], list) and len(values[0]) > 1:
        values = [[subject] for subject in values[0]]
    return key, values


def _has_saved(context: Any, data: dict[str, Any], request: Callable[..., Any]) -> bool:
    method = getattr(context, 'has_saved', None)
    return bool(callable(method) and method(request(context, 'audit', data, _schema(data))))


def _saved_descendant(context: Any, data: dict[str, Any], request: Callable[..., Any]) -> bool:
    if not callable(getattr(context, 'has_saved', None)):
        return False
    key, values = _partition_values(data)
    if len(values) < 2:
        return False
    middle = len(values) // 2
    return any(_has_saved(context, child, request) or _saved_descendant(context, child, request)
               for part in (values[:middle], values[middle:]) for child in ({**data, key: part},))


def _resume_partition(context: Any, data: dict[str, Any], request: Callable[..., Any]) -> bool:
    if len(_partition_values(data)[1]) < 2:
        return False
    method = getattr(context, 'audit_partition', None)
    return bool((callable(method) and method(request(context, 'audit', data, _schema(data))))
                or _saved_descendant(context, data, request))


def _mark_partition(context: Any, data: dict[str, Any], request: Callable[..., Any]) -> None:
    method = getattr(context, 'audit_partition', None)
    if callable(method):
        method(request(context, 'audit', data, _schema(data)), split=True)


def _distinct(issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return list({json.dumps(issue, sort_keys=True): issue for issue in issues}.values())


def _resolved(result: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    if 'candidate_findings' in data:
        choices = _confirmation_choices(data)
        return {'issues': [choices[key] for key in result['confirmed_finding_ids']]}
    return result


def _stage(context: Any, data: dict[str, Any], request: Callable[..., Any]) -> dict[str, Any]:
    """Split only exhausted or timed-out work; an indivisible failure never approves."""
    operation = request(context, 'audit', data, _schema(data))
    if _resume_partition(context, data, request):
        _mark_partition(context, data, request)
        prior = _resolved(context.stage(operation, lambda r: _validate(r, data)), data)['issues'] if _has_saved(context, data, request) else []
        key, values = _partition_values(data)
        middle = len(values) // 2
        return {'issues': _distinct(prior + [issue for part in (values[:middle], values[middle:])
            for issue in _stage(context, {**data, key: part}, request)['issues']])}
    try:
        result = cast(dict[str, Any], context.stage(operation, lambda r: _validate(r, data)))
        return _resolved(result, data)
    except (LengthFinishReasonError, TimeoutError):
        key, values = _partition_values(data)
        if len(values) < 2:
            raise
        _mark_partition(context, data, request)
        middle = len(values) // 2
        leaves = [_stage(context, {**data, key: part}, request)
                  for part in (values[:middle], values[middle:])]
        return {'issues': [issue for leaf in leaves for issue in leaf['issues']]}


def review(context: Any, data: dict[str, Any], request: Callable[..., Any]) -> list[dict[str, Any]]:
    schema = _schema(data)
    operation = request(context, 'audit', data, schema)
    if _resume_partition(context, data, request):
        _mark_partition(context, data, request)
        prior = context.stage(operation, lambda r: _validate(r, data)) if _has_saved(context, data, request) else {'issues': []}
        confirmed = _confirm(context, data, prior['issues'], request) if prior['issues'] else []
        key, values = _partition_values(data)
        middle = len(values) // 2
        return _distinct(confirmed + [issue for part in (values[:middle], values[middle:])
            for issue in review(context, {**data, key: part}, request)])
    exhausted = context.cost(operation) > min(80_000, context.budget)
    if not exhausted:
        try:
            result = context.stage(operation, lambda r: _validate(r, data))
        except (LengthFinishReasonError, TimeoutError):
            exhausted = True
        else:
            return _confirm(context, data, result['issues'], request) if result['issues'] else []
    key, values = _partition_values(data)
    if len(values) < 2:
        raise RuntimeError('podcast_review_indivisible_work_exhausted')
    _mark_partition(context, data, request)
    middle = len(values) // 2
    return [issue for part in (values[:middle], values[middle:])
            for issue in review(context, {**data, key: part}, request)]
