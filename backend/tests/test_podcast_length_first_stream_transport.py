"""The first SDK length call is globally bounded within its original stage."""
import asyncio
import json

import httpx2
import jsonschema
import pytest
from langchain_openai import ChatOpenAI

from backend.services import agent_execution as execution, agent_execution_store as store
from backend.services.agent_execution_models import AgentOperation
from backend.services.agent_execution_scope import execution_scope
from backend.services.podcast_composition import spoken_text
from backend.services.podcast_length_edits import apply_edits, composition_stream
from backend.tests.test_agent_execution import runtime as runtime
from backend.tests.test_podcast_length_word_repair import case


@pytest.mark.parametrize('allowance,first_valid,repair_valid', [
    (2, True, True), (2, False, True), (2, False, False), (1, False, True)])
def test_first_sdk_stream_avoids_original_echo_and_keeps_one_two_call_stage(
        runtime, monkeypatch, allowance, first_valid, repair_valid):
    from backend.agent import factory, model_router
    from backend.domains.agent.operation_graph import operation_workflow
    scope, snapshot = runtime
    data, base, _ = case()
    # Full-scale word counts fit the fixture's conservative UTF-8 accounting.
    base['paragraphs']['main']['text'] = ' '.join(['o'] * 1626)
    base['paragraphs']['minority']['text'] = ' '.join(['q'] * 185)
    contract = composition_stream(data, 1242, 1504)
    good = {'replacement_tokens': ['__gnosi_edit__:0', *(['r'] * 1195),
                                   '__gnosi_edit__:1', *(['q'] * 185)]}
    bad = {'replacement_tokens': [*good['replacement_tokens']]}
    bad['replacement_tokens'][0] = '__gnosi_edit__:foreign'
    snapshot.profile.update(provider='openrouter', model='fixture')
    monkeypatch.setattr(model_router, 'budget_status', lambda: {'over_cap': False})
    monkeypatch.setattr('backend.services.model_reasoning.reasoning_options',
        lambda *_: {'supported_efforts': [], 'supports_reasoning_disable': True})
    sent, created = [], []
    route = {'provider': {'order': ['selected'], 'allow_fallbacks': False}}

    def respond(request):
        sent.append(json.loads(request.content))
        valid = first_valid if len(sent) == 1 else repair_valid
        return httpx2.Response(200, json={'id': 'fixture', 'model': 'fixture',
            'object': 'chat.completion', 'created': 1, 'choices': [{'index': 0,
                'finish_reason': 'stop', 'message': {'role': 'assistant',
                    'content': json.dumps(good if valid else bad)}}]})

    async_client = httpx2.AsyncClient(transport=httpx2.MockTransport(respond))
    with httpx2.Client(transport=httpx2.MockTransport(respond)) as client:
        model = ChatOpenAI(model='fixture', api_key='fixture', base_url='https://fixture.invalid/v1',
            max_retries=0, http_client=client, http_async_client=async_client, extra_body=route)

        async def create(*args, **kwargs):
            created.append(kwargs)
            assert kwargs['timeout'] == 300
            return operation_workflow(model, 'Use only the supplied structured contract.', 32000,
                provider='openrouter', output_schema=kwargs['output_schema'],
                max_output_tokens=kwargs['operation_max_output_tokens'],
                default_reasoning_effort=kwargs['operation_default_reasoning_effort']), {
                    'provider': 'openrouter', 'model': 'fixture'}

        monkeypatch.setattr(factory, 'create_agent_workflow', create)
        request = AgentOperation(skill_id=snapshot.skill_ids[0], operation='podcast.coverage.write',
            input=contract.input, output_schema=contract.output_schema,
            max_model_calls=allowance, timeout_seconds=300)

        def validate(text):
            contract.restore(text)
            return text

        success = first_valid or allowance == 2 and repair_valid
        expected_calls = 1 if first_valid else allowance
        with execution_scope(scope):
            operation = execution.execute_operation(request, snapshot=snapshot, output_validator=validate)
            if success:
                completed = asyncio.run(operation)
                assert completed.status == 'completed' and completed.model_calls == expected_calls
                result = apply_edits(json.loads(contract.restore(completed.result)), base, data, 1242, 1504)
                assert len(spoken_text(result, data).split()) == 1380
                assert result['paragraphs']['minority'] == base['paragraphs']['minority']
                assert result['paragraphs']['excluded'] == base['paragraphs']['excluded']
            else:
                with pytest.raises((ValueError, jsonschema.ValidationError)):
                    asyncio.run(operation)
                failed = store.list_runs(scope)[0]
                assert failed.status == 'failed' and failed.model_calls == expected_calls and not failed.result
    asyncio.run(async_client.aclose())
    assert len(sent) == expected_calls and len(created) == 1
    for payload in sent:
        assert payload['max_completion_tokens'] == 16384
        assert payload['provider'] == {'order': ['selected'], 'allow_fallbacks': False, 'require_parameters': True}
        assert payload['reasoning'] == {'enabled': False}
        assert payload['response_format']['type'] == 'json_schema'
        wire_schema = payload['response_format']['json_schema']['schema']
        assert wire_schema == contract.output_schema
        assert wire_schema['properties']['replacement_tokens']['maxItems'] == 1506
    assert all('before' not in anchor for anchor in json.loads(contract.input)['anchors'])
    assert request.max_model_calls == allowance and request.timeout_seconds == 300
    assert model.root_client.max_retries == 0 and model.extra_body == route
