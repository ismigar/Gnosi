"""Internal compression keeps exact source membership and the full review pool."""
import copy
import json

import pytest

from backend.services.agent_execution_models import AgentOperation
from backend.services.podcast_editorial_digest import grouped_evidence
from backend.tests.test_podcast_briefing import pipeline  # noqa: F401


def evidence():
    briefs = [{'part_id': f'{i}:0', 'topic': f'Theme {i}', 'summary': f'Evidence {i}.'} for i in range(60)]
    return {'briefs': briefs, 'subject_groups': [
        {'topic': 'Repeated event', 'part_ids': [b['part_id'] for b in briefs[:-1]]},
        {'topic': 'Practical guide', 'part_ids': [briefs[-1]['part_id']]}]}


class Context:
    budget = 100000
    def __init__(self): self.calls = []
    def request(self, task, data, schema):
        return AgentOperation(skill_id='core.gnosi-daily-briefing', operation=task,
                              input=json.dumps(data), output_schema=schema)
    def cost(self, request): return 100
    def stage(self, request, validate):
        self.calls.append(request)
        value = {'digests': {'group:0': 'Repeated reports combined.',
                             'group:1': 'Report photographs through the reservation; use the phone for emergencies.'}}
        validate(value)
        return value


def test_group_digest_keeps_the_single_source_guide_and_every_original_id():
    data = evidence(); original = copy.deepcopy(data); context = Context()
    result = grouped_evidence(context, data)
    assert data == original and len(context.calls) == 1 and 'briefs' not in result
    assert [key for d in result['digests'] for key in d['part_ids']] == [b['part_id'] for b in data['briefs']]
    assert result['digests'][1]['part_ids'] == ['59:0']
    assert 'photographs' in result['digests'][1]['summary']
    supplied = json.loads(context.calls[0].input)['grouped_sources']
    assert sum(len(group['briefs']) for group in supplied) == 60


def test_invalid_group_membership_fails_before_spending_a_model_call():
    data = evidence(); data['subject_groups'][1]['part_ids'] = ['foreign:0']; context = Context()
    with pytest.raises(ValueError, match='source_scope_changed'):
        grouped_evidence(context, data)
    assert context.calls == []


def test_insufficient_grouping_context_retains_the_original_complete_evidence():
    data = evidence(); context = Context(); context.budget = 50
    assert grouped_evidence(context, data) is data and not context.calls


def test_large_brief_day_writes_and_reviews_every_original_note_when_context_fits(pipeline):
    from backend.tests.test_podcast_brief_review import brief_mode
    brief_mode(pipeline)
    pipeline.monkeypatch.setattr('backend.domains.agent.runtime_tools._model_context_window', lambda *_: 1_050_000)
    sources = [{'id': str(i), 'title': f'Subject {i}', 'text': f'Original evidence for subject {i}.'} for i in range(60)]
    pipeline.run(sources)
    digests = [c for c in pipeline.calls if c['task'].endswith('digest') and 'grouped_sources' in c['data']]
    assert digests == []
    write = next(c for c in pipeline.calls if c['task'].endswith('write'))
    assert 'digests' not in write['data']
    assert len(write['data']['briefs']) == 60
    assert {b['source_id'] for b in write['data']['briefs']} == {s['id'] for s in sources}
    audit = next(c for c in pipeline.calls if c['task'].endswith('audit'))
    assert len(audit['data']['source_summaries']) == 60
    assert {b['source_id'] for b in audit['data']['source_summaries']} == {s['id'] for s in sources}


def test_writer_retains_grouping_fallback_when_the_complete_request_exceeds_context():
    from backend.services.podcast_automatic import _write_request
    data = {**evidence(), 'composition_encoding': 'bounded_narration_v1'}
    context = Context()
    context.cost = lambda request: (context.budget + 1
        if request.operation.endswith('write') and 'briefs' in json.loads(request.input) else 100)
    request = _write_request(context, data, {'min_words': 2208, 'max_words': 3312, 'target_words': 2760})
    assert len(context.calls) == 1
    supplied = json.loads(request.input)
    assert 'briefs' not in supplied
    assert [key for d in supplied['digests'] for key in d['part_ids']] == [b['part_id'] for b in data['briefs']]
    assert context.cost(request) <= context.budget
