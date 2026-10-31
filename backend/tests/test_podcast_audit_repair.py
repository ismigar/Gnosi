"""Audit quote recovery preserves findings and uses only literal scoped references."""
import copy
import json
from types import SimpleNamespace

import jsonschema
import pytest

from backend.services import podcast_briefing as briefing
from backend.services.podcast_audit_repair import audit_quote_repair, _narration_options
from backend.services.podcast_review import _schema, _validate, review


@pytest.fixture
def case():
    narration = 'The council adopted the proposal. Police unions back the ruling party.'
    data = {'review_focus': 'fidelity', 'narration': narration, 'subjects': [['Council', 'Police unions']],
            'briefs': [{'part_id': 'council:0', 'title': 'Council vote',
                        'source_text': 'The council postponed the vote.'},
                       {'part_id': 'police:0', 'title': 'Police unions',
                        'source_text': 'Police unions deny affiliation.'}]}
    result = {'issues': [
        {'kind': 'distortion', 'detail': 'Adoption replaces postponement.',
         'narration_quotes': ['The council has adopted the proposal.'], 'source_part_ids': ['council:0'],
         'evidence_quote': 'The council has postponed the vote.'},
        {'kind': 'distortion', 'detail': 'Support replaces denial of affiliation.',
         'narration_quotes': ['Police unions back the ruling party.'], 'source_part_ids': ['police:0'],
         'evidence_quote': 'Police unions deny affiliation.'}]}
    return data, result


def built(case):
    data, result = case
    with pytest.raises(ValueError, match='podcast_audit_invented_narration_quote') as error:
        _validate(result, data)
    return audit_quote_repair(data, _schema(data))(json.dumps(result), error.value)


def selection(repair):
    return {'quote_ids': {key: value['enum'][0] for key, value in
                         repair.output_schema['properties']['quote_ids']['properties'].items()}}


def test_all_nonliteral_narration_and_evidence_quotes_are_repaired_together(case):
    data, original = case
    before = copy.deepcopy(original)
    repair = built(case)
    fields = json.loads(repair.input)['fields']
    assert set(fields) == {'issue:0:narration:0', 'issue:0:evidence'}
    result = json.loads(repair.restore(json.dumps(selection(repair))))
    _validate(result, data)
    assert original == before and result['issues'][1] == before['issues'][1]
    assert len(result['issues']) == len(before['issues'])
    for old, new in zip(before['issues'], result['issues'], strict=True):
        assert {k: old[k] for k in ('kind', 'detail', 'source_part_ids')} == {
            k: new[k] for k in ('kind', 'detail', 'source_part_ids')}
    assert result['issues'][0]['evidence_quote'] == data['briefs'][0]['title']
    assert result['issues'][0]['narration_quotes'][0] in data['narration']
    assert json.loads(repair.restore(json.dumps(selection(repair)))) == result


@pytest.mark.parametrize('invalid', ['missing', 'extra_slot', 'extra_field', 'literal_text', 'unknown', 'cross_pool'])
def test_selection_cannot_drop_findings_rewrite_claims_or_cross_original_scopes(case, invalid):
    repair = built(case)
    patch = selection(repair)
    if invalid == 'missing':
        patch['quote_ids'].pop('issue:0:evidence')
    elif invalid == 'extra_slot':
        patch['quote_ids']['issue:1:evidence'] = 'source:police:0:q0'
    elif invalid == 'extra_field':
        patch['issues'] = []
    elif invalid == 'literal_text':
        patch['quote_ids']['issue:0:evidence'] = case[0]['briefs'][0]['source_text']
    elif invalid == 'unknown':
        patch['quote_ids']['issue:0:evidence'] = 'source:absent:0:q0'
    else:
        patch['quote_ids']['issue:0:evidence'] = patch['quote_ids']['issue:0:narration:0']
    with pytest.raises(jsonschema.ValidationError):
        repair.restore(json.dumps(patch))


def test_frozen_inputs_and_valid_quotes_are_not_rewritten(case):
    data, original = case
    schema = _schema(data)
    builder = audit_quote_repair(data, schema)
    frozen = copy.deepcopy(case)
    data['narration'] = 'Changed after constructing the repair builder.'
    data['briefs'].clear()
    schema.clear()
    repair = builder(json.dumps(original), ValueError('podcast_audit_invented_narration_quote'))
    result = json.loads(repair.restore(json.dumps(selection(repair))))
    _validate(result, frozen[0])
    assert result['issues'][1] == frozen[1]['issues'][1]


@pytest.mark.parametrize('error', ['unrelated', 'podcast_audit_quote_count', 'podcast_audit_missing_evidence_ids',
                                   'podcast_audit_original_evidence_missing'])
def test_unrelated_contract_or_original_evidence_failures_do_not_get_quote_repair(case, error):
    data, result = case
    assert audit_quote_repair(data, _schema(data))(json.dumps(result), ValueError(error)) is None


def test_confirmation_references_remain_a_separate_immutable_contract(case):
    data, result = case
    data['candidate_findings'] = [{'finding_id': 'finding:0', 'finding': result['issues'][0]}]
    assert audit_quote_repair(data, _schema(data)) is None


@pytest.mark.parametrize('text', ['A literal sentence. Short ending x', 'x' * 481, '  é  ’  \n' * 100])
def test_narration_options_cover_every_nonwhitespace_character_with_literal_valid_spans(text):
    options = _narration_options(text)
    covered = set()
    for option in options.values():
        assert 8 <= len(option['text']) <= 400
        assert option['text'] == text[option['start']:option['end']]
        covered.update(range(option['start'], option['end']))
    assert {i for i, char in enumerate(text) if not char.isspace()} <= covered


@pytest.mark.parametrize('kind', ['source', 'whole_episode'])
def test_source_evidence_recovery_is_scoped_and_retains_whole_ledger_rules(case, kind):
    data, _ = case
    data['review_focus'] = 'coverage'
    if kind == 'whole_episode':
        data.update(whole_episode=True, sections=[{'narration': data.pop('narration')}])
    issue = {'kind': 'omission', 'detail': 'A missing central subject.', 'narration_quotes': [],
             'source_part_ids': [] if kind == 'whole_episode' else ['council:0'],
             'evidence_quote': 'Invented source text.'}
    original = {'issues': [issue]}
    builder = audit_quote_repair(data, _schema(data))
    repair = builder(json.dumps(original), ValueError('podcast_audit_invented_evidence_quote'))
    result = json.loads(repair.restore(json.dumps(selection(repair))))
    _validate(result, data)
    assert result['issues'][0]['source_part_ids'] == issue['source_part_ids']
    assert result['issues'][0]['narration_quotes'] == []


def test_stage_repairs_only_inside_existing_call_and_cache_contract_then_confirms(case, monkeypatch):
    from backend.services.podcast_automatic import _request
    data, rejected = case
    saved, calls = {}, []
    snapshot = SimpleNamespace(scope='owner', parent_run_id='day', revision='audit-repair', origin='button',
                               instructions=[], behavior_resources={})
    context = briefing._Briefing(snapshot, 'English', 100_000, len, lambda: None)
    def checkpoint(scope, parent, key, value=None):
        if value is not None:
            saved[key] = copy.deepcopy(value)
        return copy.deepcopy(saved.get(key))
    monkeypatch.setattr('backend.services.agent_execution_store.work_checkpoint', checkpoint)
    def run(operation, *, snapshot, output_validator, output_repair):
        values = json.loads(operation.input)['data']
        assert operation.max_model_calls == 2 and operation.timeout_seconds == 300
        if 'candidate_findings' in values:
            assert output_repair is None
            calls.append('confirmation')
            return SimpleNamespace(result=output_validator(json.dumps({'confirmed_finding_ids': []})))
        calls.append('audit')
        with pytest.raises(ValueError) as error:
            output_validator(json.dumps(rejected))
        repair = output_repair(json.dumps(rejected), error.value)
        calls.append('quote_selection')
        return SimpleNamespace(result=output_validator(repair.restore(json.dumps(selection(repair)))))
    monkeypatch.setattr('backend.services.agent_execution.run_sync', run)
    operation = _request(context, 'audit', data, _schema(data))
    key = context._cache_key(operation)
    before = operation.model_dump()
    assert review(context, data, _request) == []
    assert calls == ['audit', 'quote_selection', 'confirmation']
    assert operation.model_dump() == before and context._cache_key(operation) == key
    assert review(context, data, _request) == [] and len(calls) == 3


@pytest.mark.parametrize('latent', ['omission_quote', 'missing_source_ids', 'listener_source_claim'])
def test_compound_error_cannot_select_a_patch_that_freezes_an_invalid_finding(case, latent):
    data, original = case
    data.pop('review_focus')
    late = original['issues'][1]
    if latent == 'omission_quote':
        late['kind'] = 'omission'
    elif latent == 'missing_source_ids':
        late['source_part_ids'] = []
    else:
        late['kind'] = 'production'
    before = copy.deepcopy(original)
    repair = audit_quote_repair(data, _schema(data))(
        json.dumps(original), ValueError('podcast_audit_invented_narration_quote'))
    assert repair is None
    assert original == before
