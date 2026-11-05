"""The brief writer returns one script and owns one two-call length check."""
import json

import pytest
import jsonschema

from backend.services import agent_execution_store as store
from backend.services.agent_execution_scope import execution_scope
from backend.services.podcast_automatic import _bounded_write
from backend.tests.test_agent_execution import runtime  # noqa: F401
from backend.tests.test_podcast_bounded_rewrites import context_for, counted_workflow


def passage_response(passages):
    from backend.services.podcast_length_edits import REPAIR_MARKER_PREFIX
    tokens = []
    for index, passage in enumerate(passages):
        tokens.extend([REPAIR_MARKER_PREFIX + str(index), *passage.split()])
    return json.dumps({'replacement_tokens': tokens})


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


@pytest.mark.parametrize('enough_compression', [True, False])
def test_large_day_repairs_complete_passages_within_the_original_two_calls(runtime, monkeypatch, enough_compression):
    scope, snapshot = runtime
    # Paragraph counts observed in the installed 2,594-word automatic draft.
    counts = [44, 97, 158, 143, 100, 184, 195, 225, 209, 145, 223, 174, 226, 170, 264, 37]
    originals = [' '.join([f'theme-{i}', *(['original'] * (count - 1))])
                 for i, count in enumerate(counts)]
    from backend.services.podcast_composition import advisory_targets
    shares = advisory_targets(1380, dict(enumerate(counts)), minimum=1)
    shorter = {
        f'passage:{i}': ' '.join([f'theme-{i}', *(['compressed'] * (shares[i] - 1 if enough_compression else count - 2))])
        for i, count in enumerate(counts)
    }
    draft = '\n\n'.join(originals)
    calls = counted_workflow(monkeypatch, [
        json.dumps({'narration': draft}), passage_response(shorter.values()),
    ])
    context = context_for(snapshot)
    data = {'composition_encoding': 'bounded_narration_v1',
            'briefs': [{'part_id': 'source:0', 'summary': 'Essential qualification.'}]}
    options = {'min_words': 1104, 'max_words': 1656, 'target_words': 1380}
    with execution_scope(scope):
        if enough_compression:
            result = _bounded_write(context, data, options)
            paragraphs = result['narration'].split('\n\n')
            assert 1104 <= len(result['narration'].split()) <= 1656
            assert len(paragraphs) == len(counts)
            assert paragraphs == list(shorter.values())
        else:
            with pytest.raises(jsonschema.ValidationError):
                _bounded_write(context, data, options)
    assert len(calls) == 2 and len(context.requests) == 1
    assert context.requests[0].timeout_seconds == 300
    repair = json.loads(json.loads(calls[1]['messages'][0].content)['input'])['data']
    assert repair['briefs'] == data['briefs']
    length_repair = repair['length_repair']
    assert length_repair['mode'] == 'compress_passage_stream'
    assert length_repair['replacement_word_range'] == {'minimum': 1104, 'maximum': 1656}
    assert [p['text'] for p in length_repair['original_groups'].values()] == originals
    assert 'No per-anchor word caps' in length_repair['instructions']


def test_passage_repair_preserves_crlf_and_the_existing_advisory_range(runtime, monkeypatch):
    scope, snapshot = runtime
    original = ' '.join(['Supported'] * 950)
    shortened = ' '.join(['Condensed'] * 850)
    calls = counted_workflow(monkeypatch, [
        json.dumps({'narration': original + '\r\n\r\n' + original}),
        passage_response([shortened, shortened]),
    ])
    context = context_for(snapshot)
    with execution_scope(scope):
        result = _bounded_write(context, {'composition_encoding': 'bounded_narration_v1'},
            {'min_words': 1104, 'max_words': 1656, 'target_words': 1380, 'word_range_is_advisory': True})
    assert result['narration'] == shortened + '\n\n' + shortened
    assert len(calls) == 2 and len(context.requests) == 1


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


@pytest.mark.parametrize('response_words', [1380, 2836])
def test_observed_39_passage_day_uses_one_shared_bounded_word_stream(runtime, monkeypatch, response_words):
    from backend.services.podcast_composition import advisory_targets
    counts = [52, 76, 109, 90, 93, 133, 97, 96, 100, 69, 61, 75, 83, 79, 89, 136, 88,
              79, 96, 87, 90, 83, 104, 83, 92, 98, 92, 88, 87, 107, 58, 126, 89, 129, 95,
              80, 104, 128, 45]
    scope, snapshot = runtime
    original = [' '.join([f'theme-{i}', *(['original'] * (count - 1))])
                for i, count in enumerate(counts)]
    shares = advisory_targets(response_words, dict(enumerate(counts)), minimum=1)
    replacements = [' '.join([f'theme-{i}', *(['compressed'] * (shares[i] - 1))])
                    for i in range(len(counts))]
    calls = counted_workflow(monkeypatch, [
        json.dumps({'narration': '\n\n'.join(original)}), passage_response(replacements)])
    context = context_for(snapshot)
    options = {'min_words': 1104, 'max_words': 1656, 'target_words': 1380, 'word_range_is_advisory': True}
    with execution_scope(scope):
        if response_words == 1380:
            result = _bounded_write(context, {'composition_encoding': 'bounded_narration_v1'}, options)
            assert result['narration'].split('\n\n') == replacements
            assert len(result['narration'].split()) == 1380
        else:
            with pytest.raises(jsonschema.ValidationError):
                _bounded_write(context, {'composition_encoding': 'bounded_narration_v1'}, options)
    assert len(calls) == 2 and len(context.requests) == 1
    sent = json.loads(json.loads(calls[1]['messages'][0].content)['input'])
    bounds = sent['data']['length_repair']['replacement_word_range']
    assert bounds == {'minimum': 1050, 'maximum': 1749}


@pytest.mark.parametrize('invalid', ['whitespace', 'missing', 'reordered', 'duplicate', 'empty'])
def test_passage_stream_locally_rejects_invalid_tokens_or_lost_passages(invalid):
    from backend.services.podcast_passage_length import passage_stream
    repair = passage_stream({'a': 'One original.', 'b': 'Another original.'}, range(2, 21))
    tokens = json.loads(passage_response(['One shorter.', 'Another shorter.']))['replacement_tokens']
    if invalid == 'whitespace':
        tokens[1] = 'two words'
    elif invalid == 'missing':
        tokens.pop(0)
    elif invalid == 'reordered':
        tokens[0], tokens[3] = tokens[3], tokens[0]
    elif invalid == 'duplicate':
        tokens[3] = tokens[0]
    else:
        tokens = tokens[:4]
    assert repair.output_schema['properties']['replacement_tokens']['items'] == {'type': 'string', 'pattern': r'^\S+$'}
    with pytest.raises((ValueError, jsonschema.ValidationError)):
        repair.restore(json.dumps({'replacement_tokens': tokens}))


def test_long_episode_keeps_complete_passage_selection_fallback():
    from backend.services.podcast_passage_length import fit_passages, passage_stream
    assert passage_stream({'a': 'Original.', 'b': 'Other.'}, range(2000, 2601)) is None
    originals = {'a': ' '.join(['Original'] * 1700), 'b': ' '.join(['Other'] * 1700)}
    alternatives = {'a': ' '.join(['Shorter'] * 1000), 'b': ' '.join(['Condensed'] * 1000)}
    result = fit_passages(originals, alternatives, preferred=range(2000, 2601),
                          accepted=range(2000, 2601), target=2300)
    assert result == alternatives['a'] + '\n\n' + alternatives['b']
