"""Historical chat team planning must not send incompatible strict schemas."""
import copy

import jsonschema
import pytest
from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI

from backend.domains.agent.structured_output import constrain_output
from backend.services.agent_team_models import TeamPlan
from backend.services.agent_team_planning_schema import compact_plan_schema


@pytest.mark.parametrize('provider', ['openrouter', 'openai'])
@pytest.mark.parametrize('responses', [False, True])
def test_optional_planning_reason_uses_json_transport_and_preserves_local_contract(provider, responses):
    # Recorded team.plan failure: invalid_json_schema, Missing 'reason' in
    # GauntletPlan.required. This is an optional local field.
    schema = compact_plan_schema(TeamPlan.model_json_schema(), temporary=False)
    original = copy.deepcopy(schema)
    quality = schema['$defs']['GauntletPlan']
    assert 'reason' in quality['properties'] and 'reason' not in quality.get('required', [])
    model = ChatOpenAI(model='openai/gpt-6.1-sol', api_key='fixture',
                       use_responses_api=responses,
                       extra_body={'provider': {'order': ['openai'], 'allow_fallbacks': False}} if provider == 'openrouter' else None)
    constrained = constrain_output(model, provider, schema)
    payload = model._get_request_payload([HumanMessage(content='Return JSON')], **constrained.kwargs)
    wire = payload['text']['format'] if responses else payload['response_format']
    assert wire == {'type': 'json_object'}
    assert schema == original
    if provider == 'openrouter':
        assert constrained.kwargs['extra_body']['provider'] == {
            'order': ['openai'], 'allow_fallbacks': False, 'require_parameters': True}
    # Local schema remains complete: an arbitrary tool action is never a plan.
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate({'action': 'tool', 'name': 'delete', 'arguments': {}}, schema)


@pytest.mark.parametrize('nested', [False, True])
def test_optional_fields_in_nested_contracts_preserve_omission_and_type_checks(nested):
    optional = {'type': 'object', 'properties': {'text': {'type': 'string'},
                'reason': {'type': 'string'}}, 'required': ['text'], 'additionalProperties': False}
    schema = {'type': 'object', 'properties': {'result': optional},
              'required': ['result'], 'additionalProperties': False} if nested else optional
    model = ChatOpenAI(model='fixture', api_key='fixture')
    assert constrain_output(model, 'openai', schema).kwargs['response_format'] == {'type': 'json_object'}
    def wrap(value):
        return {'result': value} if nested else value
    jsonschema.validate(wrap({'text': '**Important** passage.'}), schema)
    for invalid in [{'text': 'ok', 'reason': None}, {'reason': 'missing text'}, {'text': 'ok', 'action': 'delete'}]:
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(wrap(invalid), schema)


def test_json_planning_keeps_the_complete_schema_in_the_model_input():
    import json
    from backend.services.agent_behavior import operation_input
    from backend.services.agent_execution_models import AgentOperation

    schema = compact_plan_schema(TeamPlan.model_json_schema(), temporary=False)
    # Match the live planner: the root is complete, but GauntletPlan.reason
    # and other nested fields retain their local optional semantics.
    schema['required'] = list(schema['properties'])
    request = AgentOperation(skill_id='core.fixture', operation='team.plan',
                             input=json.dumps({'request': 'Emphasize key passages'}), output_schema=schema)
    assert json.loads(operation_input(request, provider='openrouter'))['output_schema'] == schema
