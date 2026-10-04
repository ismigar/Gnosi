"""Offline checks for task-specific evidence, isolation, reuse and spending."""
import json
from types import SimpleNamespace
from datetime import datetime, timedelta, timezone
import pytest
from backend.services import agent_task_evaluations as service
from backend.services import agent_execution_store as runs, agent_team_store as artifacts, ai_usage_ledger as ledger
from backend.services.agent_execution_models import ExecutionScope
from backend.services.agent_task_cases import CASES, cases_for
from backend.services.agent_task_evaluation_models import TaskEvaluationRequest


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setattr(runs, 'resolve_data_dir', lambda **_: tmp_path)
    monkeypatch.setattr(ledger, 'resolve_data_dir', lambda **_: tmp_path)
    scope = ExecutionScope(user_id='user', workspace_id='space', vault_path=str(tmp_path), role='admin')
    registry = [{'provider': 'p', 'model_id': 'm', 'enabled': True, 'cost_in': 1, 'cost_out': 2, 'context_window': 64000}]
    return scope, registry


def request(**change):
    return TaskEvaluationRequest(agent_id='bot', provider='p', model='m', tasks=['book'],
                                 authorize_model_calls=True, budget_usd=.1).model_copy(update=change)


def invoke(_parent, prompt):
    from backend.services import reading_budget
    assert reading_budget.active(), 'Every diagnostic call must enter its spending session'
    case = next(case for case in CASES if case.prompt == prompt)
    return SimpleNamespace(content=json.dumps(case.expected, ensure_ascii=False),
        usage_metadata={'input_tokens': 100, 'output_tokens': 50})


@pytest.mark.parametrize('task', ['classify', 'extract', 'book', 'retrieve', 'code', 'workflow', 'analyse',
                                  'translate', 'write', 'calendar', 'research', 'synthesize'])
def test_function_contracts_persist_only_scoped_metadata(setup, task):
    scope, registry = setup
    report = service.run(request(tasks=[task]), scope, registry, invoke)
    assert report.status == 'completed' and all(case.passed for case in report.cases)
    assert report.model_calls == len(cases_for([task])) >= 1
    saved = artifacts.list_artifacts(scope, 'task_evaluation')
    assert saved == [report.model_dump()]
    assert not any(case.prompt in json.dumps(saved) for case in CASES)
    assert artifacts.list_artifacts(scope.model_copy(update={'user_id': 'other'}), 'task_evaluation') == []


def test_same_cases_reused_across_bots_but_missing_functions_only_are_called(setup):
    scope, registry = setup
    original = service.run(request(), scope, registry, invoke)
    cached = service.plan(request(agent_id='another'), scope, registry)
    assert len(cached.reused_cases) == original.model_calls and cached.pending_ids == []
    assert cached.maximum_cost_usd == 0
    calls = []
    def track(parent, prompt):
        calls.append(prompt)
        return invoke(parent, prompt)
    second = service.run(request(agent_id='another', tasks=['book', 'translate']), scope, registry, track)
    assert second.reused_cases == original.model_calls
    assert second.model_calls == len(cases_for(['translate'])) == len(calls)
    assert all(case.reused_from == original.id for case in second.cases if case.reused_from)


def test_old_different_version_mode_and_provider_are_not_reused(setup):
    scope, registry = setup
    report = service.run(request(), scope, registry, invoke)
    for field, value in [('version', 'old'), ('mode', 'other'), ('provider', 'other')]:
        invalid = report.model_copy(update={field: value})
        artifacts.put(scope, report.id, report.id, 'task_evaluation', invalid.model_dump())
        assert service.plan(request(), scope, registry).reused_cases == []
    past = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat()
    report.cases = [case.model_copy(update={'checked_at': past}) for case in report.cases]
    artifacts.put(scope, report.id, report.id, 'task_evaluation', report.model_dump())
    assert service.plan(request(), scope, registry).reused_cases == []


@pytest.mark.parametrize('change', [{'authorize_model_calls': False}, {'budget_usd': .000001}])
def test_no_transport_before_authorization_and_budget_validation(setup, change):
    scope, registry = setup
    with pytest.raises((ValueError, PermissionError)):
        service.run(request(**change), scope, registry, lambda *_: pytest.fail('unapproved call'))


def test_unknown_price_and_disabled_route_cannot_be_called(setup):
    scope, registry = setup
    for change in [{'cost_out': None}, {'cost_in': 0, 'cost_out': 0}]:
        preview = service.plan(request(), scope, [{**registry[0], **change}])
        assert not preview.can_run and preview.reason == 'unknown_price'
    with pytest.raises(ValueError, match='model_unavailable'):
        service.run(request(), scope, [{**registry[0], 'enabled': False}], lambda *_: pytest.fail('disabled call'))


def test_cancellation_saves_completed_checks_for_next_attempt(setup):
    scope, registry = setup
    def cancel(parent, prompt):
        runs.cancel(scope, parent)
        return invoke(parent, prompt)
    report = service.run(request(), scope, registry, cancel)
    assert report.status == 'stopped' and report.model_calls == 1 and report.cases[0].passed
    assert len(service.plan(request(), scope, registry).reused_cases) == 1


def test_transient_failure_is_not_cached_as_poor_quality_and_prevents_more_calls(setup):
    scope, registry = setup
    def fail(*_):
        raise TimeoutError('synthetic')
    report = service.run(request(), scope, registry, fail)
    assert report.status == 'stopped' and report.model_calls == 1 and report.cost_usd is None
    assert service.plan(request(), scope, registry).reused_cases == []


def test_contract_failure_is_reused_until_explicit_retest(setup):
    scope, registry = setup
    def incorrect(parent, prompt):
        answer = invoke(parent, prompt)
        answer.content = '{"wrong":true}'
        return answer
    report = service.run(request(tasks=['translate']), scope, registry, incorrect)
    assert all(not case.passed for case in report.cases)
    assert len(service.plan(request(tasks=['translate']), scope, registry).reused_cases) == 2
    assert service.plan(request(tasks=['translate'], retest=True), scope, registry).reused_cases == []


def test_concurrent_same_route_cannot_launch_duplicate_paid_checks(setup):
    scope, registry = setup
    def nested(parent, prompt):
        with pytest.raises(ValueError, match='already_running'):
            service.run(request(), scope, registry, lambda *_: pytest.fail('duplicate'))
        return invoke(parent, prompt)
    assert service.run(request(), scope, registry, nested).status == 'completed'


def test_truncated_reasoning_sample_is_inconclusive_not_a_quality_failure(setup):
    scope, registry = setup
    def truncated(parent, prompt):
        answer = invoke(parent, prompt)
        answer.content = ''
        answer.response_metadata = {'finish_reason': 'length'}
        return answer
    report = service.run(request(), scope, registry, truncated)
    assert report.status == 'stopped' and report.stop_reason == 'output_limit'
    assert report.model_calls == 1 and report.cases[0].failure == 'output_limit'
    assert service.plan(request(), scope, registry).reused_cases == []
