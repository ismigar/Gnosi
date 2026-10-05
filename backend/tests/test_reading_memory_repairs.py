"""Invalid memory edits are repaired with the whole draft, never silently applied."""
from copy import deepcopy
import json

import jsonschema
import pytest

from backend.domains.llm_wiki.reading_dimension_repairs import build_dimension_repair
from backend.domains.llm_wiki.reading_memory import update_memory
from backend.tests.test_llm_wiki_dimension_repairs import fixture, patch_for


def memory_fixture(batch=True, misplaced=False):
    answer, raw_prompt, validate, state = fixture(batch=batch)
    state['memory'] = 'Opening claim. Qualification: disputed. Evidence: chunk-0.'
    prompt = json.loads(raw_prompt)
    prompt['memory'] = state['memory']
    owner = answer['arguments'] if batch else answer['arguments']['plan']
    if misplaced:
        for entry in owner['plans']:
            entry['plan']['memory_updates'] = [{'old': 'Wrong anchor', 'new': 'New interpretation'}]
    else:
        owner.pop('memory')
        owner['memory_updates'] = [{'old': 'Wrong anchor', 'new': 'New interpretation'}]
    repair = build_dimension_repair(json.dumps(prompt), json.dumps(answer), validate)
    assert repair is not None
    patch = patch_for(repair)
    patch['patches'].append({'path': 'global_memory', 'value': {
        'memory_updates': [{'old': 'Opening claim.', 'new': 'Revised opening claim.'},
                           {'old': '', 'new': 'New connection: chunk-1.'}]}})
    return answer, repair, patch, validate, state


@pytest.mark.parametrize('batch,misplaced', [(False, False), (True, False), (True, True)])
def test_memory_classification_and_all_citations_are_corrected_together(batch, misplaced):
    answer, repair, patch, validate, state = memory_fixture(batch, misplaced)
    before, original = deepcopy(state), deepcopy(answer)
    fixed = json.loads(repair.restore(json.dumps(patch)))
    validate(fixed)
    assert state == before and answer == original
    owner = fixed['arguments'] if batch else fixed['arguments']['plan']
    assert update_memory(state['memory'], owner) == (
        'Revised opening claim. Qualification: disputed. Evidence: chunk-0.\nNew connection: chunk-1.')
    entries = owner['plans'] if batch else [fixed['arguments']]
    for entry in entries:
        note = entry['plan']['notes'][0]
        assert note['title'] == 'Unchanged title' and note['body_md'] == 'Complete and unchanged idea.'
        assert note['dimensions'] == {'area': ['Ethics'], 'kind': ['Idea']}
        if batch:
            assert 'memory_updates' not in entry['plan'] and 'memory' not in entry['plan']
    context = json.loads(repair.input)
    assert context['memory_repair']['current_memory'] == state['memory']
    assert context['rejected_action'] == original  # Misplaced edits remain available to the model.


@pytest.mark.parametrize('fault', ['wrong_anchor', 'ambiguous_anchor', 'missing', 'duplicate', 'both', 'empty', 'change_notes'])
def test_memory_patch_cannot_bypass_anchor_checks_or_mutate_notes(fault):
    _, repair, patch, _, state = memory_fixture()
    before = deepcopy(state)
    memory = patch['patches'][-1]
    if fault == 'wrong_anchor':
        memory['value']['memory_updates'][0]['old'] = 'Invented anchor'
    elif fault == 'ambiguous_anchor':
        memory['value']['memory_updates'][0]['old'] = '.'
    elif fault == 'missing':
        patch['patches'].pop()
    elif fault == 'duplicate':
        patch['patches'][0] = deepcopy(memory)
    elif fault == 'both':
        memory['value']['memory'] = 'Discarded context'
    elif fault == 'empty':
        memory['value'] = {'memory': ''}
    else:
        memory['value'] = {'memory': 'Revised', 'plans': []}
    with pytest.raises((ValueError, jsonschema.ValidationError)):
        repair.restore(json.dumps(patch))
    assert state == before


def test_full_memory_repair_is_explicit_and_preserves_all_other_fields():
    answer, repair, patch, validate, state = memory_fixture(batch=False)
    patch['patches'][-1]['value'] = {'memory': state['memory'] + '\nNew conclusion.'}
    fixed = json.loads(repair.restore(json.dumps(patch)))
    validate(fixed)
    assert fixed['arguments']['plan']['memory'] == state['memory'] + '\nNew conclusion.'
    assert 'memory_updates' not in fixed['arguments']['plan']
    assert fixed['arguments']['plan']['notes'][0]['body_md'] == answer['arguments']['plan']['notes'][0]['body_md']


def test_memory_only_repair_without_classification_or_reference_errors():
    answer, raw_prompt, validate, state = fixture(batch=True, bad_reference=False)
    prompt = json.loads(raw_prompt)
    for entry in answer['arguments']['plans']:
        entry['plan']['notes'][0]['dimensions']['area'] = ['Ethics']
    prompt['memory'] = state['memory']
    answer['arguments'].pop('memory')
    answer['arguments']['memory_updates'] = [{'old': 'No such memory', 'new': 'Revised'}]
    repair = build_dimension_repair(json.dumps(prompt), json.dumps(answer), validate)
    assert repair is not None
    context = json.loads(repair.input)
    assert context['classification_fields'] == [] and context['reference_repair'] is None
    fixed = json.loads(repair.restore(json.dumps({'patches': [{'path': 'global_memory', 'value': {
        'memory_updates': [{'old': '', 'new': 'New argument'}]}}]})))
    validate(fixed)
    assert fixed['arguments']['plans'] == answer['arguments']['plans']
