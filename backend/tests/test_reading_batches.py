"""A batch saves independent original evidence atomically and retains resume state."""
from copy import deepcopy
import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
import jsonschema

from backend.domains.llm_wiki.chunking import reading_chunks, encoded
from backend.domains.llm_wiki.contextual_reading import ContextualReader, fingerprint
from backend.domains.llm_wiki.directed_reading import _apply_action, run_directed, validate_action
from backend.domains.llm_wiki.origins import finalize_origin
from backend.domains.llm_wiki.reading_contracts import ReadingPlanError
from backend.domains.llm_wiki.reading_repairs import build_reading_repair


def fixture(count=4):
    origin = finalize_origin({'kind':'text', 'label':'Book', 'input_order':0,
        'segments':[{'text':f'Argument {i}, qualified by earlier passages.', 'locator':{'section':str(i)}} for i in range(count)]})
    chunks = reading_chunks([origin], budget=4096, count=lambda text: len(text.encode()))
    checkpoints = {}
    deps = SimpleNamespace(input_budget=120000, count_tokens=lambda text: len(text.encode()), batch_size=4,
        execution_revision='old-compatible-runtime', max_action_steps=64, generate_structured=None,
        save_checkpoint=lambda job, name, value: checkpoints.__setitem__((job, name), deepcopy(value)),
        load_checkpoint=lambda job, name: checkpoints.get((job, name)), update_job=Mock(),
        reduce_plans=lambda plans, *_: ([note for _, p in plans for note in p['notes']], []))
    reader = ContextualReader(deps, chunks, [origin], 'Book', 'Catalan', [], [], 'new', '')
    return reader, {chunk['id']:chunk for chunk in chunks}, checkpoints


def plan(chunk):
    return {'notes':[{'title':s['text'], 'body_md':s['text'], 'source_segment_id':s['id'],
            'citations':[{'segment_id':s['id'], 'quote':s['text']}]} for s in chunk['segments']],
            'coverage':[{'segment_id':s['id'], 'reason':'read'} for s in chunk['segments']], 'reviewed':True}


def test_166_original_plans_resume_25_fragments_in_seven_batches():
    reader, chunks, checkpoints = fixture(191)
    original = {key:{**plan(chunk), 'memory':'Book-wide qualifications'} for key,chunk in list(chunks.items())[:166]}
    checkpoint = {'identity':fingerprint([reader.dependencies.execution_revision, reader.chunks, [], []]),
                  'step':333, 'read':list(original), 'plans':deepcopy(original), 'memory':'Book-wide qualifications',
                  'last_result':{}, 'last_action':{'name':'save_plan'}}
    checkpoints['old','agent-state'] = deepcopy(checkpoint)
    reader.resume_job_id = 'old'
    calls = []
    def generate(prompt, **kwargs):
        request = json.loads(prompt);calls.append(request)
        result = request['last_result']
        if request['saved_plan_count'] == 191:
            action = {'action':'finish', 'arguments':{'summary':'Whole book reviewed'}}
        else:
            sources = result.get('sources', [result])
            action = {'action':'save_batch', 'arguments':{'plans':[{'chunk_id':c['id'], 'plan':plan(c)} for c in sources],
                    'memory_updates':[{'old':'', 'new':'Qualification preserved across these passages.'}]}}
        return json.dumps(action), 'offline'
    reader.dependencies.generate_text = generate
    report, _ = run_directed(reader)
    saved = checkpoints['new','agent-state']
    assert len(calls) == 8  # seven batches plus the final review action
    assert len(saved['plans']) == len(report['notes']) == 191
    assert {key:saved['plans'][key] for key in original} == original
    assert checkpoints['old','agent-state'] == checkpoint
    assert saved['memory'].startswith('Book-wide qualifications')


def test_invalid_last_fragment_cannot_commit_other_fragments_and_repair_preserves_them():
    reader, chunks, _ = fixture()
    state = {'step':0, 'read':list(chunks), 'plans':{}, 'memory':'Prior qualification', 'delivered':list(chunks)}
    entries = [{'chunk_id':key, 'plan':plan(chunk)} for key,chunk in chunks.items()]
    entries[-1]['plan']['notes'][0]['citations'][0]['quote'] = 'invented'
    answer = {'action':'save_batch', 'arguments':{'plans':entries, 'memory_updates':[{'old':'', 'new':'New qualification'}]}}
    previous = deepcopy(state)
    with pytest.raises(ReadingPlanError) as caught:
        validate_action(reader, state, chunks, answer)
    assert state == previous
    assert caught.value.batch_index == 3
    repair = build_reading_repair('original context', json.dumps(answer), caught.value)
    assert repair is not None
    segment = chunks[entries[-1]['chunk_id']]['segments'][0]
    restored = json.loads(repair.restore(json.dumps({'patches':[
        {'path':'notes/0/source_segment_id', 'value':segment['id']},
        {'path':'notes/0/citations', 'value':[{'segment_id':segment['id'],'quote':segment['text']}]}]})))
    assert restored['arguments']['plans'][:-1] == entries[:-1]
    assert restored['arguments']['memory_updates'] == answer['arguments']['memory_updates']
    validate_action(reader, state, chunks, restored)
    _apply_action(reader, state, chunks, 'save_batch', restored['arguments'])
    assert len(state['plans']) == 4


@pytest.mark.parametrize('fault', ['missing','duplicate'])
def test_batch_cannot_skip_or_duplicate_fragment(fault):
    reader, chunks, _ = fixture()
    state = {'step':0, 'read':list(chunks), 'plans':{}, 'memory':'Prior qualification', 'delivered':list(chunks)}
    entries = [{'chunk_id':key, 'plan':plan(chunk)} for key,chunk in chunks.items()]
    if fault == 'missing': entries.pop()
    else: entries[-1] = entries[0]
    with pytest.raises(ValueError, match='exactly_all_delivered'):
        validate_action(reader, state, chunks, {'action':'save_batch', 'arguments':{'plans':entries, 'memory':'Whole book'}})
    assert state['plans'] == {}


def test_all_rejected_plans_are_repaired_together_without_changing_valid_notes():
    from backend.domains.llm_wiki.reading_contracts import ReadingBatchError
    reader, chunks, _ = fixture()
    state = {'step': 0, 'read': list(chunks), 'plans': {}, 'memory': 'Prior qualification', 'delivered': list(chunks)}
    entries = [{'chunk_id': key, 'plan': plan(chunk)} for key, chunk in chunks.items()]
    for index in (0, 2, 3):
        entries[index]['plan']['notes'][0]['citations'][0]['quote'] = 'invented'
    answer = {'action': 'save_batch', 'arguments': {'plans': entries, 'memory_updates': [{'old': '', 'new': 'New qualification'}]}}
    previous = deepcopy(state)
    with pytest.raises(ReadingBatchError) as caught:
        validate_action(reader, state, chunks, answer)
    assert set(caught.value.plan_errors) == {0, 2, 3}
    assert state == previous
    repair = build_reading_repair('Original passages and prior memory', json.dumps(answer), caught.value)
    assert repair is not None
    patches = []
    for index in (0, 2, 3):
        segment = chunks[entries[index]['chunk_id']]['segments'][0]
        patches.extend([
            {'path': f'plans/{index}/notes/0/source_segment_id', 'value': segment['id']},
            {'path': f'plans/{index}/notes/0/citations', 'value': [{'segment_id': segment['id'], 'quote': segment['text']}]},
        ])
    restored = json.loads(repair.restore(json.dumps({'patches': patches})))
    validate_action(reader, state, chunks, restored)
    assert state == previous  # preview remains atomic
    _apply_action(reader, state, chunks, 'save_batch', restored['arguments'])
    assert len(state['plans']) == 4
    assert restored['arguments']['plans'][1] == entries[1]
    assert restored['arguments']['memory_updates'] == answer['arguments']['memory_updates']
    for before, after in zip(entries, restored['arguments']['plans'], strict=True):
        assert before['plan']['notes'][0]['body_md'] == after['plan']['notes'][0]['body_md']
    # Correctly shaped patches for the wrong plan must still fail local membership.
    patches[0]['value'] = chunks[entries[2]['chunk_id']]['segments'][0]['id']
    with pytest.raises((ValueError, jsonschema.ValidationError)):
        repaired = json.loads(repair.restore(json.dumps({'patches': patches})))
        validate_action(reader, state, chunks, repaired)
    patches[0]['path'] = 'plans/1/notes/0/body_md'
    with pytest.raises((ValueError, jsonschema.ValidationError)):
        repair.restore(json.dumps({'patches': patches}))
