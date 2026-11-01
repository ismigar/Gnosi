"""One editable editorial group cannot make its child-subject audit indivisible."""
import copy
import json
from types import SimpleNamespace

import pytest
from openai import LengthFinishReasonError

from backend.services.podcast_automatic import _request
from backend.services.podcast_briefing import _Briefing
from backend.services.podcast_review import review


@pytest.mark.parametrize('exhaustion', ['context', 'timeout', 'length'])
def test_single_editorial_group_reviews_every_child_and_keeps_original_data(monkeypatch, exhaustion):
    subjects = [f'Subject {i}: essential qualification.' for i in range(17)]
    narration = 'The same complete episode remains available to every review.'
    data = {'whole_episode': True, 'subjects': [subjects],
            'sections': [{'topic': 'Complete episode', 'part_ids': [f'source:{i}' for i in range(17)],
                          'narration': narration}]}
    before = copy.deepcopy(data)
    saved, seen, requests = {}, [], []
    snapshot = SimpleNamespace(scope='test', parent_run_id='day', revision='frozen', origin='button',
        skill_instructions={'core.gnosi-daily-briefing': '```json\n{"podcast_preferences":{"max_topic_groups":1}}\n```'})
    context = _Briefing(snapshot, 'Catalan', 80000, len, lambda: None)
    def count(request):
        value = json.loads(request.input)['data']
        return sum(len(group) for group in value['subjects'])
    context.cost = lambda request: 90000 if exhaustion == 'context' and count(request) > 4 else 1000
    def checkpoint(scope, parent, key, value=None):
        assert (scope, parent) == ('test', 'day')
        if value is not None:
            saved[key] = copy.deepcopy(value)
        return copy.deepcopy(saved.get(key))
    monkeypatch.setattr('backend.services.agent_execution_store.work_checkpoint', checkpoint)
    finding = {'kind': 'omission', 'detail': 'Retain the final minority subject.',
               'narration_quotes': [], 'source_part_ids': [], 'evidence_quote': subjects[-1]}
    def respond(request, **kwargs):
        value = json.loads(request.input)['data']
        requests.append(request)
        assert value['sections'] == [{'narration': narration}]
        assert request.options['editorial_policy']['max_topic_groups'] == 1
        if count(request) > 4:
            if exhaustion == 'timeout':
                raise TimeoutError()
            if exhaustion == 'length':
                raise LengthFinishReasonError(completion=SimpleNamespace(usage=None))
            pytest.fail('Oversized context must not reach a model')
        leaf = [subject for group in value['subjects'] for subject in group]
        if 'candidate_findings' in value:
            result = {'confirmed_finding_ids': [row['finding_id'] for row in value['candidate_findings']]}
        else:
            seen.extend(leaf)
            result = {'issues': [finding] if subjects[-1] in leaf else []}
        text = json.dumps(result)
        kwargs['output_validator'](text)
        return SimpleNamespace(result=text)
    monkeypatch.setattr('backend.services.agent_execution.run_sync', respond)
    assert review(context, data, _request) == [finding]
    assert seen == subjects and data == before
    assert all(request.timeout_seconds == 300 and request.max_model_calls == 2 for request in requests)
    # A resumed audit reuses its complete leaves and retains their positive finding.
    first_count = len(requests)
    assert review(context, data, _request) == [finding]
    assert len(requests) == first_count


def test_indivisible_child_failure_cannot_approve_a_whole_group():
    class Context:
        budget = 80000
        def cost(self, request):
            return 1000
        def stage(self, request, validate):
            raise TimeoutError()
    data = {'whole_episode': True, 'subjects': [['Only atomic subject']],
            'sections': [{'narration': 'The complete episode.'}]}
    with pytest.raises(RuntimeError, match='podcast_review_indivisible_work_exhausted'):
        review(Context(), data, lambda context, phase, value, schema: value)
