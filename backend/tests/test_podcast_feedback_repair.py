"""Repair every invalid guide together; retain all already valid model text."""
from copy import deepcopy
import json

import jsonschema
import pytest

from backend.services.agent_behavior import operation_input
from backend.services.podcast_feedback import _guidance_request, _validate_guidance
from backend.services.podcast_feedback_repair import guidance_repair
from backend.tests.test_podcast_feedback import Context


def case(budget=160):
    context = Context()
    context.language = 'Catalan'
    rows = [{'finding_id': f'finding:{i}', 'finding': {'kind': 'distortion',
             'detail': f'Correction {i}: retain the original qualification and surface ².',
             'source_part_ids': [f'{i}:0']}} for i in range(8)]
    request = _guidance_request(context, rows, budget)
    original = {'guidance': {row['finding_id']: 'v' * min(20, budget) for row in rows}}
    for i, excess in [(0, 19), (1, 10), (5, 21)]:
        original['guidance'][f'finding:{i}'] = 'x' * (budget + excess)
    return context, request, original


def built(context, request, original):
    budget = json.loads(request.input)['data']['guidance_byte_budget']
    return guidance_repair(context, request, lambda value: _validate_guidance(value, budget))(
        json.dumps(original), ValueError('The generic diagnostic reported only finding:5.'))


def patch_for(repair, text='Keep the essential qualification.'):
    return {'guidance': {key: text for key in repair.output_schema['properties']['guidance']['properties']}}


@pytest.mark.parametrize('budget', [1, 2, 37, 133, 160])
def test_all_invalid_guides_are_repaired_in_one_patch_with_valid_values_immutable(budget):
    context, request, original = case(budget)
    before, original_request = deepcopy(original), request.model_dump()
    repair = built(context, request, original)
    keys = set(repair.output_schema['properties']['guidance']['properties'])
    assert keys == {'finding:0', 'finding:1', 'finding:5'}
    payload = json.loads(repair.input)['data']
    assert {row['finding_id'] for row in payload['confirmed_findings']} == keys
    source = json.loads(request.input)['data']['confirmed_findings']
    assert payload['confirmed_findings'] == [row for row in source if row['finding_id'] in keys]
    assert all('²' in row['finding']['detail'] for row in payload['confirmed_findings'])
    assert payload['guidance_byte_budget'] == budget and payload['guidance_target_bytes'] == max(1, budget // 2)
    candidate = request.model_copy(update={'input': repair.input, 'output_schema': repair.output_schema})
    assert context.cost(candidate) <= 40_000
    result = json.loads(repair.restore(json.dumps(patch_for(repair, 'q' * max(1, budget // 2)))))
    jsonschema.validate(result, request.output_schema)
    _validate_guidance(result, budget)
    assert set(result['guidance']) == set(before['guidance'])
    assert all(result['guidance'][key] == text for key, text in before['guidance'].items() if key not in keys)
    assert original == before and request.model_dump() == original_request


@pytest.mark.parametrize('text', ['a\n', 'é', '²', 'a"', 'a\\', ' ', 'a' * 161])
def test_business_and_schema_rejections_all_get_the_same_strict_repair(text):
    context, request, original = case()
    original['guidance']['finding:2'] = text
    repair = built(context, request, original)
    assert 'finding:2' in repair.output_schema['properties']['guidance']['properties']
    invalid = patch_for(repair)
    invalid['guidance']['finding:2'] = text
    with pytest.raises((ValueError, jsonschema.ValidationError)):
        repair.restore(json.dumps(invalid))


@pytest.mark.parametrize('mode', ['missing', 'extra', 'extra_field', 'type'])
def test_patch_cannot_drop_a_rejected_guide_or_rewrite_a_valid_one(mode):
    context, request, original = case()
    repair = built(context, request, original)
    patch = patch_for(repair)
    if mode == 'missing':
        del patch['guidance']['finding:1']
    elif mode == 'extra':
        patch['guidance']['finding:2'] = 'Rewrite a valid guide.'
    elif mode == 'extra_field':
        patch['approved'] = True
    else:
        patch['guidance']['finding:1'] = False
    with pytest.raises(jsonschema.ValidationError):
        repair.restore(json.dumps(patch))


@pytest.mark.parametrize('mode', ['missing', 'extra', 'type', 'bad_json', 'valid'])
def test_nonmatching_or_already_valid_results_keep_the_existing_full_repair_path(mode):
    context, request, original = case()
    if mode == 'missing':
        del original['guidance']['finding:1']
    elif mode == 'extra':
        original['guidance']['invented'] = 'No new membership.'
    elif mode == 'type':
        original['guidance']['finding:1'] = False
    elif mode == 'valid':
        original = {'guidance': {key: 'Valid.' for key in original['guidance']}}
    builder = guidance_repair(context, request, lambda value: _validate_guidance(value, 160))
    assert builder('not JSON' if mode == 'bad_json' else json.dumps(original), ValueError('invalid')) is None


def test_oversized_rejected_draft_can_be_omitted_without_omitting_original_findings():
    context, request, original = case()
    original['guidance']['finding:0'] = 'x' * 50_000
    repair = built(context, request, original)
    payload = json.loads(repair.input)['data']
    assert all('text' not in row for row in payload['rejected_guidance'].values())
    assert payload['rejected_guidance']['finding:0']['characters'] == 50_000
    assert payload['confirmed_findings'] == [row for row in json.loads(request.input)['data']['confirmed_findings']
                                            if row['finding_id'] in payload['rejected_guidance']]
    assert len(operation_input(request.model_copy(update={'input': repair.input})).encode()) + 1024 <= 40_000
    assert len(json.loads(repair.restore(json.dumps(patch_for(repair))))['guidance']) == 8


def test_an_unfitting_original_finding_never_causes_a_larger_repair_request():
    context, request, original = case()
    data = json.loads(request.input)
    data['data']['confirmed_findings'][0]['finding']['detail'] = 'x' * 50_000
    request = request.model_copy(update={'input': json.dumps(data)})
    with pytest.raises(RuntimeError, match='podcast_feedback_context_insufficient'):
        built(context, request, original)


def test_other_digest_operations_have_no_guidance_repair():
    context, request, _ = case()
    ordinary = request.model_copy(update={'input': json.dumps({'data': {'briefs': []}})})
    assert guidance_repair(context, ordinary, lambda _: None) is None


@pytest.mark.parametrize('value', ['ordinary digest text', '[]', 'null', '{"data": []}', '{"data": null}'])
def test_other_digest_input_shapes_keep_the_original_execution_path(value):
    context, request, _ = case()
    ordinary = request.model_copy(update={'input': value})
    assert guidance_repair(context, ordinary, lambda _: None) is None


def test_unrelated_response_schema_does_not_enable_guidance_partial_repair():
    context, request, _ = case()
    ordinary = request.model_copy(update={'output_schema': {'type': 'object'}})
    assert guidance_repair(context, ordinary, lambda _: None) is None


@pytest.mark.parametrize('text', ['a\ud800', '\udfff', 'a\ud800b'])
def test_unpaired_surrogates_are_repaired_without_fabricating_a_utf8_byte_count(text):
    context, request, original = case()
    original['guidance']['finding:2'] = text
    repair = built(context, request, original)
    payload = json.loads(repair.input)['data']
    rejected = payload['rejected_guidance']['finding:2']
    assert rejected == {'characters': len(text), 'serialized_utf8_bytes': None, 'invalid_utf8': True}
    repair.input.encode('utf8')
    result = json.loads(repair.restore(json.dumps(patch_for(repair))))
    _validate_guidance(result, 160)
    assert result['guidance']['finding:2'] == 'Keep the essential qualification.'
    patch = patch_for(repair)
    patch['guidance']['finding:2'] = text
    with pytest.raises((ValueError, jsonschema.ValidationError)):
        repair.restore(json.dumps(patch))
