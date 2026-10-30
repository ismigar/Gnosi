"""Apply grounded review edits without regenerating an already bounded episode."""
from __future__ import annotations

import hashlib
import json
from typing import Any, Callable, TYPE_CHECKING

from backend.services.agent_behavior import resource
from backend.services.podcast_briefing import _object
from backend.services.podcast_policy import synthesis_context_limit

if TYPE_CHECKING:
    from backend.services.podcast_briefing import _Briefing


def _quote_overlaps(previous: str, start: int, end: int, quote: str) -> bool:
    """Bind to an occurrence in the original, including a partially quoted clause."""
    offset = previous.find(quote) if quote.strip() else -1
    while offset >= 0:
        if start < offset + len(quote) and offset < end:
            return True
        offset = previous.find(quote, offset + 1)
    return False


def _replace(previous: str, intervals: list[tuple[int, int, str]]) -> str:
    chunks: list[str] = []
    cursor = 0
    for start, end, after in intervals:
        chunks.extend((previous[cursor:start], after))
        cursor = end
    chunks.append(previous[cursor:])
    return ''.join(chunks)


def apply_edits(result: dict[str, Any], previous: str, findings: list[dict[str, Any]],
                minimum: int, maximum: int) -> str:
    """Match every edit against the immutable reviewed draft, never partial edits."""
    digest = hashlib.sha256(previous.encode()).hexdigest()
    if result['draft_sha256'] != digest:
        raise ValueError('podcast_revision_draft_mismatch')
    intervals: list[tuple[int, int, str]] = []
    covered: set[int] = set()
    errors: list[dict[str, Any]] = []
    unresolved: list[int] = []
    for number, edit in enumerate(result['edits']):
        before, after = edit['before'], edit['after']
        start = previous.find(before)
        if (not before.strip() or before == after or start < 0
                or previous.find(before, start + 1) >= 0):
            errors.append({'edit': number, 'error': 'podcast_revision_requires_unique_original_anchor'})
            unresolved.append(number)
            continue
        for index in edit['finding_indices']:
            issue = findings[index]
            if issue['kind'] != 'omission' and not any(
                    _quote_overlaps(previous, start, start + len(before), quote)
                    for quote in issue.get('narration_quotes', [])):
                errors.append({'edit': number, 'finding': index,
                               'error': 'podcast_revision_anchor_must_include_affected_quote'})
        intervals.append((start, start + len(before), after))
        covered.update(edit['finding_indices'])
    if covered != set(range(len(findings))):
        errors.append({'error': 'podcast_revision_must_address_all_findings',
                       'missing': sorted(set(range(len(findings))) - covered)})
    intervals.sort()
    overlapping = any(left[1] > right[0] for left, right in zip(intervals, intervals[1:]))
    narration = '' if overlapping else _replace(previous, intervals)
    budget = {'minimum': minimum, 'maximum': maximum, 'original_words': len(previous.split()),
              'proposed_words': None if overlapping else len(narration.split()),
              'scope': 'unavailable_overlapping' if overlapping else
                       'valid_anchors_only' if unresolved else 'complete',
              'unresolved_edit_indices': unresolved}
    if overlapping:
        errors.append({'error': 'podcast_revision_overlapping_edits'})
    elif not minimum <= len(narration.split()) <= maximum:
        errors.insert(0, {'error': 'podcast_revision_word_budget'})
    if errors:
        # Report independent failures together: the only repair call must see
        # length as well as anchor problems. Partial prose is never returned.
        raise ValueError(json.dumps({'word_budget': budget, 'errors': errors}, separators=(',', ':')))
    return narration


def revise(context: _Briefing, data: dict[str, Any], options: dict[str, Any],
           request_builder: Callable[..., Any]) -> dict[str, Any] | None:
    """Use the ordinary two-call stage only when the complete reviewed draft fits."""
    previous = data.get('previous_draft', '')
    feedback = data.get('feedback', [])
    minimum, maximum = options['min_words'], options['max_words']
    if (not isinstance(previous, str) or not isinstance(feedback, list) or not feedback
            or not minimum <= len(previous.split()) <= maximum):
        return None
    digest = hashlib.sha256(previous.encode()).hexdigest()
    edit = _object({'before': {'type': 'string', 'minLength': 1, 'maxLength': 512},
                    'after': {'type': 'string', 'maxLength': 1024},
                    'finding_indices': {'type': 'array', 'uniqueItems': True,
                        'maxItems': len(feedback),
                        'items': {'type': 'integer', 'minimum': 0, 'maximum': len(feedback) - 1}}})
    schema = _object({'draft_sha256': {'type': 'string', 'enum': [digest]},
                      'edits': {'type': 'array', 'minItems': 1,
                                'maxItems': 2 * len(feedback) + 2, 'items': edit}})
    payload = {key: value for key, value in data.items() if key != 'composition_groups'}
    payload.update(revision_encoding='grounded_edits_v1', draft_sha256=digest,
                   planned_groups=data.get('composition_groups', []),
                   revision_budget={'original_words': len(previous.split()),
                       'minimum': minimum, 'maximum': maximum,
                       'target': options.get('target_words'),
                       'minimum_word_delta': minimum - len(previous.split()),
                       'maximum_word_delta': maximum - len(previous.split())})
    request = request_builder(context, 'write', payload, schema, **options,
        revision_contract=resource('operations/podcast/revision-contract.md'))
    if context.cost(request) > synthesis_context_limit(context):
        return None
    def checked(result: dict[str, Any]) -> None:
        apply_edits(result, previous, feedback, minimum, maximum)
    result = context.stage(request, checked)
    return {'narration': apply_edits(result, previous, feedback, minimum, maximum)}
