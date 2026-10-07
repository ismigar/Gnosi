"""Distant originals are retrieved once, grounded, checkpointed and budgeted."""
from copy import deepcopy
import json

import pytest

from backend.domains.llm_wiki import semantic_review_execution as execution
from backend.domains.llm_wiki import semantic_review_evidence as lookup
from backend.domains.llm_wiki.chunking import encoded
from backend.domains.llm_wiki.semantic_quote_selection import quote_selection
from backend.tests.test_semantic_reading import response, setup
from backend.tests.test_semantic_review_parallel import prepared


def request_evidence(query='Argument 7', pages=None):
    return {'note': 1, 'document': 'Argument', 'query': query, 'pages': pages or [],
            'reason': 'Resolve the first note against the later refutation.'}


def retrieval_case(monkeypatch):
    monkeypatch.setattr(execution, 'relevant', lambda *args, **kwargs: [])
    engine, gm, nm, calls, checkpoints = prepared(count=8, size=2)
    for i, chunk in enumerate(engine.reader.chunks):
        chunk['segments'][0]['locator']['page'] = i + 1
    return engine, gm, nm, calls, checkpoints


def reviewing(request):
    answer = response(request)
    if 'Argument 0:' in request['notes'][0]['note']['title']:
        if not request.get('provisional_review'):
            answer.update(evidence_requests=[request_evidence('', [8])], unresolved_issues=['Need the ending.'])
        else:
            ending = next(s for s in request['retrieved_originals'] if s['location'].get('page') == 8)
            replacement = deepcopy(request['notes'][0]['note'])
            replacement.update(body_md='The later argument refutes the opponent, preserving the qualification.',
                               quotes=[request['notes'][0]['primary']['text'], ending['text']])
            answer.update(changes=[{'note': 1, 'replacement': replacement}], evidence_requests=[])
    return answer


def test_distant_refutation_uses_complete_original_and_survives_restart(monkeypatch):
    engine, gm, nm, calls, checkpoints = retrieval_case(monkeypatch)
    def generate(prompt, validate, timeout):
        request = json.loads(prompt)
        calls.append(request)
        answer = reviewing(request)
        validate(answer)
        return encoded(answer), 'offline'
    engine.deps.generate_structured = generate
    original = deepcopy(engine.state['plans'])
    result = engine.review(gm, nm)
    first = result[0][1]['notes'][0]
    distant = engine.reader.chunks[7]['segments'][0]
    assert first['citations'][1] == {'segment_id': distant['id'], 'quote': distant['text']}
    assert distant['text'] in [s['text'] for s in result[0][1]['evidence_segments']]
    assert engine.state['plans'] == original
    assert len([c for c in calls if c['phase'] == 'verify']) == 5
    engine.deps.generate_structured = lambda *args: pytest.fail('Repeat paid review')
    assert engine.review(gm, nm) == result
    assert checkpoints['new', 'semantic-state']['review_sources']


def test_pending_cost_after_request_replays_request_without_paying_it_again(monkeypatch):
    engine, gm, nm, calls, checkpoints = retrieval_case(monkeypatch)
    def generate(prompt, validate, timeout):
        request = json.loads(prompt)
        if request.get('provisional_review'):
            raise RuntimeError('reading_budget_pending_cost')
        answer = reviewing(request)
        validate(answer)
        return encoded(answer), 'offline'
    engine.deps.generate_structured = generate
    with pytest.raises(RuntimeError, match='reading_budget_pending_cost'):
        engine.review(gm, nm)
    assert len(engine.state['reviewed_groups']) == 1  # the independent sibling survives
    reader, resumed_calls, _ = setup(checkpoints=checkpoints, resume='new', generate=reviewing)
    reader.chunks = engine.reader.chunks
    reader.job_id = 'resumed'
    engine.reader = reader
    engine.deps = reader.dependencies
    engine.review(gm, nm)
    first_calls = [c for c in resumed_calls if 'Argument 0:' in c['notes'][0]['note']['title']]
    assert len(first_calls) == 1 and first_calls[0]['provisional_review']
    assert any(job == 'resumed' and key.endswith('evidence-0') for job, key in checkpoints)


@pytest.mark.parametrize('final_defect', [False, True])
def test_requests_can_defer_known_prose_defects_but_final_acceptance_cannot(monkeypatch, final_defect):
    engine, gm, nm, _, _ = retrieval_case(monkeypatch)
    first = next(iter(engine.state['plans'].values()))['notes'][0]
    first['body_md'] += ' [[123]]'
    def generate(prompt, validate, timeout):
        request = json.loads(prompt)
        answer = reviewing(request)
        if final_defect and request.get('provisional_review'):
            answer['changes'] = []
        validate(answer)
        return encoded(answer), 'offline'
    engine.deps.generate_structured = generate
    if final_defect:
        with pytest.raises(ValueError, match='Unresolved internal source IDs'):
            engine.review(gm, nm)
    else:
        result = engine.review(gm, nm)
        assert '[[123]]' not in result[0][1]['notes'][0]['body_md']


def test_repeated_requests_stop_without_marking_batch_reviewed(monkeypatch):
    engine, gm, nm, _, _ = retrieval_case(monkeypatch)
    calls = []
    def generate(prompt, validate, timeout):
        request = json.loads(prompt)
        answer = response(request)
        if 'Argument 0:' in request['notes'][0]['note']['title']:
            calls.append(request)
            answer['evidence_requests'] = [request_evidence('no-matching-original')]
        validate(answer)
        return encoded(answer), 'offline'
    engine.deps.generate_structured = generate
    with pytest.raises(RuntimeError, match='did not converge'):
        engine.review(gm, nm)
    assert len(calls) == 2 and len(engine.state['reviewed_groups']) == 1
    assert calls[1]['evidence_lookup'][0]['matched_passages'] == 0


def test_complete_pages_query_scope_and_saved_evidence_integrity():
    sources = [{'id': str(i), 'text': text, 'origin_label': doc, 'locator': {'page': page, 'section': 'Final'}}
               for i, (text, doc, page) in enumerate([
                   ('A long complete first passage.', 'Argument', 8),
                   ('A second complete passage on the same page.', 'Argument', 8),
                   ('A different document refutes the idea.', 'Other', 8)])]
    selected, reports = lookup.retrieve(sources, [request_evidence('', [8, 9])], [], len, 2000)
    assert selected == sources[:2] and reports[0]['missing_pages'] == [9]
    with pytest.raises(RuntimeError, match='complete pages exceed'):
        lookup.retrieve(sources, [request_evidence('', [8])], [], len, 30)
    request = request_evidence('refutes'); request['document'] = 'Other'
    selected, _ = lookup.retrieve(sources, [request], [], len, 2000)
    assert selected == sources[2:]
    refs = lookup.references(selected)
    assert lookup.restore(sources, refs) == selected
    sources[2]['text'] = 'Changed original'
    with pytest.raises(RuntimeError, match='saved review evidence changed'):
        lookup.restore(sources, refs)


def test_wire_contract_requires_requests_and_preserves_exact_citations(monkeypatch):
    engine, gm, nm, _, _ = retrieval_case(monkeypatch)
    def generate(prompt, validate, timeout):
        request = json.loads(prompt)
        selection = quote_selection(request)
        # Reproduce Upstage's real schema rejection before producing a response.
        if '"uniqueItems"' in encoded(selection.schema):
            raise RuntimeError("Invalid schema for response_format: uniqueItems is not supported")
        raw = {'assessment': 'Checked this batch only.', 'changes': {'note_1': None, 'note_2': None},
               'warnings': [], 'unresolved_issues': []}
        with pytest.raises(ValueError, match='evidence_requests'):
            selection.restore(encoded(raw))
        raw['evidence_requests'] = []
        answer = selection.restore(encoded(raw)); validate(json.loads(answer))
        raw['evidence_requests'] = [request_evidence('', [8, 8])]
        duplicate = json.loads(selection.restore(encoded(raw)))
        with pytest.raises(ValueError, match='non-unique'):
            validate(duplicate)
        assert 'other batches cover the other notes' in request['instruction']
        assert 'active skill\'s inclusion/exclusion' in request['instruction']
        assert request['available_originals']['sections']
        return answer, 'offline'
    engine.deps.generate_structured = generate
    assert len(engine.review(gm, nm)) == 8
