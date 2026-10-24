"""Bounded quote-only recovery retains every source and immutable valid brief."""
import copy
import json
from types import SimpleNamespace

import jsonschema
import pytest

from backend.services import podcast_briefing as briefing
from backend.services.podcast_brief_repair import InvalidBriefQuotes, brief_quote_repair


@pytest.fixture
def case():
    parts = [{'part_id': f'{i}:0', 'source_id': str(i), 'title': title,
              'text': f'{title} original evidence. Essential qualification.'}
             for i, title in enumerate(['Alpha', 'Beta', 'Gamma'])]
    result = {'briefs': {p['part_id']: {'topic': p['title'], 'summary': p['text'],
                                      'quote': p['text'][:23]} for p in parts}}
    result['briefs']['0:0']['quote'] = 'Invented Alpha wording'
    result['briefs']['2:0']['quote'] = 'Invented Gamma wording'
    return parts, result


def repair(case):
    parts, result = case
    with pytest.raises(InvalidBriefQuotes) as caught:
        briefing._validate_briefs(result, parts)
    assert caught.value.part_ids == ('0:0', '2:0')
    assert all(identifier in str(caught.value) for identifier in caught.value.part_ids)
    built = brief_quote_repair(parts, briefing._brief_schema(parts))(json.dumps(result), caught.value)
    assert built is not None
    return built


def test_reports_and_repairs_every_invalid_quote_without_rewriting_briefs(case):
    parts, result = case
    original = copy.deepcopy(result)
    built = repair(case)
    payload = json.loads(built.input)
    assert [p['part_id'] for p in payload['sources']] == ['0:0', '2:0']
    assert [p['text'] for p in payload['sources']] == [parts[0]['text'], parts[2]['text']]
    replacements = {'quotes': {'0:0': 'Alpha original evidence.', '2:0': 'Gamma original evidence.'}}
    restored = json.loads(built.restore(json.dumps(replacements)))
    briefing._validate_briefs(restored, parts)
    assert set(restored['briefs']) == set(original['briefs'])
    assert restored['briefs']['1:0'] == original['briefs']['1:0']
    for identifier, brief in restored['briefs'].items():
        assert brief['topic'] == original['briefs'][identifier]['topic']
        assert brief['summary'] == original['briefs'][identifier]['summary']
    assert result == original
    # A restore is repeatable and never mutates the retained original.
    assert json.loads(built.restore(json.dumps(replacements))) == restored


@pytest.mark.parametrize('patch', [
    {'quotes': {'0:0': 'Alpha original evidence.'}},
    {'quotes': {'0:0': 'Alpha original evidence.', '2:0': 'Gamma original evidence.', '1:0': 'Beta'}},
    {'quotes': {'0:0': 'Alpha', '2:0': 'Gamma'}, 'summary': 'changed'},
    {'briefs': {'0:0': {'quote': 'Alpha'}}},
    {'quotes': {'0:0': {'quote': 'Alpha', 'summary': 'changed'}, '2:0': 'Gamma'}},
])
def test_rejects_missing_wrong_ids_or_changes_outside_quote_fields(case, patch):
    with pytest.raises(jsonschema.ValidationError):
        repair(case).restore(json.dumps(patch))


@pytest.mark.parametrize('quote', ['invented words', 'Gamma original evidence.', ' '])
def test_rejects_fabricated_cross_source_or_empty_replacements(case, quote):
    with pytest.raises(ValueError):
        repair(case).restore(json.dumps({'quotes': {'0:0': quote, '2:0': 'Gamma'}}))


def test_repair_uses_frozen_originals_and_schema_and_ignores_unrelated_errors(case):
    parts, result = case
    schema = briefing._brief_schema(parts)
    builder = brief_quote_repair(parts, schema)
    assert builder(json.dumps(result), ValueError('unrelated validation failure')) is None
    with pytest.raises(ValueError, match='scope_mismatch'):
        builder(json.dumps(result), InvalidBriefQuotes(['0:0']))
    parts[0]['text'] = 'mutated after factory'
    schema.clear()
    built = builder(json.dumps(result), InvalidBriefQuotes(['0:0', '2:0']))
    assert built is not None
    restored = json.loads(built.restore(json.dumps({'quotes': {'0:0': 'Alpha', '2:0': 'Gamma'}})))
    assert restored['briefs']['0:0']['quote'] == 'Alpha'


@pytest.mark.parametrize('valid_repair', [True, False])
def test_stage_uses_original_two_calls_deadline_and_checkpoints_only_full_valid_result(case, monkeypatch, valid_repair):
    parts, rejected = case
    saved, calls = {}, []
    snapshot = SimpleNamespace(scope='owner', parent_run_id='day', revision='quote-test',
                               origin='button', instructions=[], behavior_resources={})
    context = briefing._Briefing(snapshot, 'English', 100_000, len, lambda: None)
    request = context.request('podcast.coverage.briefs', {'sources': parts}, briefing._brief_schema(parts))
    assert request.max_model_calls == 2 and request.timeout_seconds == 300

    def checkpoint(scope, parent, key, value=None):
        if value is not None:
            saved[key] = copy.deepcopy(value)
        return copy.deepcopy(saved.get(key))

    def run(operation, *, snapshot, output_validator, output_repair):
        assert operation is request
        calls.append('initial')
        with pytest.raises(InvalidBriefQuotes) as caught:
            output_validator(json.dumps(rejected))
        built = output_repair(json.dumps(rejected), caught.value)
        calls.append('repair')
        patch = {'quotes': {'0:0': 'Alpha', '2:0': 'Gamma' if valid_repair else 'invented'}}
        return SimpleNamespace(result=output_validator(built.restore(json.dumps(patch))))

    monkeypatch.setattr('backend.services.agent_execution_store.work_checkpoint', checkpoint)
    monkeypatch.setattr('backend.services.agent_execution.run_sync', run)
    def invoke():
        return context.stage(request, lambda value: briefing._validate_briefs(value, parts),
                             output_repair=brief_quote_repair(parts, request.output_schema))
    if valid_repair:
        result = invoke()
        assert set(result['briefs']) == {p['part_id'] for p in parts}
        assert invoke() == result and len(saved) == 1
    else:
        with pytest.raises(InvalidBriefQuotes):
            invoke()
        assert saved == {}
    assert calls == ['initial', 'repair']
