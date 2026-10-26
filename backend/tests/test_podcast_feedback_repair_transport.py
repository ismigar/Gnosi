"""Use actual stage/executor/SDK transport with disposable local data only."""
import asyncio
from copy import deepcopy
import json

import httpx2
import jsonschema
import pytest
from langchain_openai import ChatOpenAI

from backend.services import agent_execution_store as store
from backend.services.agent_execution_scope import execution_scope
from backend.services.podcast_briefing import _Briefing
from backend.services.podcast_feedback import _validate_guidance
from backend.tests.test_agent_execution import runtime as runtime
from backend.tests.test_podcast_feedback_repair import case


@pytest.mark.parametrize('calls,valid_patch,invalid_utf8', [(2, True, False), (2, False, False), (1, True, False), (2, True, True)])
def test_stage_repairs_all_three_guides_only_with_its_original_remaining_call(
        runtime, monkeypatch, calls, valid_patch, invalid_utf8):
    from backend.agent import factory, model_router
    from backend.domains.agent.operation_graph import operation_workflow
    scope, snapshot = runtime
    snapshot.profile.update(provider='openrouter', model='fixture')
    monkeypatch.setattr(model_router, 'budget_status', lambda: {'over_cap': False})
    monkeypatch.setattr('backend.services.model_reasoning.reasoning_options',
        lambda *_: {'supported_efforts': [], 'supports_reasoning_disable': True})
    _, base, original = case()
    request = base.model_copy(update={'skill_id': snapshot.skill_ids[0], 'max_model_calls': calls, 'timeout_seconds': 300})
    bad_keys = {'finding:0', 'finding:1', 'finding:5'}
    if invalid_utf8:
        original['guidance']['finding:2'] = 'a\ud800'
        bad_keys.add('finding:2')
    before, sent = deepcopy(original), []
    patch = {'guidance': {key: 'Keep the original qualification.' for key in bad_keys}}
    if not valid_patch:
        del patch['guidance']['finding:1']
    route = {'provider': {'order': ['selected'], 'allow_fallbacks': False}}
    def respond(req):
        sent.append(json.loads(req.content))
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
            return operation_workflow(model, 'Use only the requested structured contract.', 80000,
                provider='openrouter', output_schema=kwargs['output_schema'],
                max_output_tokens=kwargs['operation_max_output_tokens'],
                default_reasoning_effort=kwargs['operation_default_reasoning_effort']), {
                    'provider': 'openrouter', 'model': 'fixture'}
        monkeypatch.setattr(factory, 'create_agent_workflow', create)
        context = _Briefing(snapshot, 'Catalan', 80_000, lambda value: len(value.encode()), lambda: None)
        with execution_scope(scope):
            if calls == 2 and valid_patch:
                result = context.stage(request, lambda value: _validate_guidance(value, 160))
                assert set(result['guidance']) == set(original['guidance'])
                assert all(result['guidance'][key] == text for key, text in before['guidance'].items()
                           if key not in patch['guidance'])
                assert store.list_runs(scope)[0].status == 'completed'
            else:
                with pytest.raises((ValueError, jsonschema.ValidationError)):
                    context.stage(request, lambda value: _validate_guidance(value, 160))
                row = store.list_runs(scope)[0]
                assert row.status == 'failed' and row.model_calls == calls and not row.result
        assert original == before and len(sent) == calls
        assert model.root_client.max_retries == 0 and model.extra_body == route
    asyncio.run(async_client.aclose())
    for payload in sent:
        assert payload['model'] == 'fixture' and payload['max_completion_tokens'] == 16384
        assert payload['provider'] == {'order': ['selected'], 'allow_fallbacks': False, 'require_parameters': True}
        assert payload['reasoning'] == {'enabled': False}
        assert payload['response_format']['type'] == 'json_schema'
    if calls == 2:
        required = sent[1]['response_format']['json_schema']['schema']['properties']['guidance']['required']
        assert set(required) == bad_keys
        envelope = json.loads(sent[1]['messages'][-1]['content'])
        repair_data = json.loads(envelope['input'])['data']
        assert repair_data['guidance_target_bytes'] == 80 and repair_data['guidance_byte_budget'] == 160
        assert set(repair_data['rejected_guidance']) == set(required)
        if invalid_utf8:
            assert repair_data['rejected_guidance']['finding:2']['invalid_utf8'] is True
            assert repair_data['rejected_guidance']['finding:2']['serialized_utf8_bytes'] is None
            assert 'text' not in repair_data['rejected_guidance']['finding:2']
    assert request.max_model_calls == calls and request.timeout_seconds == 300
