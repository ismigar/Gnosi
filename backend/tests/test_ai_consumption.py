from __future__ import annotations
import csv
import io
import json
from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
from langchain_core.messages import AIMessage
from langchain_core.outputs import LLMResult, ChatGeneration
from langchain_openai import ChatOpenAI
from backend.services import ai_usage_ledger as ledger, ai_usage_dashboard as dashboard
from backend.services.ai_usage_transport import instrument, price, normalize, UsageCallback

META = {'agent_id': 'a', 'agent_name': 'Agent A', 'operation': 'writing', 'origin': 'chat', 'run_id': '', 'workspace_id': 'w', 'user_id': 'u', 'profile': 'expert'}
SCOPE = SimpleNamespace(workspace_id='w', user_id='u', role='owner')

@pytest.fixture
def runtime(tmp_path, monkeypatch):
    from backend.config import app_config
    from backend.agent import model_catalog, model_router
    monkeypatch.setenv('GNOSI_DATA_DIR', str(tmp_path))
    config = SimpleNamespace(paths={'LOCAL_CACHE': tmp_path/'cache'}, gnosi_mode='personal', get=lambda key, default=None: default)
    monkeypatch.setattr(app_config, 'load_params', lambda **kwargs: config)
    monkeypatch.setattr(ledger, 'context_metadata', lambda: dict(META))
    monkeypatch.setattr(model_catalog, 'catalog_model_cost', lambda *args: None)
    monkeypatch.setattr(model_router, 'load_registry', lambda **kwargs: [])
    monkeypatch.setattr(dashboard, 'currency_context', lambda: {'code':'EUR','symbol':'€','usd_rate':0.9,'source':'test','fetched_at':'2026-10-02'})
    monkeypatch.setattr(model_router, 'budget_status', lambda: {'spent_usd':sum(float(v['cost_usd']) for b in ledger.monthly().values() for v in b.values())})
    return tmp_path


def add(provider='p1', model='same', agent='a', cost='1', source='reported', **kwargs):
    ledger.write_call(provider=provider, model_id=model, input_tokens=100, output_tokens=20, cost_usd=cost,
        cost_source=source, created=datetime(2026,10,2,12,tzinfo=timezone.utc).timestamp(), metadata={**META,'agent_id':agent}, **kwargs)


def query(**kwargs):
    return dashboard.UsageQuery(date(2026,10,1),date(2026,10,3),'Europe/Madrid',**kwargs)


def test_multiple_providers_same_model_and_agent(runtime):
    add(cost='0.12345678901');add(provider='p2',cost='2')
    data=dashboard.dashboard(query(),SCOPE)
    assert {g['key'] for g in data['groups']} == {'p1:same','p2:same'}
    assert data['summary']['cost_usd'] == 2.12345678901
    assert data['summary']['cost_ccy'] == pytest.approx(2.12345678901*.9)
    assert len(dashboard.dashboard(query(group_by='agent'),SCOPE)['groups']) == 1
    assert dashboard.dashboard(query(provider='p2'),SCOPE)['summary']['cost_usd'] == 2
    assert dashboard.dashboard(query(model='p1:same'),SCOPE)['summary']['calls'] == 1


def test_ledger_budget_and_csv_match(runtime):
    add();add(provider='p2',cost='3');data=dashboard.dashboard(query(),SCOPE)
    assert data['budget']['spent_usd'] == data['summary']['cost_usd'] == 4
    filtered=dashboard.dashboard(query(provider='p1'),SCOPE)
    assert filtered['budget_summary']['cost_usd'] == data['budget_summary']['cost_usd'] == 4
    rows=list(csv.DictReader(io.StringIO(dashboard.export_csv(query(),SCOPE).lstrip('\ufeff'))))
    assert sum(Decimal(r['cost_usd']) for r in rows) == 4
    assert sum(g['cost_ccy'] for g in data['groups']) == data['summary']['cost_ccy']
    assert sum(s['calls'] for s in data['series']) == data['summary']['calls']


def test_unknown_does_not_mean_free(runtime):
    add(cost=None,source='unknown')
    data=dashboard.dashboard(query(),SCOPE)
    assert data['summary']['cost_ccy'] is None
    assert data['summary']['unknown_cost_calls'] == 1
    assert price('remote','m',{'input_tokens':1,'output_tokens':1},{},None) == (None,'unknown')
    assert price('ollama','m',{}, {},None) == (Decimal(0),'local')


def test_reported_zero_and_snapshot_estimates(runtime):
    tokens={'input_tokens':1_000_000,'output_tokens':1_000_000}
    assert price('p','m',tokens,{'cost':0},{'cost_in':3,'cost_out':4}) == (Decimal(0),'reported')
    assert price('p','m',tokens,{}, {'cost_in':3,'cost_out':4}) == (Decimal(7),'estimated')
    assert normalize({'prompt_tokens':5,'completion_tokens':8,'prompt_tokens_details':{'cached_tokens':4},'completion_tokens_details':{'reasoning_tokens':6}}, {}) == {'input_tokens':5,'output_tokens':8,'cached_tokens':4,'reasoning_tokens':6}


def test_migration_only_once_preserves_original(runtime):
    cache=runtime/'cache';cache.mkdir();path=cache/'llm_usage.json'
    original=json.dumps({'2026-09':{'p:same':{'in':12,'out':3,'cost_usd':1.25}}});path.write_text(original)
    assert ledger.monthly()['2026-09']['p:same']['cost_usd'] == 1.25
    assert ledger.monthly()['2026-09']['p:same']['in'] == 12
    assert path.read_text() == (cache/'llm_usage.before-sqlite.json').read_text() == original
    monthly=dashboard.dashboard(dashboard.UsageQuery(date(2026,9,1),date(2026,9,30),'UTC'),SCOPE)
    assert monthly['summary']['calls'] == 0 and monthly['summary']['legacy_records'] == 1
    assert monthly['granularity'] == 'month' and len(monthly['series']) == 1
    partial=dashboard.dashboard(dashboard.UsageQuery(date(2026,9,20),date(2026,10,2),'UTC'),SCOPE)
    assert partial['legacy_excluded'] and partial['summary']['cost_usd'] == 0


def test_concurrency_idempotency_and_scope(runtime):
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda n:add(call_id=str(n)),range(20)))
    add(call_id='0')
    assert dashboard.requests(query(),SCOPE)['total'] == 20
    assert dashboard.requests(query(),SimpleNamespace(workspace_id='other',user_id='other',role='viewer'))['total'] == 0
    assert len(dashboard.requests(query(),SCOPE,2,7)['items']) == 7


def test_timezone_and_invalid_interval(runtime):
    add()
    assert dashboard.dashboard(query(),SCOPE)['series'][1]['date'] == '2026-10-02'
    with pytest.raises(Exception):dashboard.usage_query(timezone='invalid')
    with pytest.raises(Exception):dashboard.usage_query(start=date(2026,10,2),end=date(2026,10,1))


def test_sdk_cost_captured_before_transformation(runtime):
    def response(request):
        return httpx.Response(200,json={'id':'test','object':'chat.completion','created':1,'model':'actual',
            'choices':[{'index':0,'message':{'role':'assistant','content':'invalid output'},'finish_reason':'stop'}],
            'usage':{'prompt_tokens':10,'completion_tokens':2,'total_tokens':12,'cost':0.0042}})
    model=instrument(ChatOpenAI(model='same',api_key='test',base_url='https://test.invalid',http_client=httpx.Client(transport=httpx.MockTransport(response))), 'router','same')
    result=model.invoke('test')
    assert result.additional_kwargs['gnosi_usage_recorded']
    rows=dashboard.requests(query(),SCOPE)['items'] # Callback uses the actual current date.
    with ledger.connect() as db:rows=[dict(r) for r in db.execute('select * from usage_calls')]
    assert len(rows)==1 and rows[0]['provider']=='router' and rows[0]['model_id']=='actual'
    assert rows[0]['cost_usd']=='0.0042' and rows[0]['cost_source']=='reported'
    assert rows[0]['input_tokens']==10


def test_sdk_stream_cost_and_reasoning(runtime):
    chunks=[{'id':'test','model':'same','choices':[{'index':0,'delta':{'role':'assistant','content':'ok'},'finish_reason':None}]},
        {'id':'test','model':'same','choices':[],'usage':{'prompt_tokens':9,'completion_tokens':3,'total_tokens':12,'cost':0.000123,'completion_tokens_details':{'reasoning_tokens':2}}}]
    stream=''.join('data: '+json.dumps(c)+'\n\n' for c in chunks)+'data: [DONE]\n\n'
    def respond(req):
        assert json.loads(req.content)['stream_options']['include_usage'] is True
        return httpx.Response(200,text=stream,headers={'content-type':'text/event-stream'})
    model=instrument(ChatOpenAI(model='same',api_key='test',base_url='https://test.invalid',http_client=httpx.Client(transport=httpx.MockTransport(respond))), 'router','same')
    list(model.stream('test'))
    with ledger.connect() as db:rows=[dict(r) for r in db.execute('select * from usage_calls')]
    assert len(rows)==1 and rows[0]['cost_usd']=='0.000123' and rows[0]['reasoning_tokens']==2


def test_responses_api_preserves_reported_cost(runtime):
    payload={'id':'resp_test','object':'response','created_at':1,'status':'completed','model':'actual',
        'output':[{'id':'msg_test','type':'message','role':'assistant','status':'completed','content':[{'type':'output_text','text':'ok','annotations':[]}]}],
        'usage':{'input_tokens':10,'output_tokens':2,'total_tokens':12,'input_tokens_details':{'cached_tokens':5},'output_tokens_details':{'reasoning_tokens':1},'cost':0.000045}}
    model=instrument(ChatOpenAI(model='same',api_key='test',base_url='https://test.invalid',use_responses_api=True,http_client=httpx.Client(transport=httpx.MockTransport(lambda req:httpx.Response(200,json=payload)))), 'router','same')
    model.invoke('test')
    with ledger.connect() as db:rows=[dict(r) for r in db.execute('select * from usage_calls')]
    assert len(rows)==1 and Decimal(rows[0]['cost_usd'])==Decimal('0.000045') and rows[0]['cached_tokens']==5


def test_async_concurrent_calls_keep_attribution(runtime):
    import asyncio
    async def run():
        clients=[]
        for provider,cost in [('p1',.1),('p2',.2)]:
            def respond(req, amount=cost):
                return httpx.Response(200,json={'id':'test','object':'chat.completion','created':1,'model':'same','choices':[{'index':0,'message':{'role':'assistant','content':'ok'},'finish_reason':'stop'}],'usage':{'prompt_tokens':10,'completion_tokens':2,'total_tokens':12,'cost':amount}})
            clients.append(instrument(ChatOpenAI(model='same',api_key='test',base_url='https://test.invalid',http_async_client=httpx.AsyncClient(transport=httpx.MockTransport(respond))),provider,'same'))
        await asyncio.gather(*(client.ainvoke('test') for client in clients))
    asyncio.run(run())
    with ledger.connect() as db:rows=[dict(r) for r in db.execute('select * from usage_calls')]
    assert {(r['provider'],r['cost_usd']) for r in rows}=={('p1','0.1'),('p2','0.2')}


def test_failed_provider_is_recorded_without_fabricating_cost(runtime):
    model=instrument(ChatOpenAI(model='same',api_key='test',base_url='https://test.invalid',max_retries=0,http_client=httpx.Client(transport=httpx.MockTransport(lambda req:httpx.Response(503,json={'error':{'message':'unavailable'}})))), 'remote','same')
    with pytest.raises(Exception):model.invoke('test')
    with ledger.connect() as db:row=dict(db.execute('select * from usage_calls').fetchone())
    assert row['status']=='failed' and row['cost_usd'] is None and row['input_tokens'] is None


def test_tariff_and_attribution_frozen_before_config_change(runtime, monkeypatch):
    from backend.agent import model_router
    monkeypatch.setattr(model_router, 'load_registry', lambda **kwargs: [{'provider':'p1','model_id':'same','cost_in':3,'cost_out':4,'profile':'fast'}])
    callback=UsageCallback('p1','same')
    callback.on_chat_model_start({},[],run_id='snapshot')
    monkeypatch.setattr(model_router, 'load_registry', lambda **kwargs: [{'provider':'p2','model_id':'same','cost_in':90,'cost_out':99,'profile':'deep'}])
    monkeypatch.setattr(ledger, 'context_metadata', lambda: {**META,'agent_id':'changed'})
    callback.on_llm_end(LLMResult(generations=[[ChatGeneration(message=AIMessage(content='ok',usage_metadata={'input_tokens':1000000,'output_tokens':1000000,'total_tokens':2000000}))]]),run_id='snapshot')
    with ledger.connect() as db:row=dict(db.execute('select * from usage_calls').fetchone())
    assert row['provider']=='p1' and row['profile']=='fast' and row['agent_id']==META['agent_id']
    assert row['cost_usd']=='7' and row['cost_source']=='estimated'


def test_cancelled_call_records_unknown_once(runtime):
    import asyncio
    callback=UsageCallback('p1','same');callback.on_chat_model_start({},[],run_id='cancel')
    callback.on_llm_error(asyncio.CancelledError(),run_id='cancel')
    callback.on_llm_error(asyncio.CancelledError(),run_id='cancel')
    with ledger.connect() as db:rows=[dict(row) for row in db.execute('select * from usage_calls')]
    assert len(rows)==1 and rows[0]['status']=='cancelled' and rows[0]['cost_usd'] is None
