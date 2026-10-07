"""Protect money at the SDK boundary, including retries and durable reservations."""
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from types import SimpleNamespace
import uuid

import httpx
from langchain_openai import ChatOpenAI
import pytest

from backend.services import ai_usage_ledger as ledger, reading_budget as budget
from backend.services.ai_usage_transport import instrument


@pytest.mark.parametrize('asynchronous', [False, True])
def test_truncated_structured_response_records_reasoning_cost_and_settles_reservation(asynchronous):
    import asyncio
    from openai import LengthFinishReasonError
    from backend.domains.agent.structured_output import constrain_output
    requests = []
    def respond(request):
        requests.append(request)
        return httpx.Response(200, json={
            'id': 'gen-truncated', 'model': 'test', 'object': 'chat.completion', 'created': 1,
            'choices': [{'index': 0, 'finish_reason': 'length',
                         'message': {'role': 'assistant', 'content': ''}}],
            'usage': {'prompt_tokens': 14441, 'completion_tokens': 16384, 'total_tokens': 30825,
                      'completion_tokens_details': {'reasoning_tokens': 16384}, 'cost': .01035815},
        })
    async def invoke_async(model):
        await model.ainvoke('source')
    identifier = budget.configure(.1)
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        model = instrument(ChatOpenAI(model='test', api_key='fake', base_url='https://test.invalid',
            max_tokens=16384, http_client=client,
            http_async_client=httpx.AsyncClient(transport=httpx.MockTransport(respond))), 'openrouter', 'test')
        model = constrain_output(model, 'openrouter', {'type': 'object', 'properties': {
            'notes': {'type': 'string'}}, 'required': ['notes'], 'additionalProperties': False})
        with budget.session(identifier), pytest.raises(LengthFinishReasonError):
            asyncio.run(invoke_async(model)) if asynchronous else model.invoke('source')
    assert len(requests) == 1  # Never charge a hidden retry for a truncated response.
    with ledger.connect() as db:
        rows = [dict(row) for row in db.execute('select * from usage_calls')]
    assert len(rows) == 1
    assert rows[0]['status'] == 'failed'
    assert rows[0]['input_tokens'] == 14441 and rows[0]['reasoning_tokens'] == 16384
    assert rows[0]['cost_usd'] == '0.01035815' and rows[0]['cost_source'] == 'reported'
    assert budget.status(identifier)['reserved_usd'] == 0
    assert budget.status(identifier)['spent_usd'] == .01035815


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    from backend.config import app_config
    from backend.agent import model_catalog, model_router
    monkeypatch.setenv('GNOSI_DATA_DIR', str(tmp_path))
    monkeypatch.setattr(app_config, 'load_params', lambda **kwargs: SimpleNamespace(paths={}, get=lambda *args: None))
    monkeypatch.setattr(ledger, 'context_metadata', lambda: dict(agent_id='test', agent_name='', operation='', origin='', run_id='', workspace_id='', user_id='', profile=''))
    monkeypatch.setattr(model_catalog, 'catalog_model_cost', lambda *args: {'cost_in': 1, 'cost_out': 1})
    monkeypatch.setattr(model_router, 'load_registry', lambda **kwargs: [])


def test_concurrent_reservation_and_resume_cannot_reset_limit():
    identifier = budget.configure(.03)
    def call(number):
        with budget.session(identifier):
            try:
                budget.reserve(str(number), 'passage', {'max_tokens': 16384}, {'cost_in': 1, 'cost_out': 1}, 'openrouter')
                return True
            except budget.ReadingBudgetError:
                return False
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(call, range(8)))
    assert sum(results) == 1
    before = budget.status(identifier)
    assert budget.configure(.03, identifier) == identifier
    assert budget.status(identifier) == before
    assert not call(9)
    with pytest.raises(budget.ReadingBudgetError):
        budget.configure(.001, identifier)


def test_estimates_keep_reservation_until_real_cost_arrives():
    identifier = budget.configure(.03)
    with budget.session(identifier):
        budget.reserve('call', 'passage', {'max_tokens': 16384}, {'cost_in': 1, 'cost_out': 1}, 'openrouter')
    ledger.write_call(call_id='call', provider='openrouter', model_id='m', input_tokens=10, output_tokens=2,
                      cost_usd='.000012', cost_source='estimated', generation_id='gen-test')
    assert budget.status(identifier)['reserved_usd'] > 0
    assert not ledger.reconcile_cost('call', 'gen-wrong', '.001')
    assert ledger.reconcile_cost('call', 'gen-test', '.001')
    assert budget.status(identifier)['spent_usd'] == .001
    assert budget.status(identifier)['reserved_usd'] == 0


def test_blocked_sdk_request_never_reaches_transport():
    calls = []
    model = instrument(ChatOpenAI(model='test', api_key='fake', base_url='https://test.invalid', max_tokens=16384,
                      http_client=httpx.Client(transport=httpx.MockTransport(lambda request: calls.append(request)))), 'openrouter', 'test')
    with budget.session(budget.configure(.001)), pytest.raises(budget.ReadingBudgetError):
        model.invoke('original source')
    assert not calls


def test_sdk_hidden_retries_disabled_and_failed_request_retains_reservation():
    calls = []
    def response(request):
        calls.append(request)
        return httpx.Response(503, json={'error': {'message': 'unavailable'}})
    # Construct outside the session too: a pre-existing client cannot bypass it.
    model = instrument(ChatOpenAI(model='test', api_key='fake', base_url='https://test.invalid', max_tokens=16384,
                      http_client=httpx.Client(transport=httpx.MockTransport(response))), 'openrouter', 'test')
    identifier = budget.configure(.03)
    with budget.session(identifier), pytest.raises(Exception):
        model.invoke('original source')
    assert len(calls) == 1
    assert budget.status(identifier)['reserved_usd'] > 0
    with budget.session(identifier), pytest.raises(budget.ReadingBudgetError):
        model.invoke('retry')
    assert len(calls) == 1


@pytest.mark.parametrize('limit,recovers', [(.03, False), (.10, True)])
@pytest.mark.parametrize('asynchronous', [False, True])
def test_connection_recovery_reserves_each_attempt_and_preserves_unknown_cost(monkeypatch, limit, recovers, asynchronous):
    import asyncio
    from backend.domains.llm_wiki import recovery

    waits, calls = [], []
    monkeypatch.setattr(recovery, 'time', SimpleNamespace(monotonic=lambda: 0, sleep=waits.append))
    monkeypatch.setattr(recovery, 'random', SimpleNamespace(uniform=lambda *_args: 0))
    def response(request):
        calls.append(request)
        if len(calls) == 1:
            raise httpx.ReadError('connection lost while receiving the response', request=request)
        return httpx.Response(200, json={'id': 'gen-offline-retry', 'object': 'chat.completion', 'created': 1, 'model': 'test',
            'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': 'saved notes'}, 'finish_reason': 'stop'}],
            'usage': {'prompt_tokens': 10, 'completion_tokens': 3, 'total_tokens': 13, 'cost': .001}})
    identifier = budget.configure(limit)
    async def invoke_async():
        async with httpx.AsyncClient(transport=httpx.MockTransport(response)) as client:
            model = instrument(ChatOpenAI(model='test', api_key='fake', base_url='https://test.invalid',
                max_tokens=16384, http_async_client=client), 'openrouter', 'test')
            return await model.ainvoke('source')
    with httpx.Client(transport=httpx.MockTransport(response)) as client:
        model = instrument(ChatOpenAI(model='test', api_key='fake', base_url='https://test.invalid',
            max_tokens=16384, http_client=client), 'openrouter', 'test')
        def run():
            return recovery.call_with_retry(lambda _timeout: asyncio.run(invoke_async()) if asynchronous else model.invoke('source'),
                on_wait=lambda: None, on_attempt=lambda: None)
        with budget.session(identifier):
            if recovers:
                assert run().content == 'saved notes'
            else:
                with pytest.raises(budget.ReadingBudgetError, match='reading_budget_pending_cost'):
                    run()
    assert waits == [5]
    assert len(calls) == (2 if recovers else 1)
    status = budget.status(identifier)
    assert status['limit_usd'] == limit
    assert status['reserved_usd'] > 0
    assert status['spent_usd'] == (.001 if recovers else 0)


def test_unknown_tariff_or_unbounded_output_fails_closed():
    with budget.session(budget.configure(.50)):
        for parameters, rates in [({}, {'cost_in': 1, 'cost_out': 1}), ({'max_tokens': 1}, None),
                                  ({'max_tokens': 1}, {'cost_in': 'NaN', 'cost_out': 0})]:
            with pytest.raises(budget.ReadingBudgetError):
                budget.reserve(uuid.uuid4().hex, 'source', parameters, rates, 'openrouter')


def test_inline_reported_cost_releases_only_its_reservation():
    identifier = budget.configure(.10)
    with budget.session(identifier):
        budget.reserve('one', 'source', {'max_tokens': 16384}, {'cost_in': 1, 'cost_out': 1}, 'openrouter')
        budget.reserve('two', 'source', {'max_tokens': 16384}, {'cost_in': 1, 'cost_out': 1}, 'openrouter')
    ledger.write_call(call_id='one', provider='openrouter', model_id='m', input_tokens=10, output_tokens=2,
                      cost_usd='.001', cost_source='reported')
    result = budget.status(identifier)
    assert Decimal(str(result['spent_usd'])) == Decimal('.001')
    assert result['reserved_usd'] > 0


def test_successful_sdk_request_stores_real_cost_and_releases_hold():
    def response(request):
        return httpx.Response(200, json={'id':'gen-offline', 'object':'chat.completion', 'created':1, 'model':'test',
            'choices':[{'index':0, 'message':{'role':'assistant','content':'validated notes'}, 'finish_reason':'stop'}],
            'usage':{'prompt_tokens':10, 'completion_tokens':3, 'total_tokens':13, 'cost':.001}})
    identifier = budget.configure(.50)
    with budget.session(identifier):
        model = instrument(ChatOpenAI(model='test', api_key='fake', base_url='https://test.invalid', max_tokens=16384,
                          http_client=httpx.Client(transport=httpx.MockTransport(response))), 'openrouter', 'test')
        model.invoke('original source')
    result = budget.status(identifier)
    assert result['spent_usd'] == .001 and result['reserved_usd'] == 0
    with ledger.connect() as db:
        row = db.execute('SELECT cost_source,cost_usd FROM usage_calls').fetchone()
        assert row['cost_source'] == 'reported' and Decimal(row['cost_usd']) == Decimal('.001')
