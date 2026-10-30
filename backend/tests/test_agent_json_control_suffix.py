"""Complete structured results retain all evidence despite bare control fragments."""
import asyncio
import copy
import json

import pytest

from backend.services import agent_execution as execution
from backend.services.agent_execution_models import AgentOperation
from backend.services.agent_execution_scope import execution_scope
from backend.services.podcast_review import _schema, _validate
from backend.tests.test_agent_execution import install_workflow, runtime  # noqa: F401


SELECTED = ['finding:1', 'finding:2', 'finding:3']


def confirmation():
    source = 'The consultation is proposed and has not been approved.'
    finding = {'kind': 'omission', 'detail': 'Retain the proposed status.',
               'narration_quotes': [], 'source_part_ids': ['source:0'], 'evidence_quote': source}
    return {'narration': 'A consultation is proposed.',
            'briefs': [{'part_id': 'source:0', 'source_text': source}],
            'subjects': [['Consultation']], 'candidate_findings': [
                {'finding_id': f'finding:{i}', 'finding': {**finding, 'detail': f'Qualification {i}.'}}
                for i in range(4)]}


@pytest.mark.parametrize('suffix', ['<function', '<function='])
@pytest.mark.parametrize('fenced', [False, True])
def test_complete_confirmation_keeps_every_selected_finding_without_paid_repair(runtime, monkeypatch, suffix, fenced):
    scope, snapshot = runtime
    data = confirmation()
    before = copy.deepcopy(data)
    response = json.dumps({'confirmed_finding_ids': SELECTED}) + suffix
    if fenced:
        response = '```json\n' + response + '\n```'
    calls = install_workflow(monkeypatch, [response])
    validated = []
    def check(text):
        value = json.loads(text)
        _validate(value, data)
        validated.append(value)
        return text
    with execution_scope(scope):
        result = asyncio.run(execution.execute_operation(AgentOperation(
            skill_id=snapshot.skill_ids[0], operation='podcast.coverage.audit',
            input=json.dumps(data), output_schema=_schema(data), timeout_seconds=300,
        ), snapshot=snapshot, output_validator=check))
    assert result.status == 'completed'
    assert json.loads(result.result) == {'confirmed_finding_ids': SELECTED}
    assert validated == [{'confirmed_finding_ids': SELECTED}]
    assert data == before and len(calls) == 1


@pytest.mark.parametrize('suffix', ['<function', '<function='])
@pytest.mark.parametrize('violation', ['schema', 'domain'])
def test_control_fragment_preserves_schema_and_domain_rejection(runtime, monkeypatch, suffix, violation):
    scope, snapshot = runtime
    data = confirmation()
    # A selected candidate still needs the original-source grounding check.
    data['candidate_findings'][0]['finding']['evidence_quote'] = 'No such original passage.'
    first = {'confirmed_finding_ids': ['finding:99' if violation == 'schema' else 'finding:0']}
    calls = install_workflow(monkeypatch, [json.dumps(first) + suffix,
                                         json.dumps({'confirmed_finding_ids': SELECTED}) + suffix])
    def check(text):
        _validate(json.loads(text), data)
        return text
    with execution_scope(scope):
        result = asyncio.run(execution.execute_operation(AgentOperation(
            skill_id=snapshot.skill_ids[0], operation='podcast.coverage.audit',
            input=json.dumps(data), output_schema=_schema(data), timeout_seconds=300,
        ), snapshot=snapshot, output_validator=check))
    assert json.loads(result.result) == {'confirmed_finding_ids': SELECTED}
    assert len(calls) == 2


@pytest.mark.parametrize('tail', [
    '<function=send_mail>', '<function=send_mail', '<function>name', '<function <function=',
    '<function= {}', '<function=\x00', '<Function=', '<tool_call>',
    ' extra explanation', ' {"issues": []}', '}<function=',
])
def test_additional_content_and_named_tool_calls_are_never_discarded(tail):
    with pytest.raises(json.JSONDecodeError):
        execution._validate_output('{"issues": []}' + tail, {'type': 'object'})


@pytest.mark.parametrize('text', [
    '{"issues": [<function=', '{"issues": [{"detail": "unfinished"}<function=',
    '42<function=', 'true<function', 'null<function=',
])
def test_incomplete_documents_and_scalar_roots_are_never_recovered(text):
    with pytest.raises(json.JSONDecodeError):
        execution._validate_output(text, {})


@pytest.mark.parametrize('suffix', ['<function', '<function='])
def test_nested_content_and_literal_markers_inside_values_survive_exactly(suffix):
    value = [{'body': 'Literal <function=, braces } ], and accents: Àmbit.',
              'ids': [f'source:{i}' for i in range(80)]}]
    actual = execution._validate_output(json.dumps(value, ensure_ascii=False) + suffix,
                                        {'type': 'array', 'minItems': 1})
    assert json.loads(actual) == value
    with pytest.raises(ValueError, match='Non-finite'):
        execution._validate_output('{"value": NaN}' + suffix, {'type': 'object'})
    literal = 'Unstructured text ending in ' + suffix
    assert execution._validate_output(literal, None) == literal
