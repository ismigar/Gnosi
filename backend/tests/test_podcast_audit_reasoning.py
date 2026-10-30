"""Exercise audit defaults through the actual structured provider transport."""
import asyncio
import json

import httpx
import jsonschema
import pytest
from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI

from backend.tests.test_agent_execution import runtime as runtime


@pytest.mark.parametrize('kind', ['fidelity', 'coverage', 'confirmation', 'whole_episode'])
@pytest.mark.parametrize('optional', [True, False, None])
@pytest.mark.parametrize('choice', ['default', 'profile', 'native'])
@pytest.mark.parametrize('retry', [False, True])
def test_audit_default_preserves_contract_and_explicit_choices(monkeypatch, runtime, kind, optional, choice, retry):
    from backend.domains.agent import operation_graph
    from backend.services import agent_execution as execution
    from backend.services.agent_behavior import operation_input
    from backend.services.podcast_automatic import _request
    from backend.services.podcast_briefing import _Briefing
    from backend.services.podcast_review import _schema, _validate

    _, snapshot = runtime
    snapshot.profile.update(provider='openrouter', model='fixture')
    if choice == 'profile':
        snapshot.profile['reasoning_effort'] = 'high'
    original_text = 'The council postponed the vote until Friday.'
    data = {'review_focus': 'fidelity' if kind == 'confirmation' else kind,
            'briefs': [{'part_id': 'source:0', 'source_id': 'source', 'title': 'Council vote',
                        'source_text': original_text}], 'narration': original_text, 'subjects': [['Council vote']]}
    if kind == 'confirmation':
        data['candidate_findings'] = [{'finding_id': '0', 'finding': {
            'kind': 'distortion', 'message': 'Check the reported decision.', 'source_part_ids': ['source:0'],
            'source_quote': original_text, 'narration_quote': original_text}}]
    elif kind == 'whole_episode':
        data.update(whole_episode=True, sections=[{'narration': original_text, 'part_ids': ['source:0']}])
    before = json.dumps(data, sort_keys=True)
    context = _Briefing(snapshot, 'Catalan', 80000, len, lambda: None)
    request = _request(context, 'audit', data, _schema(data))
    expected_result = {'confirmed_finding_ids': []} if kind == 'confirmation' else {'issues': []}
    sent, selected = [], {}

    def respond(http_request):
        sent.append(json.loads(http_request.content))
        return httpx.Response(200, json={'id': 'fixture', 'model': 'fixture', 'object': 'chat.completion',
            'choices': [{'index': 0, 'finish_reason': 'stop', 'message': {
                'role': 'assistant', 'content': json.dumps(expected_result)}}]})

    monkeypatch.setattr('backend.services.model_reasoning.reasoning_options',
        lambda *_: {'supported_efforts': [], 'supports_reasoning_disable': optional})
    monkeypatch.setattr(operation_graph, '_invoke_agent_model', lambda model, messages, state: model.invoke(messages))
    preferences = {'provider': {'order': ['selected'], 'allow_fallbacks': False}}
    if choice != 'default':
        preferences['reasoning'] = {'effort': 'high'} if choice == 'profile' else {'enabled': True}
    with httpx.Client(transport=httpx.MockTransport(respond)) as transport:
        model = ChatOpenAI(model='fixture', api_key='fixture', max_retries=0, http_client=transport,
                           base_url='https://fixture.invalid/v1', extra_body=preferences)

        async def workflow(*args, **kwargs):
            selected.update(kwargs)
            return operation_graph.operation_workflow(model, 'Review the supplied original evidence.', 32000,
                provider='openrouter', output_schema=kwargs['output_schema'],
                max_output_tokens=kwargs['operation_max_output_tokens'],
                default_reasoning_effort=kwargs['operation_default_reasoning_effort']), {}

        monkeypatch.setattr('backend.agent.factory.create_agent_workflow', workflow)
        graph, _ = asyncio.run(execution._operation_application(request, snapshot, {}, None, validation_retry=retry))
        result = graph.invoke({'messages': [HumanMessage(content=operation_input(request))], 'team_help_allowed': False})
    answer = json.loads(result['messages'][-1].content)
    jsonschema.validate(answer, request.output_schema)
    _validate(answer, data)
    assert answer == expected_result and len(sent) == 1
    payload = sent[0]
    expected = preferences.get('reasoning', {'enabled': False} if optional is True else None)
    assert payload.get('reasoning') == expected
    assert payload['provider'] == {'order': ['selected'], 'allow_fallbacks': False, 'require_parameters': True}
    assert payload['response_format']['json_schema']['schema'] == request.output_schema
    assert payload['max_completion_tokens'] == 16384 and request.max_model_calls == 2
    assert request.timeout_seconds == 300 and selected['operation_team_help'] is False
    assert selected['operation_default_reasoning_effort'] == (None if choice == 'profile' else 'off_if_optional')
    assert model.extra_body == preferences and snapshot.profile.get('reasoning_effort') == ('high' if choice == 'profile' else None)
    assert json.dumps(data, sort_keys=True) == before
