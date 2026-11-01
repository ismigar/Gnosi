"""Resolved app limits guide writing without editing any profile, skill or permissions."""
from copy import deepcopy
from types import SimpleNamespace

from backend.services.agent_execution_models import AgentOperation
from backend.services.podcast_briefing import _write_snapshot


def test_exact_global_limits_are_scoped_to_the_write_and_preserve_user_configuration():
    snapshot = SimpleNamespace(instructions=['Original instructions.'], revision='original',
        skill_instructions={'s': 'Original editable skill.'}, skill_ids=['s'],
        profile={'model': 'unchanged', 'reasoning_enabled': False, 'tools': ['reader']})
    original = deepcopy(snapshot)
    request = AgentOperation(skill_id='s', operation='podcast.coverage.write',
        options={'min_words': 1242, 'target_words': 1380, 'max_words': 1504})
    scoped = _write_snapshot(snapshot, request)
    assert scoped is not snapshot and scoped.revision != snapshot.revision
    assert '1242..1504' in scoped.instructions[-1] and '1380' in scoped.instructions[-1]
    assert 'one shared episode budget' in scoped.instructions[-1]
    assert 'newest count diagnostic' in scoped.instructions[-1]
    assert scoped.profile == original.profile and scoped.skill_ids == original.skill_ids
    assert snapshot == original and scoped.skill_instructions['s'].startswith(original.skill_instructions['s'])


def test_other_stages_and_unvalidated_numeric_options_are_not_promoted_to_instructions():
    snapshot = SimpleNamespace()
    for operation, values in [('podcast.coverage.audit', [1242, 1380, 1504]),
                              ('podcast.coverage.write', [True, 1380, 1504]),
                              ('podcast.coverage.write', [1242, 2000, 1504])]:
        request = AgentOperation(skill_id='s', operation=operation,
            options=dict(zip(['min_words', 'target_words', 'max_words'], values)))
        assert _write_snapshot(snapshot, request) is snapshot
