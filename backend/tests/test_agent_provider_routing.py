"""Fixed upstreams preserve privacy, exact model ownership and refusal handling."""
import copy
import json

import httpx
import pytest
from openai import ContentFilterFinishReasonError
from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI

from backend.domains.agent.provider_routing import constrain_provider_route, selected_upstream, resumed_provider_profile
from backend.domains.agent.structured_output import constrain_output


def profile(value=' DeepInfra '):
    return {'id': 'bot', 'provider': 'openrouter', 'model': 'fixture',
            'openrouter_route': {'model': 'fixture', 'provider': value}}


def test_route_is_explicit_and_belongs_to_exact_pinned_model():
    assert selected_upstream(profile(), 'openrouter', 'fixture') == 'deepinfra'
    assert selected_upstream({'provider': 'openrouter', 'model': 'fixture'}, 'openrouter', 'fixture') is None
    assert selected_upstream(profile(), 'openai', 'fixture') is None
    assert selected_upstream(profile(), 'openrouter', 'another') is None
    changed = {**profile(), 'model': 'another'}
    assert selected_upstream(changed, 'openrouter', 'another') is None
    assert selected_upstream(profile('  '), 'openrouter', 'fixture') is None
    assert selected_upstream(profile('DeepInfra/FP8'), 'openrouter', 'fixture') == 'deepinfra/fp8'


@pytest.mark.parametrize('value', [123, [], 'https://provider.invalid', 'provider name', '../secret', 'x' * 129])
def test_invalid_provider_identifiers_fail_before_transport(value):
    with pytest.raises(ValueError, match='provider_invalid'):
        selected_upstream(profile(value), 'openrouter', 'fixture')


@pytest.mark.parametrize('route', ['deepinfra', {}, {'model': 'fixture'},
                                   {'model': 'fixture', 'provider': 'deepinfra', 'zdr': False}])
def test_malformed_or_expanded_profile_contract_fails_closed(route):
    with pytest.raises(ValueError, match='provider_invalid'):
        selected_upstream({**profile(), 'openrouter_route': route}, 'openrouter', 'fixture')


def test_fixed_route_preserves_base_and_bound_privacy_constraints_without_mutation():
    extra = {'provider': {'data_collection': 'deny', 'zdr': True, 'only': ['deepinfra'],
                          'ignore': ['excluded'], 'max_price': {'prompt': 1}},
             'reasoning': {'effort': 'high'}}
    model = ChatOpenAI(model='fixture', api_key='fixture', extra_body=copy.deepcopy(extra))
    bound_extra = {'provider': {'quantizations': ['fp8']}, 'custom': 'preserved'}
    bound = model.bind(extra_body=copy.deepcopy(bound_extra))
    routed = constrain_provider_route(bound, 'openrouter', 'deepinfra')
    final = constrain_output(routed, 'openrouter', {'type': 'object', 'properties': {},
                                                  'required': [], 'additionalProperties': False})
    sent = final.kwargs['extra_body']
    assert sent['provider'] == {**extra['provider'], **bound_extra['provider'],
                               'order': ['deepinfra'], 'allow_fallbacks': False, 'require_parameters': True}
    assert sent['reasoning'] == extra['reasoning'] and sent['custom'] == 'preserved'
    assert model.extra_body == extra and bound.kwargs['extra_body'] == bound_extra
    assert constrain_provider_route(model, 'openrouter', None) is model
    assert constrain_provider_route(model, 'openai', 'deepinfra') is model


def test_real_client_sends_route_and_keeps_provider_refusal_terminal():
    sent = []
    def respond(request):
        sent.append(json.loads(request.content))
        return httpx.Response(200, json={'id': 'fixture', 'object': 'chat.completion', 'model': 'fixture',
            'choices': [{'index': 0, 'finish_reason': 'content_filter',
                         'message': {'role': 'assistant', 'content': None}}]})
    with httpx.Client(transport=httpx.MockTransport(respond)) as transport:
        model = ChatOpenAI(model='fixture', api_key='fixture', max_retries=0,
                           base_url='https://openrouter.invalid/api/v1', http_client=transport)
        routed = constrain_provider_route(model, 'openrouter', 'deepinfra')
        constrained = constrain_output(routed, 'openrouter', {
            'type': 'object', 'properties': {'ok': {'type': 'boolean'}},
            'required': ['ok'], 'additionalProperties': False})
        with pytest.raises(ContentFilterFinishReasonError):
            constrained.invoke([HumanMessage(content='Synthetic news briefing')])
    assert len(sent) == 1
    assert sent[0]['provider'] == {'order': ['deepinfra'], 'allow_fallbacks': False, 'require_parameters': True}


def test_fixed_route_preserves_json_tool_wrapper_and_requires_bindable_transport():
    from backend.agent.json_tool_model import JsonToolModel
    base = ChatOpenAI(model='fixture', api_key='fixture')
    wrapped = JsonToolModel(base, [{'type': 'function', 'function': {'name': 'fixture', 'parameters': {'type': 'object'}}}])
    routed = constrain_provider_route(wrapped, 'openrouter', 'deepinfra')
    assert routed.schemas == wrapped.schemas
    assert routed.model.extra_body['provider']['order'] == ['deepinfra']
    with pytest.raises(ValueError, match='transport_unsupported'):
        constrain_provider_route(object(), 'openrouter', 'deepinfra')


def test_resume_refreshes_only_the_upstream_and_retains_all_frozen_profile_fields():
    frozen = {'id': 'bot', 'provider': 'openrouter', 'model': 'fixture',
              'persona': 'Frozen instructions', 'context': 'Frozen evidence', 'skill_ids': ['original']}
    current = {**profile(), 'persona': 'Changed instructions', 'skill_ids': ['different']}
    before = copy.deepcopy((frozen, current))
    resumed = resumed_provider_profile(frozen, current)
    assert resumed == {**frozen, 'openrouter_route': {'model': 'fixture', 'provider': 'deepinfra'}}
    assert (frozen, current) == before
    for change in [{'id': 'another'}, {'provider': 'openai'}, {'model': 'another'}]:
        assert resumed_provider_profile(frozen, {**current, **change}) is frozen
    assert resumed_provider_profile(resumed, {**current, 'openrouter_route': None}) == frozen


def test_resumed_snapshot_route_has_its_own_revision_without_changing_source_scope(monkeypatch, tmp_path):
    from types import SimpleNamespace
    from backend.services.agent_execution_models import AgentExecutionSnapshot, ExecutionScope
    from backend.services import audio_summarizer
    scope = ExecutionScope(user_id='fixture', workspace_id='fixture', role='owner', vault_path=str(tmp_path))
    frozen = {'id': 'bot', 'provider': 'openrouter', 'model': 'fixture', 'persona': 'Frozen'}
    snapshot = AgentExecutionSnapshot(scope=scope, agent_id='bot', profile=frozen, skill_ids=['original'],
        instructions=['Frozen instruction'], catalog_revision='catalog', revision='before', parent_run_id='day')
    monkeypatch.setattr('backend.config.app_config.load_params', lambda **_: SimpleNamespace(ai={'agents': [profile()]}))
    events = []
    monkeypatch.setattr('backend.services.agent_execution_trace.append', lambda *args: events.append(args))
    updated = audio_summarizer._refresh_podcast_upstream(snapshot)
    assert updated.profile['openrouter_route'] == {'model': 'fixture', 'provider': 'deepinfra'}
    assert updated.revision != snapshot.revision
    assert updated.model_dump(exclude={'profile', 'revision'}) == snapshot.model_dump(exclude={'profile', 'revision'})
    assert updated.profile['persona'] == 'Frozen' and 'openrouter_route' not in snapshot.profile
    assert audio_summarizer._refresh_podcast_upstream(snapshot).revision == updated.revision
    assert events[0][2] == 'job.provider_route'


@pytest.mark.parametrize('bound', [False, True])
def test_native_tool_binding_preserves_fixed_upstream_and_all_constraints(bound):
    from backend.agent.tools import bind_model_tools
    extra = {'provider': {'zdr': True, 'ignore': ['excluded']}, 'reasoning': {'effort': 'low'}}
    client = ChatOpenAI(model='fixture', api_key='fixture', extra_body=copy.deepcopy(extra))
    model = client.bind(extra_body={'provider': {'data_collection': 'deny'}}) if bound else client
    routed = constrain_provider_route(model, 'openrouter', 'deepinfra')
    tools = [{'type': 'function', 'function': {'name': 'fixture',
        'parameters': {'type': 'object', 'properties': {}, 'additionalProperties': False}}}]
    tooled = bind_model_tools(routed, tools)
    final = constrain_output(tooled, 'openrouter', {'type': 'object',
        'properties': {}, 'additionalProperties': False, 'required': []})
    preferences = final.kwargs['extra_body']['provider']
    assert preferences == {**extra['provider'], **({'data_collection': 'deny'} if bound else {}),
        'order': ['deepinfra'], 'allow_fallbacks': False, 'require_parameters': True}
    assert final.kwargs['extra_body']['reasoning'] == extra['reasoning']
    assert final.kwargs['tools'][0]['function']['name'] == 'fixture'
    assert client.extra_body == extra
    if bound:
        assert model.kwargs == {'extra_body': {'provider': {'data_collection': 'deny'}}}


def test_workflow_route_application_preserves_model_setup_and_matches_metadata():
    from backend.domains.agent.provider_routing import apply_provider_route
    from backend.domains.agent.workflow_setup import ModelSetup
    client = ChatOpenAI(model='fixture', api_key='fixture')
    model = ModelSetup(llm=client, provider_name='openrouter', model_name='fixture',
                       strategy={'mode': 'pinned'}, fallback_metadata=[])
    routed, metadata = apply_provider_route(profile(), model)
    assert routed.provider_name == model.provider_name and routed.model_name == model.model_name
    assert routed.strategy == model.strategy and routed.fallback_metadata == []
    assert routed.llm.extra_body['provider'] == metadata['provider_routing']
    assert apply_provider_route({**profile(), 'model': 'other'}, model) == (model, {})
    assert client.extra_body is None
