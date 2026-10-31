"""The first length call bounds the full episode without echoing originals."""
import copy
import json

import jsonschema
import pytest

from backend.services.podcast_composition import spoken_text
from backend.services.podcast_length_edits import apply_edits, composition_digest, composition_stream
from backend.tests.test_podcast_length_word_repair import case


def response(base, words=1380):
    return {'replacement_tokens': ['__gnosi_edit__:0', *(['supported'] * (words - 185)),
        '__gnosi_edit__:1', *base['paragraphs']['minority']['text'].split()]}


def test_first_contract_has_one_original_copy_and_server_owned_anchors_and_flags():
    data, base, _ = case()
    stream = composition_stream(data, 1242, 1504)
    payload = json.loads(stream.input)
    assert payload['composition_sha256'] == composition_digest(base)
    assert payload['anchors'] == [{'marker': '__gnosi_edit__:0', 'group_key': 'main'},
                                  {'marker': '__gnosi_edit__:1', 'group_key': 'minority'}]
    assert payload['original_groups'] == base['paragraphs']
    assert stream.input.count(base['paragraphs']['main']['text']) == 1
    assert payload['replacement_word_range'] == {'minimum': 1242, 'maximum': 1504}
    assert set(stream.output_schema['properties']) == {'replacement_tokens'}
    result = apply_edits(json.loads(stream.restore(json.dumps(response(base)))), base, data, 1242, 1504)
    assert len(spoken_text(result, data).split()) == 1380
    assert result['paragraphs']['minority'] == base['paragraphs']['minority']
    assert result['paragraphs']['excluded'] == base['paragraphs']['excluded']


@pytest.mark.parametrize('words', [1241, 1242, 1380, 1504, 1505])
def test_first_response_schema_enforces_the_same_complete_episode_boundaries(words):
    data, base, _ = case()
    stream = composition_stream(data, 1242, 1504)
    if words in {1241, 1505}:
        with pytest.raises(jsonschema.ValidationError):
            stream.restore(json.dumps(response(base, words)))
    else:
        restored = json.loads(stream.restore(json.dumps(response(base, words))))
        assert len(spoken_text(apply_edits(restored, base, data, 1242, 1504), data).split()) == words


@pytest.mark.parametrize('encoding', ['paragraphs', 'tokens', 'token_text'])
def test_first_stream_is_bound_to_the_exact_original_transport_after_caller_mutation(encoding):
    from backend.tests.test_podcast_briefing import tokenized
    data, base, _ = case()
    intended = response(base)
    if encoding != 'paragraphs':
        base = tokenized(base, data['composition_groups'], text=encoding == 'token_text')
        data['previous_composition'] = base
    frozen_data, frozen_base = copy.deepcopy(data), copy.deepcopy(base)
    stream = composition_stream(data, 1242, 1504)
    assert json.loads(stream.input)['composition_sha256'] == composition_digest(base)
    data.clear()
    base.clear()
    restored = json.loads(stream.restore(json.dumps(intended)))
    result = apply_edits(restored, frozen_base, frozen_data, 1242, 1504)
    assert len(spoken_text(result, frozen_data).split()) == 1380
    assert result['paragraphs']['excluded']['non_editorial'] is True


@pytest.mark.parametrize('fault', ['missing', 'duplicate', 'reordered', 'empty-editorial',
                                  'embedded-marker', 'group-marker', 'whitespace', 'changed-flag'])
def test_first_stream_cannot_drop_groups_exclusions_or_leak_internal_markers(fault):
    data, base, _ = case()
    stream = composition_stream(data, 1242, 1504)
    value = response(base)
    tokens = value['replacement_tokens']
    if fault == 'missing':
        tokens.remove('__gnosi_edit__:1')
    elif fault == 'duplicate':
        tokens[1] = '__gnosi_edit__:0'
    elif fault == 'reordered':
        tokens[0] = '__gnosi_edit__:1'
    elif fault == 'empty-editorial':
        value['replacement_tokens'] = ['__gnosi_edit__:0', '__gnosi_edit__:1', *(['supported'] * 1380)]
    elif fault == 'embedded-marker':
        tokens[1] = 'word__gnosi_edit__:99'
    elif fault == 'group-marker':
        tokens[1] = '__gnosi_group__:main'
    elif fault == 'whitespace':
        tokens[1] = 'two words'
    else:
        value['paragraphs'] = {'excluded': {'non_editorial': False}}
    with pytest.raises((ValueError, jsonschema.ValidationError)):
        stream.restore(json.dumps(value))


def test_infeasible_global_range_is_not_offered_as_a_first_stream_contract():
    data = {'composition_groups': [{'key': 'a'}, {'key': 'b'}], 'previous_composition': {
        'paragraphs': {'a': {'text': 'Qualified claim.', 'non_editorial': False},
                       'b': {'text': 'Minority detail.', 'non_editorial': False}}}}
    assert composition_stream(data, 1, 1) is None


def test_original_object_key_order_cannot_reorder_the_planned_group_markers():
    data, base, _ = case()
    base['paragraphs'] = dict(reversed(list(base['paragraphs'].items())))
    stream = composition_stream(data, 1242, 1504)
    assert [a['group_key'] for a in json.loads(stream.input)['anchors']] == ['main', 'minority']
    restored = json.loads(stream.restore(json.dumps(response(base))))
    text = spoken_text(apply_edits(restored, base, data, 1242, 1504), data)
    assert text.startswith('supported ') and text.endswith('qualified184')
