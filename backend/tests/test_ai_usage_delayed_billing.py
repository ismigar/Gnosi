"""Delayed provider billing must release only provider-confirmed reservations."""
from __future__ import annotations

import heapq
import io
import json
import urllib.error

import pytest

from backend.services import ai_usage_ledger as ledger, ai_usage_openrouter as billing, reading_budget


@pytest.fixture
def pending(tmp_path, monkeypatch):
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(ledger, "context_metadata", lambda: {
        "agent_id": "test", "agent_name": "", "operation": "reading", "origin": "test",
        "profile": "", "run_id": "", "workspace_id": "test", "user_id": "test"})
    monkeypatch.setattr(billing, "_pending", [])
    monkeypatch.setattr(billing, "_active_calls", set())
    monkeypatch.setattr(billing, "_workers_started", True)
    identifier = reading_budget.configure(1)
    with reading_budget.session(identifier):
        reading_budget.reserve("paid", [], {"max_tokens": 100}, {"cost_in": 1, "cost_out": 1}, "openrouter")
    ledger.write_call(provider="openrouter", model_id="test", call_id="paid", generation_id="gen-paid",
                      input_tokens=10, output_tokens=2, cost_usd="0.001", cost_source="estimated")
    return identifier


def test_delayed_generation_metadata_settles_without_repeating_model(pending, monkeypatch):
    requests = []
    def respond(request, **kwargs):
        requests.append(request)
        if len(requests) < 3:
            raise urllib.error.HTTPError(request.full_url, 404, "not ready", {}, None)
        return io.StringIO(json.dumps({"data": {"id": "gen-paid", "total_cost": .0007, "is_byok": False}}))
    monkeypatch.setattr(billing.urllib.request, "urlopen", respond)
    billing.schedule("paid", "gen-paid", "secret")
    for attempt in range(3):
        _, _, call_id, generation, key, retry = heapq.heappop(billing._pending)
        assert retry == attempt
        billing._attempt(call_id, generation, key, retry)
        if attempt < 2:
            assert reading_budget.status(pending)["reserved_usd"] > 0
    assert not billing._pending and not billing._active_calls
    assert reading_budget.status(pending)["reserved_usd"] == 0
    assert reading_budget.status(pending)["spent_usd"] == .0007
    assert all(request.get_method() == "GET" for request in requests)
    with ledger.connect() as db:
        assert db.execute("SELECT count(*) FROM usage_calls").fetchone()[0] == 1
        assert db.execute("SELECT cost_source FROM usage_calls").fetchone()[0] == "reported"


def test_unavailable_cost_is_bounded_and_never_treated_as_free(pending, monkeypatch):
    requests = []
    def unavailable(request, **kwargs):
        requests.append(request)
        raise urllib.error.HTTPError(request.full_url, 404, "not ready", {}, None)
    monkeypatch.setattr(billing.urllib.request, "urlopen", unavailable)
    billing.schedule("paid", "gen-paid", "secret")
    while billing._pending:
        _, _, call_id, generation, key, retry = heapq.heappop(billing._pending)
        billing._attempt(call_id, generation, key, retry)
    assert len(requests) == len(billing._RETRY_DELAYS) + 1
    assert not billing._active_calls
    assert reading_budget.status(pending)["reserved_usd"] > 0
    assert reading_budget.status(pending)["spent_usd"] == 0


def test_byok_budget_includes_upstream_usage_while_wallet_cost_stays_separate(pending, monkeypatch):
    monkeypatch.setattr(billing.urllib.request, 'urlopen', lambda *_args, **_kwargs: io.StringIO(json.dumps(
        {'data': {'id': 'gen-paid', 'total_cost': 0, 'is_byok': True, 'upstream_inference_cost': .02}})))
    assert billing.reconcile('paid', 'gen-paid', 'secret')
    assert reading_budget.status(pending)['spent_usd'] == .02
    assert reading_budget.status(pending)['reserved_usd'] == 0
    with ledger.connect() as db:
        assert db.execute("SELECT cost_usd FROM usage_calls WHERE id='paid'").fetchone()[0] == '0'
    assert billing.reconcile('paid', 'gen-paid', 'secret')
    assert reading_budget.status(pending)['spent_usd'] == .02


def test_byok_consumption_and_router_fee_both_count_towards_next_request(pending, monkeypatch):
    monkeypatch.setattr(billing.urllib.request, 'urlopen', lambda *_args, **_kwargs: io.StringIO(json.dumps(
        {'data': {'id': 'gen-paid', 'total_cost': .01, 'is_byok': True, 'upstream_inference_cost': .989}})))
    assert billing.reconcile('paid', 'gen-paid', 'secret')
    assert reading_budget.status(pending)['spent_usd'] == .999
    with ledger.connect() as db:
        assert db.execute("SELECT cost_usd FROM usage_calls WHERE id='paid'").fetchone()[0] == '0.01'
    with reading_budget.session(pending), pytest.raises(reading_budget.ReadingBudgetError):
        reading_budget.reserve('next', [], {'max_tokens': 100}, {'cost_in': 1, 'cost_out': 1}, 'openrouter')


def test_combined_cost_requires_exact_call_generation_binding(pending):
    assert not ledger.reconcile_budget_cost('paid', 'gen-other', '.02')
    assert not ledger.reconcile_budget_cost('other', 'gen-paid', '.02')
    assert not ledger.reconcile_budget_cost('paid', 'gen-paid', '-1')
    assert reading_budget.status(pending)['spent_usd'] == 0
    assert reading_budget.status(pending)['reserved_usd'] > 0


@pytest.mark.parametrize('data', [
    {'total_cost': 0, 'is_byok': True},
    {'total_cost': .001},
    {'total_cost': 0, 'is_byok': True, 'upstream_inference_cost': -1},
])
def test_incomplete_byok_funding_never_releases_the_reservation(pending, monkeypatch, data):
    monkeypatch.setattr(billing.urllib.request, 'urlopen', lambda *_args, **_kwargs: io.StringIO(json.dumps(
        {'data': {'id': 'gen-paid', **data}})))
    assert not billing.reconcile('paid', 'gen-paid', 'secret')
    assert reading_budget.status(pending)['spent_usd'] == 0
    assert reading_budget.status(pending)['reserved_usd'] > 0
    with ledger.connect() as db:
        row = db.execute("SELECT cost_usd,cost_source FROM usage_calls WHERE id='paid'").fetchone()
        assert row['cost_usd'] == str(data['total_cost'])
        assert row['cost_source'] == 'reported'


def test_wallet_reconciles_unknown_funding_without_a_reading_budget(pending, monkeypatch):
    ledger.write_call(provider='openrouter', model_id='test', call_id='chat', generation_id='gen-chat',
                      input_tokens=10, output_tokens=2, cost_usd='.001', cost_source='estimated')
    monkeypatch.setattr(billing.urllib.request, 'urlopen', lambda *_args, **_kwargs: io.StringIO(json.dumps(
        {'data': {'id': 'gen-chat', 'total_cost': .007}})))
    assert not billing.reconcile('chat', 'gen-chat', 'secret')
    with ledger.connect() as db:
        row = db.execute("SELECT cost_usd,cost_source FROM usage_calls WHERE id='chat'").fetchone()
        assert row['cost_usd'] == '0.007' and row['cost_source'] == 'reported'


def test_zero_wallet_response_keeps_reading_cap_reserved_until_funding_is_known(pending, monkeypatch):
    from langchain_core.messages import AIMessage
    from langchain_core.outputs import ChatGeneration, LLMResult
    from backend.agent import model_catalog, model_router
    from backend.services.ai_usage_transport import UsageCallback

    monkeypatch.setattr(model_catalog, 'catalog_model_cost', lambda *_: {'cost_in': 1, 'cost_out': 1})
    monkeypatch.setattr(model_router, 'load_registry', lambda **_: [])
    scheduled = []
    monkeypatch.setattr(billing, 'schedule', lambda *args: scheduled.append(args))
    callback = UsageCallback('openrouter', 'test', 'secret')
    with reading_budget.session(pending):
        callback.on_chat_model_start({}, [], run_id='inline-paid', invocation_params={'max_tokens': 100})
        callback.on_llm_end(LLMResult(generations=[[ChatGeneration(message=AIMessage(content='Verified.',
            response_metadata={'id': 'gen-inline-paid'}))]],
            llm_output={'token_usage': {'prompt_tokens': 10, 'completion_tokens': 2, 'cost': 0}}), run_id='inline-paid')
    with ledger.connect() as db:
        assert db.execute("SELECT reported_usd FROM reading_reservations WHERE call_id='inline-paid'").fetchone()[0] is None
    assert scheduled == [('inline-paid', 'gen-inline-paid', 'secret')]


def test_waiting_metadata_does_not_block_new_lookups_or_duplicate_reservations(pending, monkeypatch):
    monkeypatch.setattr(billing, "reconcile", lambda *args: False)
    monkeypatch.setattr(billing.time, "monotonic", lambda: 100)
    billing.schedule("paid", "gen-paid", "secret")
    _, _, call_id, generation, key, retry = heapq.heappop(billing._pending)
    billing._attempt(call_id, generation, key, retry)
    billing.schedule("paid", "gen-paid", "secret")
    billing.schedule("new", "gen-new", "secret")
    assert len(billing._pending) == 2
    assert heapq.heappop(billing._pending)[2] == "new"
    assert heapq.heappop(billing._pending)[0] > 100
