"""Offline community-bank consensus, isolation, export and transport contracts."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from types import SimpleNamespace
import pytest
from backend.services import shared_task_evaluations as shared
from backend.services import agent_task_evaluations as evaluations
from backend.services import agent_execution_store as runs, ai_usage_ledger as ledger
from backend.services.agent_execution_models import ExecutionScope
from backend.services.agent_task_evaluation_models import TaskEvaluationRequest, TaskEvaluationReport, TaskCaseResult
from backend.services.public_evaluation_contract import digest, validate_submission


def record(contributor='alice', verdict='', case_id='mail_batch', delta=0):
    criterion = next(c for c in shared.WORK_CASES if c.id == case_id)
    data = dict(criterion.expected)
    if criterion.requires_review:
        data['analysis' if case_id == 'decision_review' else 'summary'] = 'Text públic revisable.'
    output = json.dumps(data, ensure_ascii=False)
    if verdict == 'contract_mismatch':
        output = '{}'
    now = (datetime.now(timezone.utc) - timedelta(seconds=10 + delta)).isoformat()
    evaluation = {'schema': 1, 'provider': 'openrouter', 'model': 'test/model', 'version': shared.suite_version('work'),
        'mode': shared.suite_mode('work'), 'parameters': shared.public_parameters('openrouter', 'test/model'),
        'created_at': now, 'cases': [{'id': case_id, 'output': output, 'failure': verdict, 'checked_at': now,
            'latency_ms': 100, 'cost_usd': .001, 'cost_source': 'reported',
            'review': 'accepted' if criterion.requires_review else 'not_required',
            'reviewed_at': now if criterion.requires_review else ''}]}
    evaluation['id'] = digest(evaluation)
    return {'evaluation': evaluation, 'attestation': {'contributor': contributor,
        'review_url': 'https://github.com/ismigar/ismigar.github.io/pull/1',
        'approved_cases': [case_id] if criterion.requires_review else []}}


def bank(*records):
    return {'schema': 1, 'suite': shared.public_suite(), 'records': list(records)}


def test_two_independent_reviewed_contributions_are_required_and_duplicates_do_not_help():
    first = record()
    assert shared.aggregate(shared.validate_bank(bank(first)), 'ready', '').reports == []
    second_same_person = record(delta=1)
    assert shared.aggregate(shared.validate_bank(bank(first, second_same_person)), 'ready', '').reports == []
    second = record('bob', delta=1)
    result = shared.aggregate(shared.validate_bank(bank(first, second)), 'ready', '')
    assert result.reports[0].cases[0].contributors == 2
    assert result.reports[0].cases[0].evidence_origin == 'shared'
    assert result.summaries[0].observations == 2
    assert result.summaries[0].median_cost_usd == .001


def test_disagreement_or_transport_error_prevents_reuse_without_quality_rejection():
    for verdict in ('contract_mismatch', 'provider_error', 'output_limit'):
        raw = bank(record(), record('bob', verdict, delta=1))
        result = shared.aggregate(shared.validate_bank(raw), 'ready', '')
        assert result.reports == []
        assert result.summaries[0].inconclusive == int(verdict != 'contract_mismatch')
    raw = bank(record(), record('bob', delta=1), record('alice', 'contract_mismatch', delta=-1))
    assert shared.aggregate(shared.validate_bank(raw), 'ready', '').reports == []


def test_open_work_needs_maintainer_review_not_just_an_exported_self_review():
    raw = bank(record(case_id='decision_review'), record('bob', case_id='decision_review', delta=1))
    assert shared.aggregate(shared.validate_bank(raw), 'ready', '').reports
    raw['records'][1]['attestation']['approved_cases'] = []
    assert shared.aggregate(shared.validate_bank(raw), 'ready', '').reports == []


@pytest.mark.parametrize('mutation', ['private_field', 'wrong_suite', 'wrong_protocol', 'false_pass', 'false_digest'])
def test_untrusted_bank_is_revalidated_locally(mutation):
    raw = bank(record())
    evaluation = raw['records'][0]['evaluation']
    if mutation == 'private_field':
        evaluation['agent_id'] = 'private'
    elif mutation == 'wrong_suite':
        raw['suite']['criteria'][0]['prompt'] = 'Injected instructions'
    elif mutation == 'wrong_protocol':
        evaluation['parameters']['reasoning'] = {'api_key': 'secret'}
    elif mutation == 'false_pass':
        evaluation['cases'][0]['output'] = '{}'
    else:
        evaluation['id'] = 'a' * 64
    with pytest.raises(ValueError):
        shared.validate_bank(raw)


def test_export_strips_scope_notes_and_old_reused_results():
    sample = record()['evaluation']
    criterion = shared.WORK_CASES[0]
    case = TaskCaseResult(id=criterion.id, metric=criterion.metric, tasks=list(criterion.tasks), passed=True,
        **{k: v for k, v in sample['cases'][0].items() if k != 'id'},
        task_prompt=criterion.prompt, expected=criterion.expected, review_note='private personal note')
    report = TaskEvaluationReport(id='private-run', agent_id='private-agent', provider='openrouter', model='test/model',
        version=shared.suite_version('work'), mode=shared.suite_mode('work'), created_at=sample['created_at'], tasks=['classify'],
        cases=[case], budget_usd=.05, public_parameters=sample['parameters'])
    result = shared.export_report(report)
    encoded = json.dumps(result)
    assert all(word not in encoded for word in ('private-run', 'private-agent', 'private personal note', 'task_prompt', 'review_note', 'reused_from'))
    validate_submission(result, shared.public_suite())
    with pytest.raises(ValueError):
        shared.export_report(report.model_copy(update={'public_parameters': None}))
    with pytest.raises(ValueError):
        shared.export_report(report.model_copy(update={'cases': [case.model_copy(update={'reused_from': 'other-run'})]}))
    assert shared.public_parameters('openrouter', 'test/model', 'https://private.example/api') is None


def test_cache_offline_and_reuse_skip_paid_calls_but_can_be_disabled(tmp_path, monkeypatch):
    monkeypatch.setattr(shared, 'resolve_data_dir', lambda **_: tmp_path)
    monkeypatch.setattr(runs, 'resolve_data_dir', lambda **_: tmp_path)
    monkeypatch.setattr(ledger, 'resolve_data_dir', lambda **_: tmp_path)
    path = tmp_path / 'public-model-evaluations.json'
    path.write_text(json.dumps(bank(record(), record('bob', delta=1))))
    monkeypatch.setattr(shared.httpx, 'Client', lambda **_: pytest.fail('Offline reads must not contact the server'))
    scope = ExecutionScope(user_id='user', workspace_id='space', vault_path=str(tmp_path), role='admin')
    req = TaskEvaluationRequest(agent_id='bot', provider='openrouter', model='test/model', tasks=['classify'],
        suite='work', authorize_model_calls=True)
    registry = [{'provider': 'openrouter', 'model_id': 'test/model', 'enabled': True, 'cost_in': 1, 'cost_out': 2, 'context_window': 64000}]
    parameters = shared.public_parameters(req.provider, req.model)
    plan = evaluations.plan(req, scope, registry, parameters)
    assert plan.pending_ids == [] and plan.maximum_cost_usd == 0
    report = evaluations.run(req, scope, registry, lambda *_: pytest.fail('Shared checks must not be paid again'), parameters)
    assert report.model_calls == 0 and report.reused_cases == 1 and report.cost_usd == 0
    assert evaluations.plan(req.model_copy(update={'use_shared': False}), scope, registry, parameters).pending_ids == ['mail_batch']
    assert evaluations.plan(req.model_copy(update={'retest': True}), scope, registry, parameters).pending_ids == ['mail_batch']
    path.write_text(json.dumps(bank()))  # Withdrawal invalidates copies saved in private run history.
    assert evaluations.plan(req, scope, registry, parameters).pending_ids == ['mail_batch']


def test_bounded_fetch_uses_no_credentials_and_keeps_validated_cache_on_failure(tmp_path, monkeypatch):
    import httpx
    monkeypatch.setattr(shared, 'resolve_data_dir', lambda **_: tmp_path)
    raw = bank(record(), record('bob', delta=1))
    real = httpx.Client
    requests = []
    def handler(request):
        requests.append(request)
        assert 'authorization' not in request.headers and 'cookie' not in request.headers and not request.url.query
        return httpx.Response(200, json=raw)
    monkeypatch.setattr(shared.httpx, 'Client', lambda **kwargs: real(transport=httpx.MockTransport(handler), **kwargs))
    assert shared.load_bank(refresh=True).reports
    assert len(requests) == 1 and (tmp_path / 'public-model-evaluations.json').exists()
    assert shared.load_bank().reports and len(requests) == 1
    shared._attempts.clear()
    monkeypatch.setattr(shared.httpx, 'Client', lambda **kwargs: real(transport=httpx.MockTransport(lambda _: httpx.Response(200, content=b'x' * (shared.MAX_BYTES + 1))), **kwargs))
    assert shared.load_bank(refresh=True, force=True).reports
    assert json.loads((tmp_path / 'public-model-evaluations.json').read_text()) == raw


def test_public_export_route_requires_own_scope_and_administrator(tmp_path, monkeypatch):
    from fastapi import HTTPException
    from backend.domains.agent.routes import task_evaluations as routes
    scope = ExecutionScope(user_id='other-user', workspace_id='space', vault_path=str(tmp_path), role='admin')
    monkeypatch.setattr(routes, 'current_scope', lambda: scope)
    monkeypatch.setattr(routes, 'revalidate_scope', lambda _: None)
    monkeypatch.setattr(runs, 'resolve_data_dir', lambda **_: tmp_path)
    with pytest.raises(HTTPException) as exc:
        routes.public_export('private-run')
    assert exc.value.status_code == 404
    scope = scope.model_copy(update={'role': 'member'})
    with pytest.raises(HTTPException) as exc:
        routes.public_export('private-run')
    assert exc.value.status_code == 403


def test_sdk_identity_is_available_in_frozen_bundles_without_wheel_metadata(monkeypatch):
    import importlib.metadata
    from langchain_openai import __version__
    def absent(_name):
        raise importlib.metadata.PackageNotFoundError
    monkeypatch.setattr(importlib.metadata, 'version', absent)
    assert shared.public_parameters('openrouter', 'test/model')['sdk_version'] == __version__
