"""The brief writer returns one script and owns one two-call length check."""
import json

import pytest

from backend.services import agent_execution_store as store
from backend.services.agent_execution_scope import execution_scope
from backend.services.podcast_automatic import _bounded_write
from backend.tests.test_agent_execution import runtime  # noqa: F401
from backend.tests.test_podcast_bounded_rewrites import context_for, counted_workflow


def narration(words):
    return json.dumps({'narration': ' '.join(['Supported.'] * words)})


@pytest.mark.parametrize('words', [1097, 1235, 1663, 1728])
def test_advisory_range_does_not_reject_a_few_words_near_a_boundary(runtime, monkeypatch, words):
    scope, snapshot = runtime
    calls = counted_workflow(monkeypatch, [narration(words)])
    with execution_scope(scope):
        result = _bounded_write(context_for(snapshot), {'composition_encoding': 'bounded_narration_v1'},
            {'min_words': 1104, 'max_words': 1656, 'target_words': 1380, 'word_range_is_advisory': True})
    assert len(calls) == 1 and len(result['narration'].split()) == words


def test_duration_tolerance_produces_broad_word_guidance():
    from backend.services.podcast_policy import preferences
    policy = preferences(None)
    assert policy.duration_tolerance_percent == 20
    assert policy.word_range(1380) == (1104, 1656)
    assert policy.model_copy(update={'duration_tolerance_percent': 25}).word_range(1380) == (1035, 1725)


@pytest.mark.parametrize('first_words', [765, 1815, 2620])
def test_length_retry_uses_the_same_plain_schema_sources_and_two_call_stage(runtime, monkeypatch, first_words):
    scope, snapshot = runtime
    calls = counted_workflow(monkeypatch, [narration(first_words), narration(1380)])
    context = context_for(snapshot)
    data = {'composition_encoding': 'bounded_narration_v1',
            'briefs': [{'part_id': f'source:{i}', 'summary': f'Distinct source {i}.'} for i in range(222)],
            'subject_groups': [{'topic': f'Theme {i}', 'subjects': [f'Theme {i}']} for i in range(12)]}
    with execution_scope(scope):
        result = _bounded_write(context, data, {'min_words': 1242, 'max_words': 1504, 'target_words': 1380})
        rows = store.list_runs(scope)
    assert len(result['narration'].split()) == 1380
    assert len(calls) == rows[0].model_calls == 2 and len(rows) == len(context.requests) == 1
    request = context.requests[0]
    assert request.timeout_seconds == 300 and request.max_model_calls == 2
    assert set(request.output_schema['properties']) == {'narration'}
    assert {key: value for key, value in json.loads(request.input)['data'].items() if key != 'language'} == data
    assert len(calls[1]['messages']) == 1
    repair = json.loads(json.loads(calls[1]['messages'][0].content)['input'])['data']
    assert repair['briefs'] == data['briefs']
    assert repair['subject_groups'] == data['subject_groups']
    assert repair['previous_draft'] == json.loads(narration(first_words))['narration']
    assert repair['length_repair']['word_delta'] == 1380 - first_words


def test_invalid_second_plain_script_fails_without_opening_another_stage(runtime, monkeypatch):
    scope, snapshot = runtime
    calls = counted_workflow(monkeypatch, [narration(2112), narration(1811)])
    context = context_for(snapshot)
    with execution_scope(scope), pytest.raises(ValueError, match='podcast_word_budget'):
        _bounded_write(context, {'composition_encoding': 'bounded_narration_v1'},
                       {'min_words': 1242, 'max_words': 1504, 'target_words': 1380})
    assert len(calls) == 2 and len(context.requests) == 1


def test_near_context_limit_recomposes_with_evidence_and_absolute_target(runtime, monkeypatch):
    scope, snapshot = runtime
    calls = counted_workflow(monkeypatch, [narration(2620), narration(1380)])
    context = context_for(snapshot)
    original_cost = context.cost
    monkeypatch.setattr(context, 'cost', lambda request:
        context.budget + 1 if 'previous_draft' in json.loads(request.input)['data'] else original_cost(request))
    data = {'composition_encoding': 'bounded_narration_v1',
            'briefs': [{'part_id': 'source:0', 'summary': 'Qualified original claim.'}]}
    with execution_scope(scope):
        result = _bounded_write(context, data, {'min_words': 1104, 'max_words': 1656, 'target_words': 1380})
    assert len(result['narration'].split()) == 1380 and len(calls) == 2
    repair = json.loads(json.loads(calls[1]['messages'][0].content)['input'])['data']
    assert 'previous_draft' not in repair
    assert repair['briefs'] == data['briefs']
    assert repair['length_repair'] == {
        'mode': 'fresh_composition', 'target_words': 1380, 'min_words': 1104, 'max_words': 1656,
    }


@pytest.mark.parametrize('words,valid', [(1241, False), (1242, True), (1380, True),
                                        (1504, True), (1505, False), (3388, False)])
def test_complete_script_count_remains_independent_of_native_passage_count(runtime, monkeypatch, words, valid):
    scope, snapshot = runtime
    calls = counted_workflow(monkeypatch, [narration(words), narration(words)])
    context = context_for(snapshot)
    with execution_scope(scope):
        if valid:
            result = _bounded_write(context, {'composition_encoding': 'bounded_narration_v1'},
                                    {'min_words': 1242, 'max_words': 1504, 'target_words': 1380})
            assert len(result['narration'].split()) == words
        else:
            with pytest.raises(ValueError, match='podcast_word_budget'):
                _bounded_write(context, {'composition_encoding': 'bounded_narration_v1'},
                               {'min_words': 1242, 'max_words': 1504, 'target_words': 1380})
    assert len(context.requests) == 1 and len(calls) == (1 if valid else 2)
