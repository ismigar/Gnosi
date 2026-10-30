"""Apply grounded review edits without regenerating an already bounded episode."""
from __future__ import annotations

import hashlib
from typing import Any, Callable, TYPE_CHECKING

from backend.services.agent_behavior import resource
from backend.services.podcast_briefing import _object
from backend.services.podcast_policy import synthesis_context_limit

if TYPE_CHECKING:
    from backend.services.podcast_briefing import _Briefing


def apply_edits(result: dict[str, Any], previous: str, findings: list[dict[str, Any]],
                minimum: int, maximum: int) -> str:
    """Match every edit against the immutable reviewed draft, never partial edits."""
    digest = hashlib.sha256(previous.encode()).hexdigest()
    if result['draft_sha256'] != digest:
        raise ValueError('podcast_revision_draft_mismatch')
    intervals: list[tuple[int, int, str]] = []
    covered: set[int] = set()
    for edit in result['edits']:
        before, after = edit['before'], edit['after']
        start = previous.find(before)
        if (not before.strip() or before == after or start < 0
                or previous.find(before, start + 1) >= 0):
            raise ValueError('podcast_revision_requires_unique_original_anchor')
        for index in edit['finding_indices']:
            issue = findings[index]
            if issue['kind'] != 'omission' and not any(
                    before in quote or quote in before for quote in issue.get('narration_quotes', [])):
                raise ValueError('podcast_revision_anchor_must_include_affected_quote')
        intervals.append((start, start + len(before), after))
        covered.update(edit['finding_indices'])
    if covered != set(range(len(findings))):
        raise ValueError('podcast_revision_must_address_all_findings')
    intervals.sort()
    if any(left[1] > right[0] for left, right in zip(intervals, intervals[1:])):
        raise ValueError('podcast_revision_overlapping_edits')
    chunks: list[str] = []
    cursor = 0
    for start, end, after in intervals:
        chunks.extend((previous[cursor:start], after))
        cursor = end
    chunks.append(previous[cursor:])
    narration = ''.join(chunks)
    words = len(narration.split())
    if not minimum <= words <= maximum:
        raise ValueError(f'podcast_revision_word_budget: expected {minimum}..{maximum}; received {words}')
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
                   planned_groups=data.get('composition_groups', []))
    request = request_builder(context, 'write', payload, schema, **options,
        revision_contract=resource('operations/podcast/revision-contract.md'))
    if context.cost(request) > synthesis_context_limit(context):
        return None
    def checked(result: dict[str, Any]) -> None:
        apply_edits(result, previous, feedback, minimum, maximum)
    result = context.stage(request, checked)
    return {'narration': apply_edits(result, previous, feedback, minimum, maximum)}
