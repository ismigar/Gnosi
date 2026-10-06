"""Literal evidence survives first responses, syntax repair, review and caching."""
from copy import deepcopy
from dataclasses import replace
import json
from types import SimpleNamespace

import pytest

from backend.domains.llm_wiki.chunking import encoded
from backend.domains.llm_wiki.semantic_contracts import bind_interpretation, bind_review, review_schema
from backend.domains.llm_wiki.semantic_quote_selection import quote_selection
from backend.services.llm_wiki_reading_runtime import ReadingRuntime
from backend.tests.test_agent_execution import install_workflow, runtime as runtime
from backend.tests.test_semantic_quote_repair import repair_case


def selection_case():
    reader, primary, request, answer, _, _ = repair_case()
    selection = quote_selection(request)
    assert selection is not None
    payload = json.loads(selection.input)
    for index, passage in enumerate(answer['passages']):
        source = payload['source_quotes'][payload['primary_passages'][index]['source'] - 1]
        for note in passage['notes']:
            note.pop('quotes')
            note['quote_ids'] = [quote['quote_id'] for quote in source['quotes']]
    return reader, primary, request, answer, selection


def test_first_response_keeps_complete_originals_and_returns_only_literal_citations():
    reader, primary, request, answer, selection = selection_case()
    before = deepcopy(request)
    request['neighbours'] = [{'text': ' Una reserva.\nUna segona veu!', 'document': 'Context'}]
    request['retrieved_originals'] = deepcopy(request['neighbours'])
    selection = quote_selection(request)
    payload = json.loads(selection.input)
    assert len(payload['source_quotes']) == 3
    for index, original in enumerate([*primary, request['neighbours'][0]]):
        assert ''.join(q['text'] for q in payload['source_quotes'][index]['quotes']) == original['text']
    assert request['primary_passages'] == before['primary_passages']
    restored = json.loads(selection.restore(encoded(answer)))
    plans = bind_interpretation(restored, reader.chunks, primary, [])
    for index, plan in enumerate(plans.values()):
        assert ''.join(c['quote'] for c in plan['notes'][0]['citations']) == primary[index]['text']
        assert all(c['segment_id'] == primary[index]['id'] for c in plan['notes'][0]['citations'])


@pytest.mark.parametrize('choice', [0, -1, 999999, True, '1', 'rewritten quote'])
def test_first_response_rejects_unknown_or_noninteger_choices(choice):
    _, _, _, answer, selection = selection_case()
    answer['passages'][0]['notes'][0]['quote_ids'] = [choice]
    with pytest.raises(ValueError):
        selection.restore(encoded(answer))


def test_first_response_rejects_free_text_and_context_only_support():
    reader, primary, _, answer, selection = selection_case()
    wrong = deepcopy(answer)
    wrong['passages'][0]['notes'][0]['quotes'] = [primary[0]['text']]
    with pytest.raises(ValueError):
        selection.restore(encoded(wrong))
    answer['passages'][0]['notes'][0]['quote_ids'] = answer['passages'][1]['notes'][0]['quote_ids']
    with pytest.raises(ValueError, match='primary'):
        bind_interpretation(json.loads(selection.restore(encoded(answer))), reader.chunks, primary, [])


def test_joint_review_uses_literal_choices_and_retains_the_canonical_note_contract():
    reader, primary, _, answer, selection = selection_case()
    literal = json.loads(selection.restore(encoded(answer)))['passages'][0]['notes'][0]
    targets = [(literal, primary[0], primary)]
    request = {'reading_engine': 'semantic', 'phase': 'verify', 'output_schema': review_schema(1, []),
               'notes': [{'note': literal, 'primary': {'text': primary[0]['text']},
                          'support': [{'text': primary[1]['text']}]}], 'retrieved_originals': []}
    before = deepcopy(request)
    selection = quote_selection(request)
    payload = json.loads(selection.input)
    replacement = deepcopy(literal)
    replacement.pop('quotes')
    replacement['quote_ids'] = [payload['source_quotes'][0]['quotes'][0]['quote_id']]
    result = {'assessment': 'Checked attribution.', 'changes': [{'note': 1, 'replacement': replacement}], 'warnings': []}
    notes = bind_review(json.loads(selection.restore(encoded(result))), targets, [])
    assert notes[0]['citations'][0]['quote'] == 'the author doubts certainty.'
    assert request == before
    result['changes'][0]['replacement']['quote_ids'] = [payload['source_quotes'][1]['quotes'][0]['quote_id']]
    with pytest.raises(ValueError, match='primary'):
        bind_review(json.loads(selection.restore(encoded(result))), targets, [])


def test_catalog_overhead_is_checked_before_any_model_call(monkeypatch):
    _, _, request, _, selection = selection_case()
    runtime = ReadingRuntime('test', 'test', 'fake', '', 1_000_000, SimpleNamespace(behavior_resources=True))
    original = encoded(request)
    assert runtime.count_tokens(selection.input) > runtime.count_tokens(original)
    runtime.input_budget = runtime.count_tokens(original)
    monkeypatch.setattr('backend.services.agent_execution.run_sync', lambda *args, **kwargs: pytest.fail('paid call'))
    with pytest.raises(RuntimeError, match='context budget'):
        runtime.generate_structured(original, lambda _: None, 240)


@pytest.mark.parametrize('fault', ['none', 'syntax', 'source', 'unknown_choice'])
def test_governed_operation_repairs_then_reuses_checked_numeric_cache(runtime, monkeypatch, fault):
    from backend.services import agent_execution as execution, agent_execution_store as store
    from backend.services.agent_execution_scope import execution_scope
    from backend.domains.llm_wiki.reading_skill import SKILL_ID
    from backend.services.agent_skill_catalog import resolve_agent_runtime

    scope, snapshot = runtime
    resolved = resolve_agent_runtime({})
    snapshot.skill_ids.append(SKILL_ID)
    monkeypatch.setattr('backend.services.agent_skill_catalog.resolve_agent_runtime', lambda *args, **kwargs:
        replace(resolved, active_skill_ids=tuple(snapshot.skill_ids)))
    source_reader, primary, request, answer, selection = selection_case()
    expected = selection.restore(encoded(answer))
    responses = [encoded(answer)]
    if fault == 'syntax':
        responses.insert(0, '{"passages": [')
    if fault in {'source', 'unknown_choice'}:
        draft = deepcopy(answer)
        draft['passages'][0]['notes'][0]['quote_ids'] = (
            answer['passages'][1]['notes'][0]['quote_ids'] if fault == 'source' else [999999])
        responses.insert(0, encoded(draft))
        if fault == 'source':
            from backend.domains.llm_wiki.semantic_repairs import build_semantic_repair
            from backend.tests.test_semantic_quote_repair import patch_for
            canonical = selection.restore(encoded(draft))
            repair = build_semantic_repair(encoded(request), canonical)
            patch = encoded(patch_for(json.loads(canonical), json.loads(repair.input)))
            responses[1] = patch
            expected = encoded(json.loads(repair.restore(patch)))
    calls = install_workflow(monkeypatch, responses)
    validate = lambda value: bind_interpretation(value, source_reader.chunks, primary, [])
    with execution_scope(scope):
        frozen = execution.create_job_run(snapshot, 'same-book-job', 'knowledge.process-source')
        reader = ReadingRuntime(snapshot.agent_id, 'test', 'fake', '', 1_000_000, frozen)
        text, model = reader.generate_structured(encoded(request), validate, 240)
        again, _ = reader.generate_structured(encoded(request), validate, 240)
        runs = [run for run in store.list_runs(scope) if run.operation == 'knowledge.process-source.phase']
    assert text == again and text == expected and model == 'fake'
    assert len(calls) == len(responses) and len(runs) == 1
    assert selection.restore(runs[0].result) == expected
    if fault != 'source':
        assert calls[0]['messages'][0].content == calls[-1]['messages'][0].content
    prompt = json.loads(json.loads(calls[0]['messages'][0].content)['input'])
    assert prompt['source_quotes'] and 'quote_ids' in encoded(prompt['output_schema'])
    assert 'source_segment_id' not in selection.input
    assert execution._run.get() == ''
