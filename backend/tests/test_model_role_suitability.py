from backend.services.model_role_suitability import assess_roles, ROLE_WEIGHTS


def roles(model, peers=None):
    return {r['role']: r for r in assess_roles(model, peers)}


def test_unknown_is_not_free_or_a_failed_benchmark():
    result = roles({})
    assert all(r['score'] is None and r['status'] == 'insufficient_data' for r in result.values())
    assert 'token_cost' in result['worker']['missing']
    assert all(abs(sum(w.values()) - 1) < 1e-9 for w in ROLE_WEIGHTS.values())


def test_context_alone_does_not_certify_documental_work():
    result = roles({'context_window': 1_000_000})['documentalist']
    assert result['status'] == 'insufficient_data'
    assert 'citation_fidelity' in result['missing']


def test_economy_and_speed_distinguish_worker_from_expert():
    cheap = dict(intelligence=30, context_window=200000, speed=100, latency=.2, input_price=.1, output_price=.2, modes=['text'], tags=['tools'], agentic=20)
    costly = dict(cheap, intelligence=60, agentic=80, speed=5, latency=20, input_price=20, output_price=80)
    peers = [cheap, costly]
    a, b = roles(cheap, peers), roles(costly, peers)
    assert a['worker']['score'] > b['worker']['score']
    assert a['worker']['status'] == 'catalog_compatible'
    assert b['expert']['score'] > a['expert']['score']
    assert b['expert']['status'] == 'catalog_compatible'
    assert 'measured_task_cost' in a['worker']['missing']
    assert all(r['status'] != 'tested' for r in b.values())


def test_director_requires_tools_and_agentic_evidence():
    model = dict(intelligence=60, context_window=200000, tags=['tools'])
    assert roles(model)['director']['status'] == 'insufficient_data'
    assert roles(dict(model, supports_tools=False))['director']['status'] == 'limitation'


def test_ties_and_bad_metrics_remain_honest():
    model = dict(intelligence=40, context_window=200000, speed=float('nan'), latency=-1, input_price=0, output_price=0, modes=['text'])
    a, b = roles(model), roles(model, [model, model])
    assert a['expert']['score'] == b['expert']['score']
    assert 'speed' in a['worker']['missing'] and 'latency' in a['worker']['missing']
    assert next(p for p in a['worker']['proofs'] if p['metric'] == 'token_cost')['value'] == 0
