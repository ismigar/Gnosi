"""Exercise automatic audit quote selection through the real bounded SDK executor."""
import asyncio
import copy
import json

import httpx2
import jsonschema
import pytest
from langchain_openai import ChatOpenAI

from backend.services import agent_execution as execution, agent_execution_store as store
from backend.services.agent_execution_models import AgentOperation
from backend.services.agent_execution_scope import execution_scope
from backend.services.podcast_audit_repair import audit_quote_repair
from backend.services.podcast_review import _schema, _validate
from backend.tests.test_agent_execution import runtime as runtime
from backend.tests.test_podcast_audit_repair import case as case, built, selection


@pytest.mark.parametrize('compound', [False, True], ids=['quote-only', 'compound'])
@pytest.mark.parametrize('calls,valid_patch', [(2, True), (2, False), (1, True)])
def test_real_executor_uses_only_remaining_call_and_never_publishes_an_invalid_patch(
        runtime, monkeypatch, case, calls, valid_patch, compound):
    from backend.agent import factory, model_router
    from backend.domains.agent.operation_graph import operation_workflow
    scope, snapshot = runtime
    data, original = case
    if compound:
        data.pop('review_focus')
        original['issues'][1]['kind'] = 'omission'
    snapshot.profile.update(provider='openrouter', model='fixture')
    monkeypatch.setattr(model_router, 'budget_status', lambda: {'over_cap': False})
    monkeypatch.setattr('backend.services.model_reasoning.reasoning_options',
        lambda *_: {'supported_efforts': [], 'supports_reasoning_disable': True})
    if compound and valid_patch:
        patch = copy.deepcopy(original)
        patch['issues'][0].update(narration_quotes=[data['narration'].split(' Police')[0]],
                                  evidence_quote=data['briefs'][0]['source_text'])
        patch['issues'][1]['narration_quotes'] = []
    else:
        patch = selection(built(case)) if valid_patch else {'quote_ids': {}}
    sent = []
    route = {'provider': {'order': ['selected'], 'allow_fallbacks': False}}
    def respond(request):
        sent.append(json.loads(request.content))
        result = original if len(sent) == 1 else patch
        return httpx2.Response(200, json={'id': 'fixture', 'model': 'fixture', 'object': 'chat.completion',
            'created': 1, 'choices': [{'index': 0, 'finish_reason': 'stop', 'message': {
                'role': 'assistant', 'content': json.dumps(result)}}]})
    async_client = httpx2.AsyncClient(transport=httpx2.MockTransport(respond))
    with httpx2.Client(transport=httpx2.MockTransport(respond)) as client:
        model = ChatOpenAI(model='fixture', api_key='fixture', base_url='https://fixture.invalid/v1',
            max_retries=0, http_client=client, http_async_client=async_client, extra_body=route)
        async def create(*args, **kwargs):
            assert kwargs['timeout'] == 300
            return operation_workflow(model, 'Use only the requested structured contract.', 32000,
                provider='openrouter', output_schema=kwargs['output_schema'],
                max_output_tokens=kwargs['operation_max_output_tokens'],
                default_reasoning_effort=kwargs['operation_default_reasoning_effort']), {
                    'provider': 'openrouter', 'model': 'fixture'}
        monkeypatch.setattr(factory, 'create_agent_workflow', create)
        schema = _schema(data)
        request = AgentOperation(skill_id=snapshot.skill_ids[0], operation='podcast.coverage.audit',
            input=json.dumps({'task': 'podcast.coverage.audit', 'data': data}), output_schema=schema,
            max_model_calls=calls, timeout_seconds=300)
        def validate(text):
            _validate(json.loads(text), data)
            return text
        with execution_scope(scope):
            operation = execution.execute_operation(request, snapshot=snapshot,
                output_validator=validate, output_repair=audit_quote_repair(data, schema))
            if calls == 2 and valid_patch:
                completed = asyncio.run(operation)
                assert completed.status == 'completed' and completed.model_calls == 2
                result = json.loads(completed.result)
                _validate(result, data)
                if not compound:
                    assert result['issues'][1] == original['issues'][1]
                assert [i['kind'] for i in result['issues']] == [i['kind'] for i in original['issues']]
                assert [i['detail'] for i in result['issues']] == [i['detail'] for i in original['issues']]
                assert [i['source_part_ids'] for i in result['issues']] == [i['source_part_ids'] for i in original['issues']]
            else:
                with pytest.raises((ValueError, jsonschema.ValidationError)):
                    asyncio.run(operation)
                failed = store.list_runs(scope)[0]
                assert failed.status == 'failed' and failed.model_calls == calls and not failed.result
    asyncio.run(async_client.aclose())
    assert len(sent) == calls
    for payload in sent:
        assert payload['model'] == 'fixture' and payload['max_completion_tokens'] == 16384
        assert payload['provider'] == {'order': ['selected'], 'allow_fallbacks': False, 'require_parameters': True}
        assert payload['reasoning'] == {'enabled': False}
        assert payload['response_format']['type'] == 'json_schema'
    assert sent[0]['response_format']['json_schema']['schema'] == schema
    if calls == 2 and compound:
        assert sent[1]['response_format']['json_schema']['schema'] == schema
        assert 'quote_pools' not in json.dumps(sent[1])
    elif calls == 2:
        assert 'quote_ids' in sent[1]['response_format']['json_schema']['schema']['properties']
        assert 'quote_pools' in json.dumps(sent[1])
    assert request.max_model_calls == calls and request.timeout_seconds == 300 and model.root_client.max_retries == 0
    assert model.extra_body == route
