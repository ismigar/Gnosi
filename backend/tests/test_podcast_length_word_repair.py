"""A repair's global word cap includes immutable prose outside every edit."""
import copy
import json

import jsonschema
import pytest

from backend.services.podcast_composition import spoken_text
from backend.services.podcast_length_edits import apply_edits, composition_digest, word_stream_repair


def case():
    data = {'composition_groups': [{'key': 'main'}, {'key': 'minority'}, {'key': 'excluded'}]}
    base = {'paragraphs': {
        'main': {'text': ' '.join(f'original{i}' for i in range(1626)), 'non_editorial': False},
        'minority': {'text': ' '.join(f'qualified{i}' for i in range(185)), 'non_editorial': False},
        'excluded': {'text': '', 'non_editorial': True}}}
    data['previous_composition'] = base
    proposal = {'composition_sha256': composition_digest(base), 'edits': [{
        'group_key': 'main', 'before': base['paragraphs']['main']['text'],
        'after': ' '.join(['expanded'] * 1652)}]}
    return data, base, proposal


def build(data, base, proposal, minimum=1242, maximum=1504):
    with pytest.raises(ValueError) as failure:
        apply_edits(proposal, base, data, minimum, maximum)
    return word_stream_repair(data, minimum, maximum)(json.dumps(proposal), failure.value)


def patch(words):
    return {'replacement_tokens': ['__gnosi_edit__:0', *(['supported'] * words)]}


def test_actual_failure_arithmetic_retains_untouched_minority_and_exclusion():
    data, base, proposal = case()
    original = copy.deepcopy(data)
    repair = build(data, base, proposal)
    assert repair is not None
    payload = json.loads(repair.input)
    assert payload['untouched_words'] == 185
    assert payload['replacement_word_range'] == {'minimum': 1057, 'maximum': 1319}
    assert 'expanded' not in repair.input
    # The actual ordinary repair's 1549 words remain invalid, before restoration.
    with pytest.raises(jsonschema.ValidationError):
        repair.restore(json.dumps(patch(1364)))
    restored = json.loads(repair.restore(json.dumps(patch(1195))))
    result = apply_edits(restored, base, data, 1242, 1504)
    assert len(spoken_text(result, data).split()) == 1380
    assert result['paragraphs']['minority'] == base['paragraphs']['minority']
    assert result['paragraphs']['excluded'] == base['paragraphs']['excluded']
    assert data == original


@pytest.mark.parametrize('words', [1056, 1057, 1195, 1319, 1320])
def test_aggregate_replacement_boundaries_reach_exact_global_boundaries(words):
    data, base, proposal = case()
    repair = build(data, base, proposal)
    if words in {1056, 1320}:
        with pytest.raises(jsonschema.ValidationError):
            repair.restore(json.dumps(patch(words)))
    else:
        restored = json.loads(repair.restore(json.dumps(patch(words))))
        assert len(spoken_text(apply_edits(restored, base, data, 1242, 1504), data).split()) == words + 185


@pytest.mark.parametrize('tokens', [
    ['word', '__gnosi_edit__:0'], ['__gnosi_edit__:1'],
    ['__gnosi_edit__:0', '__gnosi_edit__:0'], ['__gnosi_edit__:0', 'two words'],
    ['__gnosi_edit__:0', 'word\n'], ['__gnosi_edit__:0', '__gnosi_group__:minority'],
    ['__gnosi_edit__:0', 'word__gnosi_edit__:99'],
])
def test_marker_order_and_whitespace_cannot_evade_word_accounting(tokens):
    data, base, proposal = case()
    repair = build(data, base, proposal)
    invalid = {'replacement_tokens': tokens + ['supported'] * 1195}
    with pytest.raises((ValueError, jsonschema.ValidationError)):
        repair.restore(json.dumps(invalid))


@pytest.mark.parametrize('fault', ['missing', 'overlap', 'hash', 'punctuation', 'whitespace', 'infeasible'])
def test_ineligible_proposals_keep_the_existing_ordinary_repair_path(fault):
    data, base, proposal = case()
    if fault == 'missing':
        proposal['edits'][0]['before'] = 'absent anchor'
    elif fault == 'overlap':
        proposal['edits'].append(copy.deepcopy(proposal['edits'][0]))
    elif fault == 'hash':
        proposal['composition_sha256'] = '0' * 64
    elif fault == 'punctuation':
        base['paragraphs']['main']['text'] = 'punctuation,neighbour ' + base['paragraphs']['main']['text']
        proposal['composition_sha256'] = composition_digest(base)
        proposal['edits'][0]['before'] = 'punctuation'
    elif fault == 'whitespace':
        proposal['edits'][0]['before'] = 'original0 '
        proposal['edits'][0]['after'] = 'short '
    else:
        proposal['edits'][0]['before'] = 'original0'
    assert build(data, base, proposal) is None


def test_replacements_share_one_budget_and_can_leave_a_frozen_anchor_unchanged():
    data = {'composition_groups': [{'key': 'main'}, {'key': 'minority'}]}
    base = {'paragraphs': {
        'main': {'text': 'One qualified fact remains provisional.', 'non_editorial': False},
        'minority': {'text': 'Practical minority coverage with several unnecessary repeated words.',
                     'non_editorial': False}}}
    data['previous_composition'] = base
    proposal = {'composition_sha256': composition_digest(base), 'edits': [
        {'group_key': k, 'before': b['text'], 'after': b['text'] + ' Expanded.'}
        for k, b in base['paragraphs'].items()]}
    repair = build(data, base, proposal, 8, 10)
    tokens = ['__gnosi_edit__:0', *base['paragraphs']['main']['text'].split(),
              '__gnosi_edit__:1', 'Practical', 'minority', 'coverage', 'remains.']
    restored = json.loads(repair.restore(json.dumps({'replacement_tokens': tokens})))
    assert len(restored['edits']) == 1 and restored['edits'][0]['group_key'] == 'minority'
    result = apply_edits(restored, base, data, 8, 10)
    assert result['paragraphs']['main'] == base['paragraphs']['main']
    assert len(spoken_text(result, data).split()) == 9


def test_zero_replacement_words_can_remove_a_redundant_clause_without_clipping():
    data = {'composition_groups': [{'key': 'main'}]}
    base = {'paragraphs': {'main': {'text': 'Qualified claim. Repeated filler.', 'non_editorial': False}}}
    data['previous_composition'] = base
    proposal = {'composition_sha256': composition_digest(base), 'edits': [
        {'group_key': 'main', 'before': 'Repeated filler.', 'after': 'More repeated filler.'}]}
    repair = build(data, base, proposal, 2, 2)
    restored = json.loads(repair.restore(json.dumps({'replacement_tokens': ['__gnosi_edit__:0']})))
    assert spoken_text(apply_edits(restored, base, data, 2, 2), data) == 'Qualified claim.'


def test_fixed_anchor_feasibility_includes_required_prose_in_every_editorial_group():
    data = {'composition_groups': [{'key': 'a'}, {'key': 'b'}]}
    base = {'paragraphs': {
        'a': {'text': 'a b', 'non_editorial': False},
        'b': {'text': 'c d', 'non_editorial': False}}}
    data['previous_composition'] = base
    proposal = {'composition_sha256': composition_digest(base), 'edits': [
        {'group_key': 'a', 'before': 'a b', 'after': 'a b extra'}]}
    # Untouched b already consumes the maximum: zero words cannot preserve a.
    assert build(data, base, proposal, 1, 2) is None
    ordinary = {'composition_sha256': composition_digest(base), 'edits': [
        {'group_key': 'a', 'before': 'a b', 'after': 'a'},
        {'group_key': 'b', 'before': 'c d', 'after': 'c'}]}
    result = apply_edits(ordinary, base, data, 1, 2)
    assert spoken_text(result, data) == 'a\n\nc'


@pytest.mark.parametrize('encoding', ['tokens', 'token_text'])
def test_original_word_stream_base_and_mutated_caller_cannot_change_frozen_repair(encoding):
    from backend.tests.test_podcast_briefing import tokenized
    data, base, proposal = case()
    base = tokenized(base, data['composition_groups'], text=encoding == 'token_text')
    data['previous_composition'] = base
    proposal['composition_sha256'] = composition_digest(base)
    repair = build(data, base, proposal)
    original_data, original_base = copy.deepcopy(data), copy.deepcopy(base)
    data['composition_groups'].clear()
    base.clear()
    restored = json.loads(repair.restore(json.dumps(patch(1195))))
    result = apply_edits(restored, original_base, original_data, 1242, 1504)
    assert len(spoken_text(result, original_data).split()) == 1380
    assert result['paragraphs']['minority']['text'].startswith('qualified0 ')
