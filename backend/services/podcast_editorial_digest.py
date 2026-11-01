"""Condense a broad day by its checked themes before writing listener prose."""
from __future__ import annotations

from typing import Any

from backend.services.agent_behavior import resource
from backend.services.podcast_briefing import _object
from backend.services.podcast_outline import _digest_part_ids


def grouped_evidence(context: Any, data: dict[str, Any]) -> dict[str, Any]:
    briefs = data.get('briefs', [])
    groups = data.get('subject_groups', [])
    if len(briefs) < 48 or not groups or not all(group.get('part_ids') for group in groups):
        return data
    expected = _digest_part_ids(briefs)
    members = _digest_part_ids(groups)
    if set(members) != set(expected):
        raise ValueError('podcast_editorial_digest_source_scope_changed')
    by_id = {brief['part_id']: brief for brief in briefs}
    supplied = [{'key': f'group:{i}', 'topic': group['topic'],
        'subjects': group.get('subjects', [group['topic']]),
        'briefs': [by_id[key] for key in group['part_ids']]} for i, group in enumerate(groups)]
    schema = _object({'digests': _object({group['key']: {'type': 'string', 'minLength': 1}
                                        for group in supplied})})
    request = context.request('podcast.coverage.digest', {'grouped_sources': supplied}, schema).model_copy(
        update={'options': {'group_digest_contract': resource('operations/podcast/group-digest-contract.md')}})
    if context.cost(request) > context.budget:
        return data  # Retain the existing complete-source recursive context reduction.
    def checked(value: dict[str, Any]) -> None:
        if any(not text.strip() for text in value['digests'].values()):
            raise ValueError('podcast_empty_editorial_digest')
    result = context.stage(request, checked)
    digests = [{'topic': group['topic'], 'part_ids': list(group['part_ids']),
                'summary': result['digests'][f'group:{i}']} for i, group in enumerate(groups)]
    if _digest_part_ids(digests) != members:
        raise ValueError('podcast_editorial_digest_source_scope_changed')
    return {**{key: value for key, value in data.items() if key != 'briefs'}, 'digests': digests}
