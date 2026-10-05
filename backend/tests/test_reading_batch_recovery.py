"""Output exhaustion adapts delivery, preserving originals, memory and saved plans."""
from copy import deepcopy
import json

import pytest
from openai import LengthFinishReasonError
from openai.types.chat import ChatCompletion

from backend.domains.llm_wiki.directed_reading import run_directed
from backend.domains.llm_wiki.contextual_reading import fingerprint
from backend.domains.llm_wiki.reading_batch_recovery import reduce_batch
from backend.tests.test_reading_batches import fixture, plan


def exhausted(reasoning=4096):
    completion = ChatCompletion(id='offline', created=0, model='offline', object='chat.completion', choices=[],
        usage={'completion_tokens': 16384, 'prompt_tokens': 15122, 'total_tokens': 31506,
               'completion_tokens_details': {'reasoning_tokens': reasoning}})
    return LengthFinishReasonError(completion=completion)


def answer(request):
    result = request['last_result']
    if request['saved_plan_count'] == request['source_count']:
        return json.dumps({'action': 'finish', 'arguments': {'summary': 'All originals reviewed'}}), 'offline'
    sources = result.get('sources', [result])
    return json.dumps({'action': 'save_batch', 'arguments': {
        'plans': [{'chunk_id': chunk['id'], 'plan': plan(chunk)} for chunk in sources],
        'memory_updates': [{'old': '', 'new': 'New interpretation linked to previous arguments.'}]}}), 'offline'


def test_overflow_halves_delivery_twice_without_repeating_saved_chunks():
    reader, chunks, checkpoints = fixture(12)
    calls = []
    def generate(prompt, **_):
        request = json.loads(prompt)
        sources = request['last_result'].get('sources', [request['last_result']])
        calls.append([chunk.get('id') for chunk in sources])
        if request['saved_plan_count'] == 4 and len(sources) > 1:
            raise exhausted()
        return answer(request)
    reader.dependencies.generate_text = generate
    report, _ = run_directed(reader)
    assert calls[:4] == [list(chunks)[:4], list(chunks)[4:8], list(chunks)[4:6], [list(chunks)[4]]]
    saved = checkpoints['new', 'agent-state']
    assert len(saved['plans']) == len(report['notes']) == 12
    assert saved['batch_size_limit'] == 1
    assert all(note['citations'][0]['quote'] == note['body_md'] for note in report['notes'])
    assert saved['memory'].count('New interpretation') == 9  # one successful batch + eight singles


@pytest.mark.parametrize('prior_failure,requested', [(True, 4), (False, 2)])
def test_resume_redispatches_saved_pending_batch_and_retains_global_memory(prior_failure, requested):
    reader, chunks, checkpoints = fixture(8)
    keys = list(chunks)
    original = {key: {**plan(chunks[key]), 'memory': 'Original global argument'} for key in keys[:4]}
    saved = {'identity': fingerprint([reader.dependencies.execution_revision, reader.chunks, [], []]),
             'step': 1, 'read': keys, 'plans': original, 'memory': 'Original global argument',
             'last_result': {'sources': list(chunks.values())[4:], 'delivery': 'batch'},
             'last_action': {'name': 'read', 'delivery': 'automatic'}, 'delivered': keys[4:]}
    checkpoints['old', 'agent-state'] = deepcopy(saved)
    reader.resume_job_id = 'old'
    reader.dependencies.batch_size = requested
    reader.dependencies.resume_job_status = lambda _: {'error': str(exhausted()) if prior_failure else ''}
    calls = []
    def generate(prompt, **_):
        request = json.loads(prompt); calls.append(request)
        return answer(request)
    reader.dependencies.generate_text = generate
    run_directed(reader)
    assert [c['id'] for c in calls[0]['last_result']['sources']] == keys[4:6]
    assert checkpoints['old', 'agent-state'] == saved
    current = checkpoints['new', 'agent-state']
    assert {key: current['plans'][key] for key in original} == original
    assert current['memory'].startswith('Original global argument')
    assert len(calls) == 3


@pytest.mark.parametrize('error', [exhausted(16384), exhausted(None), RuntimeError('reading_budget_exceeded'), ValueError('invalid citation')])
def test_other_failures_do_not_spend_another_call(error):
    reader, _, _ = fixture()
    calls = []
    def generate(*_, **__):
        calls.append(1); raise error
    reader.dependencies.generate_text = generate
    with pytest.raises(type(error)):
        run_directed(reader)
    assert len(calls) == 1


def test_single_chunk_exhaustion_stops_and_budget_can_block_reduced_call():
    reader, _, checkpoints = fixture()
    calls = []
    def generate(prompt, **_):
        calls.append(json.loads(prompt))
        raise exhausted()
    reader.dependencies.generate_text = generate
    with pytest.raises(LengthFinishReasonError):
        run_directed(reader)
    assert len(calls) == 3  # four, two, one; never an infinite retry
    assert checkpoints['new', 'agent-state']['plans'] == {}
    reader, _, checkpoints = fixture()
    calls.clear()
    def budgeted(prompt, **_):
        calls.append(json.loads(prompt))
        if len(calls) == 1: raise exhausted()
        raise RuntimeError('reading_budget_exceeded')
    reader.dependencies.generate_text = budgeted
    with pytest.raises(RuntimeError, match='reading_budget_exceeded'):
        run_directed(reader)
    assert len(calls) == 2
    assert checkpoints['new', 'agent-state']['batch_size_limit'] == 2


def test_explicit_reads_and_unknown_persisted_errors_are_not_retried():
    state = {'last_result': {'sources': [1, 2, 3, 4], 'delivery': 'batch'}, 'last_action': {'name': 'search'}}
    assert not reduce_batch(state, exhausted())
    state['last_action']['delivery'] = 'automatic'
    assert not reduce_batch(state, 'length limit')
    assert not reduce_batch(state, str(exhausted(16384)))
