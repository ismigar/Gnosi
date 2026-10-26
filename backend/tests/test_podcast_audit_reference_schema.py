"""Grounded audit requests reject missing references before model repair is needed."""
import jsonschema
import pytest

from backend.services.podcast_review import _schema, _validate


def source_case(focus):
    narration = 'A final order was issued.'
    data = {'review_focus': focus, 'narration': narration,
            'briefs': [{'part_id': 'case:0', 'title': 'Synthetic procedural case',
                        'source_text': 'The order remains provisional.'}],
            'subjects': [['Procedural qualification']]}
    issue = {'kind': 'omission' if focus == 'coverage' else 'distortion',
             'detail': 'Preserve the procedural qualification.',
             'narration_quotes': [] if focus == 'coverage' else [narration],
             'source_part_ids': ['case:0'], 'evidence_quote': 'The order remains provisional.'}
    return data, issue


@pytest.mark.parametrize('focus', ['fidelity', 'coverage'])
def test_grounded_findings_require_references_in_the_model_response_contract(focus):
    data, issue = source_case(focus)
    result = {'issues': [{**issue, 'source_part_ids': []}]}
    with pytest.raises(jsonschema.ValidationError) as raised:
        jsonschema.validate(result, _schema(data))
    assert raised.value.validator == 'minItems'
    with pytest.raises(ValueError, match='podcast_audit_missing_evidence_ids'):
        _validate(result, data)


@pytest.mark.parametrize('focus', ['fidelity', 'coverage'])
def test_valid_grounded_findings_and_empty_issue_lists_remain_supported(focus):
    data, issue = source_case(focus)
    for result in ({'issues': [issue]}, {'issues': []}):
        jsonschema.validate(result, _schema(data))
        _validate(result, data)


@pytest.mark.parametrize('focus', ['fidelity', 'coverage'])
@pytest.mark.parametrize('references', [['unknown:0'], ['case:0', 'case:0']])
def test_grounded_reference_contract_preserves_scope_and_uniqueness(focus, references):
    data, issue = source_case(focus)
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate({'issues': [{**issue, 'source_part_ids': references}]}, _schema(data))


@pytest.mark.parametrize('focus', [None, 'coverage'])
def test_whole_episode_ledger_findings_keep_their_no_source_reference_contract(focus):
    data = {'whole_episode': True, 'review_focus': focus,
            'sections': [{'narration': 'A listener passage.'}], 'subjects': [['A ledger topic.']]}
    result = {'issues': [{'kind': 'omission', 'detail': 'A substantive ledger topic is missing.',
                         'narration_quotes': [], 'source_part_ids': [], 'evidence_quote': 'A ledger topic.'}]}
    jsonschema.validate(result, _schema(data))
    _validate(result, data)


@pytest.mark.parametrize('kind', ['production', 'duplicate'])
def test_generic_listener_only_findings_keep_empty_source_references(kind):
    data, _ = source_case('coverage')
    data.pop('review_focus')
    data['narration'] = 'First literal passage. Second literal passage.'
    quotes = ['First literal passage.'] if kind == 'production' else ['First literal passage.', 'Second literal passage.']
    result = {'issues': [{'kind': kind, 'detail': 'A listener-only synthetic issue.',
                         'narration_quotes': quotes, 'source_part_ids': [], 'evidence_quote': ''}]}
    jsonschema.validate(result, _schema(data))
    _validate(result, data)


def test_confirmation_can_still_reject_every_candidate():
    data, issue = source_case('coverage')
    data['candidate_findings'] = [{'finding_id': 'finding:0', 'finding': issue}]
    result = {'confirmed_finding_ids': []}
    jsonschema.validate(result, _schema(data))
    _validate(result, data)


@pytest.mark.parametrize('focus,count', [('coverage', 0), ('fidelity', 1)])
@pytest.mark.parametrize('actual_count', [0, 1, 2, 3])
@pytest.mark.parametrize('whole', [False, True])
def test_focused_quote_cardinality_is_enforced_by_the_provider_contract(focus, count, actual_count, whole):
    data, issue = source_case(focus)
    if whole:
        data.update(whole_episode=True, sections=[{'narration': data['narration']}])
    quotes = ['First literal passage.', 'Second literal passage.', 'Third literal passage.'][:actual_count]
    result = {'issues': [{**issue, 'narration_quotes': quotes}]}
    if actual_count == count:
        jsonschema.validate(result, _schema(data))
    else:
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(result, _schema(data))


def test_observed_coverage_omission_with_a_literal_narration_quote_is_schema_invalid():
    data, issue = source_case('coverage')
    result = {'issues': [{**issue, 'narration_quotes': [data['narration']]}]}
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(result, _schema(data))
    with pytest.raises(ValueError, match='podcast_audit_quote_count'):
        _validate(result, data)


def test_multi_kind_audit_remains_a_strict_provider_schema():
    from backend.domains.agent.structured_output import constrain_output
    from langchain_openai import ChatOpenAI

    data, _ = source_case(None)
    schema = _schema(data)
    bound = constrain_output(ChatOpenAI(model='fixture', api_key='fixture'), 'openrouter', schema)
    assert bound.kwargs['response_format'] == {
        'type': 'json_schema', 'json_schema': {'name': 'gnosi_operation', 'strict': True, 'schema': schema}}
