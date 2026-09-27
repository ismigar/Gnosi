from types import SimpleNamespace
import json
import pytest
from backend.services import agent_role_evaluations as service, agent_team_store as artifacts, agent_execution_store as runs
from backend.services.agent_execution_models import ExecutionScope


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setattr(runs, 'resolve_data_dir', lambda **_: tmp_path)
    scope = ExecutionScope(user_id='user', workspace_id='workspace', vault_path=str(tmp_path), role='admin')
    profiles = [{'id':id, 'provider':'test', 'model':id, 'persona':'PRIVATE DO NOT SEND', 'enabled':True} for id in ('general','director','cheap')]
    registry = [{'provider':'test','model_id':p['id'],'enabled':True,'cost_in':price,'cost_out':price,'context_window':32000} for p,price in zip(profiles,[2,5,1])]
    return scope, profiles, registry


def fixture_invoker(profile, prompt):
    assert 'PRIVATE' not in prompt
    if prompt.startswith('Plan this synthetic assignment'):
        operation = 'extraction' if 'invoice' in prompt else 'sorting' if 'Sort [' in prompt else 'evidence_review'
        expected = {'executor':'cheap','operation':operation}
    elif prompt.startswith('Extract synthetic quotes'):
        expected = [{'source':'NEW','date':'2025-02-01','unit_price':12,'currency':'EUR'}]
    elif prompt.startswith('Using the previous'):
        expected = service.STRATEGY_COMPLEX['expected']
    elif prompt.startswith('Synthetic sources: [OLD'):
        expected = service.STRATEGY_COMPLEX['expected']
    else:
        case = next(c for cases in service.CASES.values() for c in cases if c['prompt'] == prompt)
        expected = case['expected']
    return SimpleNamespace(content=json.dumps(expected), usage_metadata={'input_tokens':100,'output_tokens':20})


@pytest.mark.parametrize('role', list(service.CASES))
def test_specific_validators_save_scoped_metadata_and_attach_to_exact_route(setup, role):
    scope, profiles, registry = setup
    report = service.run_evaluation(service.EvaluationRequest(agent_id='general',role=role,authorize_model_calls=True),scope,profiles,registry,fixture_invoker)
    assert report['score'] == 100
    assert len(report['cases']) >= 2
    assert report['cost_usd'] > 0
    saved = artifacts.list_artifacts(scope,'role_evaluation')
    assert saved == [report]
    assert 'prompt' not in json.dumps(saved) and 'PRIVATE' not in json.dumps(saved)
    assert artifacts.list_artifacts(scope.model_copy(update={'user_id':'other'}),'role_evaluation') == []
    assessment = {'role':role,'score':60,'status':'catalog_compatible','proofs':[],'missing':['broad_quality']}
    feed = {'models':[{'routes':[{'provider':'test','model_id':'general'}],'role_assessments':[assessment]}, {'routes':[{'provider':'other','model_id':'general'}],'role_assessments':[assessment]}]}
    enriched = service.attach_evaluations(feed,saved)
    assert enriched['models'][0]['role_assessments'][0]['score'] == 80
    assert enriched['models'][0]['role_assessments'][0]['missing'] == ['broad_quality']
    assert 'evaluation_score' not in enriched['models'][1]['role_assessments'][0]
    assert 'evaluation_score' not in assessment


def test_three_strategies_same_cases_direct_routes_and_no_extra_review(setup):
    scope, profiles, registry = setup
    report = service.run_evaluation(service.EvaluationRequest(kind='strategies',agent_id='general',director_id='director',executor_id='cheap',authorize_model_calls=True),scope,profiles,registry,fixture_invoker)
    assert report['model_calls'] == 17
    assert report['score'] == 100
    for strategy in ('allrounder','director_always','director_routes'):
        assert {c['id'] for c in report['cases'] if c['strategy']==strategy} == {'extract','sort','conflicting_sources'}
    direct = [c for c in report['cases'] if c['strategy']=='director_routes' and c['id']!='conflicting_sources']
    assert all(c['director_calls']==0 and c['model_calls']==1 and c['executor_id']=='cheap' for c in direct)
    assert report['cost_usd'] == pytest.approx(sum(c['cost_usd'] for c in report['cases']))


def test_missing_usage_is_unknown_and_bad_contract_not_passed(setup):
    scope,profiles,registry=setup
    report=service.run_evaluation(service.EvaluationRequest(agent_id='general',role='worker',authorize_model_calls=True),scope,profiles,registry,lambda *_: '[]')
    assert report['score']==0 and report['cost_usd'] is None
    assert all(c['cost_usd'] is None for c in report['cases'])
    assert not service.validate_result('{"x":true}', {'x':1})


@pytest.mark.parametrize('change', [{'authorize_model_calls':False}, {'agent_id':'missing'}])
def test_no_calls_without_explicit_authorization_or_available_profile(setup,change):
    scope,profiles,registry=setup
    request=service.EvaluationRequest(agent_id='general',authorize_model_calls=True).model_copy(update=change)
    with pytest.raises((PermissionError,ValueError)):
        service.run_evaluation(request,scope,profiles,registry,lambda *_: pytest.fail('unexpected provider call'))


def test_cancel_stops_later_cases(setup):
    scope,profiles,registry=setup
    def invoke(*args):
        runs.cancel(scope,service.evaluation_parent.get())
        return fixture_invoker(*args)
    with pytest.raises(InterruptedError):
        service.run_evaluation(service.EvaluationRequest(agent_id='general',role='worker',authorize_model_calls=True),scope,profiles,registry,invoke)
    assert artifacts.list_artifacts(scope,'role_evaluation') == []


def test_metadata_trace_omits_content_and_resets_to_normal_behavior(setup):
    from backend.services import agent_execution_trace as trace
    from backend.services.agent_execution import _run
    from backend.services.agent_execution_scope import execution_scope
    from backend.services.agent_execution_models import AgentRun
    scope, _, _ = setup
    runs.create(AgentRun(run_id='trace-test', agent_id='general', skill_id='', operation='test', origin='diagnostic', status='running', created_at=1, updated_at=1), scope, {}, {})
    run_token = _run.set('trace-test')
    try:
        with execution_scope(scope):
            token = trace.metadata_only_trace.set(True)
            try:
                trace.record('llm_output', {'content':'private response'})
            finally:
                trace.metadata_only_trace.reset(token)
            trace.record('step', {'normal':'kept'})
        events = trace.events(scope, 'trace-test')['events']
        assert events[0]['value'] == {'metadata_only':True}
        assert events[1]['value'] == {'normal':'kept'}
        assert 'private response' not in json.dumps(events)
    finally:
        _run.reset(run_token)
