"""Confirm immutable model findings by reference, never by retyping their claims."""
import copy
import json
from types import SimpleNamespace

import jsonschema
import pytest

from backend.services.agent_behavior import resource
from backend.services.podcast_automatic import _request
from backend.services.podcast_briefing import AgentOperation
from backend.services.podcast_review import _confirm, _schema, _stage, _validate


def evidence():
    return {'narration': 'The court closed the case. Book sales have changed.',
            'briefs': [{'part_id': 'court:0', 'title': 'Custody ruling',
                        'source_text': 'Case closure does not establish shared custody.'},
                       {'part_id': 'books:0', 'title': 'Publisher decision',
                        'source_text': 'The publisher withdrew the books. The law prevents author payments.'}],
            'subjects': [['Custody and civil procedure'], ['Publication and payment conditions']]}


def findings():
    return [{'kind': 'omission', 'detail': 'Retain the custody qualification.',
             'narration_quotes': [], 'source_part_ids': ['court:0'],
             'evidence_quote': 'Case closure does not establish shared custody.'},
            {'kind': 'omission', 'detail': 'Include the payment restriction.',
             'narration_quotes': [], 'source_part_ids': ['books:0'],
             'evidence_quote': 'The law prevents author payments.'}]


def choices(values):
    return [{'finding_id': f'finding:{i}', 'finding': value} for i, value in enumerate(values)]


class Context:
    budget = 80000

    def __init__(self, respond):
        self.respond = respond
        self.sent = []
        self.raw = []

    def request(self, operation, data, schema):
        return AgentOperation(skill_id='core.gnosi-daily-briefing', operation=operation,
                              input=json.dumps(data), output_schema=schema,
                              timeout_seconds=300, max_model_calls=2)

    def cost(self, request):
        return len(request.input)

    def stage(self, request, validate):
        data = json.loads(request.input)
        self.sent.append(request)
        result = self.respond(data)
        jsonschema.validate(result, request.output_schema)
        validate(result)
        self.raw.append(copy.deepcopy(result))
        return result


@pytest.mark.parametrize('selected', [[], ['finding:1'], ['finding:1', 'finding:0']])
def test_selection_returns_only_exact_original_findings_without_mutating_evidence(selected):
    data, original = evidence(), findings()
    before = copy.deepcopy((data, original))
    context = Context(lambda _: {'confirmed_finding_ids': selected})
    actual = _confirm(context, data, original, _request)
    assert actual == [original[int(key.split(':')[1])] for key in selected]
    assert (data, original) == before
    assert context.raw == [{'confirmed_finding_ids': selected}]
    sent = json.loads(context.sent[0].input)
    assert sent['briefs'] == data['briefs'] and sent['narration'] == data['narration']
    assert sent['subjects'] == data['subjects'] and sent['candidate_findings'] == choices(original)
    assert context.sent[0].options['automatic_contract'] == resource('operations/podcast/confirmation-contract.md')
    assert context.sent[0].timeout_seconds == 300 and context.sent[0].max_model_calls == 2


@pytest.mark.parametrize('result', [
    {'confirmed_finding_ids': ['finding:9']},
    {'confirmed_finding_ids': ['finding:0', 'finding:0']},
    {'confirmed_finding_ids': [False]},
    {'confirmed_finding_ids': [{}]},
    {'confirmed_finding_ids': None},
    {'confirmed_finding_ids': 'finding:0'},
    {'confirmed_finding_ids': [], 'issues': []},
    {'issues': findings()},
    {'issues': [{**findings()[0], 'detail': 'A rewritten claim.'}]},
])
def test_unknown_duplicate_malformed_or_rewritten_selections_fail_closed(result):
    data = {**evidence(), 'candidate_findings': choices(findings())}
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(result, _schema(data))
    with pytest.raises(ValueError, match='podcast_audit_confirmation_invalid_reference'):
        _validate(result, data)


@pytest.mark.parametrize('candidates', [None, {}, [findings()[0]],
    [{'finding_id': 'finding:0', 'finding': None}],
    [choices(findings())[0], choices(findings())[0]]])
def test_invalid_application_reference_scope_is_rejected_before_a_model_call(candidates):
    context = Context(lambda _: {'confirmed_finding_ids': []})
    with pytest.raises(ValueError, match='podcast_audit_confirmation_invalid_scope'):
        _stage(context, {**evidence(), 'candidate_findings': candidates}, _request)
    assert context.sent == []


@pytest.mark.parametrize('changed', ['narration', 'source', 'missing_original'])
def test_selected_original_findings_still_require_current_literal_grounding(changed):
    data = evidence()
    issue = {'kind': 'distortion', 'detail': 'A factual contradiction.',
             'narration_quotes': ['The court closed the case.'], 'source_part_ids': ['court:0'],
             'evidence_quote': 'Case closure does not establish shared custody.'}
    if changed == 'narration':
        issue['narration_quotes'] = ['An invented narration passage.']
    elif changed == 'source':
        issue['evidence_quote'] = 'The law prevents author payments.'
    else:
        data['briefs'][0]['source_text'] = ''
    context = Context(lambda _: {'confirmed_finding_ids': ['finding:0']})
    with pytest.raises(ValueError, match='podcast_audit_'):
        _confirm(context, data, [issue], _request)
    assert context.raw == []


@pytest.mark.parametrize('failure', ['timeout', 'length'])
def test_split_confirmation_preserves_original_ids_all_sources_and_entire_script(failure):
    from openai import LengthFinishReasonError
    originals = [{**findings()[0], 'detail': f'Condition {i}'} for i in range(5)]
    def respond(data):
        if len(data['candidate_findings']) > 2:
            raise (TimeoutError() if failure == 'timeout' else
                   LengthFinishReasonError(completion=SimpleNamespace(usage=None)))
        return {'confirmed_finding_ids': [item['finding_id'] for item in data['candidate_findings']]}
    context = Context(respond)
    result = _confirm(context, evidence(), originals, _request)
    assert result == originals
    assert [len(json.loads(r.input)['candidate_findings']) for r in context.sent] == [5, 2, 3, 1, 2]
    for request in context.sent:
        data = json.loads(request.input)
        assert data['briefs'] == evidence()['briefs'] and data['narration'] == evidence()['narration']
        assert request.timeout_seconds == 300 and request.max_model_calls == 2
    assert [key for result in context.raw for key in result['confirmed_finding_ids']] == [
        f'finding:{i}' for i in range(5)]


def test_whole_episode_confirmation_uses_subject_ledger_without_inventing_source_ids():
    data = {'whole_episode': True, 'sections': [{'narration': 'The court closed the case.'}],
            'subjects': [['Publication and payment conditions']]}
    finding = {'kind': 'omission', 'detail': 'A minority theme is missing.', 'narration_quotes': [],
               'source_part_ids': [], 'evidence_quote': 'Publication and payment conditions'}
    context = Context(lambda _: {'confirmed_finding_ids': ['finding:0']})
    assert _confirm(context, data, [finding], _request) == [finding]
    assert json.loads(context.sent[0].input)['subjects'] == data['subjects']


def test_nonconfirmation_contracts_and_normal_issue_schema_remain_unchanged():
    context = Context(lambda _: {'issues': []})
    data = evidence()
    for phase in ('write', 'audit'):
        request = _request(context, phase, data, _schema(data))
        assert request.options['automatic_contract'] == resource('operations/podcast/automatic-contract.md')
    assert set(_schema(data)['properties']) == {'issues'}
    assert 'candidate_findings' not in data
