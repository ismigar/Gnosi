"""Exercise the bounded replacement contract through the actual SDK/executor."""
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
from backend.services.podcast_composition import spoken_text
from backend.services.podcast_length_edits import apply_edits, composition_digest, schema, word_stream_repair
from backend.tests.test_agent_execution import runtime as runtime
from backend.tests.test_podcast_length_word_repair import case, patch


@pytest.mark.parametrize('mode', ['global-word-stream', 'invalid-anchor-ordinary', 'infeasible-fixed-anchors'])
@pytest.mark.parametrize('calls,valid', [(2, True), (2, False), (1, True)])
def test_sdk_preserves_two_call_deadline_route_and_whole_episode_validation(
        runtime, monkeypatch, calls, valid, mode):
    from backend.agent import factory, model_router
    from backend.domains.agent.operation_graph import operation_workflow
    scope, snapshot = runtime
    data, base, rejected = case()
    # Keep the full 1811-word arithmetic while fitting the fixture model's
    # conservative UTF-8 context accounting; production budgets are unchanged.
    base['paragraphs']['main']['text'] = ' '.join(['o'] * 1626)
    base['paragraphs']['minority']['text'] = ' '.join(['q'] * 185)
    rejected['composition_sha256'] = composition_digest(base)
    rejected['edits'][0].update(before=base['paragraphs']['main']['text'],
                               after=' '.join(['added'] * 1652))
    ordinary = mode != 'global-word-stream'
    minimum, maximum = 1242, 1504
    if mode == 'infeasible-fixed-anchors':
        minimum, maximum = 1, 2
        base = {'paragraphs': {'a': {'text': 'a b', 'non_editorial': False},
                               'b': {'text': 'c d', 'non_editorial': False}}}
        data = {'composition_groups': [{'key': 'a'}, {'key': 'b'}], 'previous_composition': base}
        rejected = {'composition_sha256': composition_digest(base), 'edits': [
            {'group_key': 'a', 'before': 'a b', 'after': 'a b extra'}]}
    elif ordinary:
        rejected['edits'][0]['before'] = 'Absent original anchor'
    snapshot.profile.update(provider='openrouter', model='fixture')
    monkeypatch.setattr(model_router, 'budget_status', lambda: {'over_cap': False})
    monkeypatch.setattr('backend.services.model_reasoning.reasoning_options',
        lambda *_: {'supported_efforts': [], 'supports_reasoning_disable': True})
    if mode == 'infeasible-fixed-anchors':
        response = {'composition_sha256': composition_digest(base), 'edits': [
            {'group_key': 'a', 'before': 'a b', 'after': 'a'},
            {'group_key': 'b', 'before': 'c d', 'after': 'c'}]} if valid else rejected
    elif ordinary:
        response = copy.deepcopy(rejected)
        response['edits'][0].update(before=base['paragraphs']['main']['text'],
            after=' '.join(['supported'] * (1195 if valid else 1364)))
    else:
        response = patch(1195 if valid else 1364)
    sent = []
    route = {'provider': {'order': ['selected'], 'allow_fallbacks': False}}

    def respond(request):
        sent.append(json.loads(request.content))
        value = rejected if len(sent) == 1 else response
        return httpx2.Response(200, json={'id': 'fixture', 'model': 'fixture',
            'object': 'chat.completion', 'created': 1, 'choices': [{'index': 0,
                'finish_reason': 'stop', 'message': {'role': 'assistant', 'content': json.dumps(value)}}]})

    async_client = httpx2.AsyncClient(transport=httpx2.MockTransport(respond))
    with httpx2.Client(transport=httpx2.MockTransport(respond)) as client:
        model = ChatOpenAI(model='fixture', api_key='fixture', base_url='https://fixture.invalid/v1',
            max_retries=0, http_client=client, http_async_client=async_client, extra_body=route)

        async def create(*args, **kwargs):
            assert kwargs['timeout'] == 300
            return operation_workflow(model, 'Use the supplied structured contract.', 32000,
                provider='openrouter', output_schema=kwargs['output_schema'],
                max_output_tokens=kwargs['operation_max_output_tokens'],
                default_reasoning_effort=kwargs['operation_default_reasoning_effort']), {
                    'provider': 'openrouter', 'model': 'fixture'}

        monkeypatch.setattr(factory, 'create_agent_workflow', create)
        original_schema = schema(data)
        request = AgentOperation(skill_id=snapshot.skill_ids[0], operation='podcast.coverage.write',
            input=json.dumps({'task': 'podcast.coverage.write', 'data': data}),
            output_schema=original_schema, max_model_calls=calls, timeout_seconds=300)

        def validate(text):
            apply_edits(json.loads(text), base, data, minimum, maximum)
            return text

        with execution_scope(scope):
            operation = execution.execute_operation(request, snapshot=snapshot,
                output_validator=validate, output_repair=word_stream_repair(data, minimum, maximum))
            if calls == 2 and valid:
                completed = asyncio.run(operation)
                assert completed.status == 'completed' and completed.model_calls == 2
                restored = json.loads(completed.result)
                result = apply_edits(restored, base, data, minimum, maximum)
                if mode == 'infeasible-fixed-anchors':
                    assert spoken_text(result, data) == 'a\n\nc'
                else:
                    assert len(spoken_text(result, data).split()) == 1380
                    assert result['paragraphs']['minority'] == base['paragraphs']['minority']
                    assert result['paragraphs']['excluded'] == base['paragraphs']['excluded']
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
    assert sent[0]['response_format']['json_schema']['schema'] == original_schema
    if calls == 2:
        wire = sent[1]['response_format']['json_schema']['schema']
        if ordinary:
            assert wire == original_schema
        else:
            assert wire['properties']['replacement_tokens']['minItems'] == 1058
            assert wire['properties']['replacement_tokens']['maxItems'] == 1320
            assert 'original_groups' in json.dumps(sent[1])
            assert 'expanded' not in json.dumps(sent[1])
    assert request.max_model_calls == calls and request.timeout_seconds == 300
    assert model.root_client.max_retries == 0 and model.extra_body == route
