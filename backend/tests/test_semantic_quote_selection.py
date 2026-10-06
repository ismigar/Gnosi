"""Literal evidence survives first responses, syntax repair, review and caching."""
from copy import deepcopy
from dataclasses import replace
import json
from types import SimpleNamespace

import pytest

from backend.domains.llm_wiki.chunking import encoded
from backend.domains.llm_wiki.semantic_context import source_view
from backend.domains.llm_wiki.semantic_contracts import bind_interpretation, bind_review, review_schema
from backend.domains.llm_wiki.semantic_quote_selection import quote_selection
from backend.services.llm_wiki_reading_runtime import ReadingRuntime, compact_structured_input
from backend.tests.test_agent_execution import install_workflow, runtime as runtime
from backend.tests.test_semantic_quote_repair import repair_case, selected_answer


def selection_case():
    reader, primary, request, answer, _, _ = repair_case()
    selection = quote_selection(request)
    assert selection is not None
    payload = json.loads(selection.input)
    answer = selected_answer(answer, payload)
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
    answer['passages']['passage_1']['notes'][0]['primary_quote_ids'] = [choice]
    with pytest.raises(ValueError):
        selection.restore(encoded(answer))


def test_first_response_rejects_free_text_and_context_only_support():
    reader, primary, _, answer, selection = selection_case()
    wrong = deepcopy(answer)
    wrong['passages']['passage_1']['notes'][0]['quotes'] = [primary[0]['text']]
    with pytest.raises(ValueError):
        selection.restore(encoded(wrong))
    answer['passages']['passage_1']['notes'][0]['primary_quote_ids'] = answer['passages']['passage_2']['notes'][0]['primary_quote_ids']
    with pytest.raises(ValueError, match='primary'):
        bind_interpretation(json.loads(selection.restore(encoded(answer))), reader.chunks, primary, [])


def test_joint_review_uses_literal_choices_and_retains_the_canonical_note_contract():
    reader, primary, _, answer, selection = selection_case()
    literal = json.loads(selection.restore(encoded(answer)))['passages'][0]['notes'][0]
    targets = [(literal, primary[0], primary)]
    request = {'reading_engine': 'semantic', 'phase': 'verify', 'output_schema': review_schema(1, []),
               'notes': [{'note': literal, 'primary': source_view(primary[0]),
                          'support': [source_view(primary[1])]}], 'retrieved_originals': []}
    before = deepcopy(request)
    selection = quote_selection(request)
    payload = json.loads(selection.input)
    replacement = deepcopy(literal)
    replacement.pop('quotes')
    replacement['primary_quote_ids'] = [payload['source_quotes'][0]['quotes'][0]['quote_id']]
    replacement['context_quote_ids'] = []
    result = {'assessment': 'Checked attribution.', 'changes': {'note_1': replacement}, 'warnings': []}
    notes = bind_review(json.loads(selection.restore(encoded(result))), targets, [])
    assert notes[0]['citations'][0]['quote'] == 'the author doubts certainty.'
    assert request == before
    result['changes']['note_1']['primary_quote_ids'] = [payload['source_quotes'][1]['quotes'][0]['quote_id']]
    with pytest.raises(ValueError, match='primary'):
        bind_review(json.loads(selection.restore(encoded(result))), targets, [])
    result['changes']['note_1'] = None
    assert json.loads(selection.restore(encoded(result)))['changes'] == []


def test_catalog_overhead_is_checked_before_any_model_call(monkeypatch):
    _, _, request, _, selection = selection_case()
    runtime = ReadingRuntime('test', 'test', 'fake', '', 1_000_000, SimpleNamespace(behavior_resources=True))
    original = encoded(request)
    assert runtime.count_tokens(selection.input) > runtime.count_tokens(original)
    compact = json.loads(selection.input)
    compact.pop('output_schema')
    runtime.input_budget = runtime.count_tokens(compact_structured_input(selection.input), output_schema=selection.schema) - 1
    monkeypatch.setattr('backend.services.agent_execution.run_sync', lambda *args, **kwargs: pytest.fail('paid call'))
    with pytest.raises(RuntimeError, match='context budget'):
        runtime.generate_structured(original, lambda _: None, 240)


def test_semantic_transport_sends_schema_separately_and_preserves_literal_validation(monkeypatch):
    _, _, request, answer, selection = selection_case()
    runtime = ReadingRuntime('test', 'test', 'fake', '', 1_000_000, SimpleNamespace(behavior_resources=True))
    captured = []
    def execute(operation, **kwargs):
        captured.append(operation)
        assert 'output_schema' not in json.loads(operation.input)
        assert operation.output_schema == selection.schema
        kwargs['output_validator'](encoded(answer))
        return SimpleNamespace(result=encoded(answer), model='fake')
    monkeypatch.setattr('backend.services.agent_execution.run_sync', execute)
    result, _ = runtime.generate_structured(encoded(request), lambda _: None, 240)
    assert result == selection.restore(encoded(answer))
    assert runtime.count_tokens(captured[0].input, output_schema=captured[0].output_schema) < runtime.count_tokens(selection.input)
    assert request['output_schema']  # The canonical reader and repair contract remains intact.


def test_long_incomplete_semantic_answer_requests_smaller_batch_without_full_rewrite(runtime, monkeypatch):
    from backend.services import agent_execution as execution
    from backend.services.agent_execution_scope import execution_scope
    from backend.domains.llm_wiki.reading_batch_recovery import IncompleteReadingBatch
    _, _, request, answer, _ = selection_case()
    answer['passages']['passage_1']['notes'][0]['body_md'] = 'A substantive qualified interpretation. ' * 200
    incomplete = encoded(answer)[:-1]
    calls = install_workflow(monkeypatch, [incomplete])
    scope, snapshot = runtime
    from backend.domains.llm_wiki.reading_skill import SKILL_ID
    from backend.services.agent_skill_catalog import resolve_agent_runtime
    resolved = resolve_agent_runtime({})
    snapshot.skill_ids.append(SKILL_ID)
    monkeypatch.setattr('backend.services.agent_skill_catalog.resolve_agent_runtime', lambda *args, **kwargs:
        replace(resolved, active_skill_ids=tuple(snapshot.skill_ids)))
    with execution_scope(scope):
        frozen = execution.create_job_run(snapshot, 'incomplete-book-job', 'knowledge.process-source')
        reader = ReadingRuntime(snapshot.agent_id, 'test', 'fake', '', 1_000_000, frozen)
        with pytest.raises(IncompleteReadingBatch):
            reader.generate_structured(encoded(request), lambda _: None, 240)
    assert len(calls) == 1


def test_named_passages_keep_source_order_and_cannot_be_shifted_or_omitted():
    _, primary, _, answer, selection = selection_case()
    answer['passages'] = dict(reversed(list(answer['passages'].items())))
    restored = json.loads(selection.restore(encoded(answer)))
    assert ''.join(restored['passages'][0]['notes'][0]['quotes']) == primary[0]['text']
    shifted = deepcopy(answer)
    shifted['passages']['passage_1'], shifted['passages']['passage_2'] = (
        shifted['passages']['passage_2'], shifted['passages']['passage_1'])
    with pytest.raises(ValueError, match='primary_quote_ids'):
        selection.restore(encoded(shifted))
    answer['passages'].pop('passage_1')
    with pytest.raises(ValueError, match='required'):
        selection.restore(encoded(answer))


def test_context_can_supplement_but_never_replace_a_primary_quote():
    reader, primary, _, answer, selection = selection_case()
    note = answer['passages']['passage_1']['notes'][0]
    note['context_quote_ids'] = answer['passages']['passage_2']['notes'][0]['primary_quote_ids']
    restored = json.loads(selection.restore(encoded(answer)))
    assert bind_interpretation(restored, reader.chunks, primary, [])
    note['primary_quote_ids'] = []
    with pytest.raises(ValueError, match='primary_quote_ids'):
        selection.restore(encoded(answer))


def test_schema_constrains_every_primary_on_the_provider_transport():
    from backend.domains.agent.structured_output import constrain_output
    from backend.domains.llm_wiki.semantic_repairs import build_semantic_repair
    class Model:
        def bind(self, **kwargs):
            return kwargs
    _, _, request, answer, selection = selection_case()
    answer['passages']['passage_1']['notes'][0]['primary_quote_ids'] = answer['passages']['passage_2']['notes'][0]['primary_quote_ids']
    repair = build_semantic_repair(encoded(request), selection.draft_for_repair(encoded(answer)))
    for schema in [selection.schema, repair.output_schema]:
        bound = constrain_output(Model(), 'openrouter', schema)
        assert bound['response_format']['type'] == 'json_schema'
        assert bound['response_format']['json_schema']['strict'] is True
        assert bound['response_format']['json_schema']['schema'] == schema
        assert schema['$defs']['reading_note_properties'] == request['output_schema']['properties']['passages']['items']['properties']['notes']['items']['properties']['properties']


def test_shifted_last_four_of_fourteen_passages_are_all_diagnosed_and_repaired_locally():
    from backend.tests.test_semantic_reading import setup, response
    from backend.domains.llm_wiki.semantic_contracts import interpretation_schema
    from backend.domains.llm_wiki.semantic_context import source_view
    from backend.domains.llm_wiki.semantic_repairs import build_semantic_repair
    from backend.tests.test_semantic_quote_repair import patch_for
    reader, _, _ = setup(count=14)
    primary = [s for c in reader.chunks for s in c['segments']]
    request = {'reading_engine': 'semantic', 'phase': 'interpret',
               'primary_passages': [source_view(s) for s in primary], 'output_schema': interpretation_schema(14, [])}
    selection = quote_selection(request)
    answer = selected_answer(response(request), json.loads(selection.input))
    before = deepcopy(answer)
    for destination, source in [(11, 12), (12, 13), (13, 14), (14, 3)]:
        answer['passages'][f'passage_{destination}'] = deepcopy(before['passages'][f'passage_{source}'])
    with pytest.raises(ValueError):
        selection.restore(encoded(answer))
    rejected = selection.draft_for_repair(encoded(answer))
    repair = build_semantic_repair(encoded(request), rejected)
    payload = json.loads(repair.input)
    assert [row['passage'] for row in payload['passages']] == [11, 12, 13, 14]
    patch = patch_for(json.loads(rejected), payload)
    for key, passage in patch['repairs'].items():
        for field in ['title', 'body_md']:
            passage['notes'][0][field] = before['passages'][key]['notes'][0][field]
    bad_patch = deepcopy(patch)
    bad_patch['repairs']['passage_11']['notes'][0]['primary_quote_ids'] = selection.primary_ids[9]
    with pytest.raises(ValueError, match='primary_quote_ids'):
        repair.restore(encoded(bad_patch))
    fixed = json.loads(selection.restore(selection.repair(repair).restore(encoded(patch))))
    assert bind_interpretation(fixed, reader.chunks, primary, [])
    assert fixed['passages'][:10] == json.loads(selection.restore(encoded(before)))['passages'][:10]


@pytest.mark.parametrize('fault', ['none', 'syntax', 'source', 'unknown_choice', 'source_again'])
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
    if fault in {'source', 'source_again', 'unknown_choice'}:
        draft = deepcopy(answer)
        draft['passages']['passage_1']['notes'][0]['primary_quote_ids'] = (
            answer['passages']['passage_2']['notes'][0]['primary_quote_ids'] if fault.startswith('source') else [999999])
        responses.insert(0, encoded(draft))
        if fault.startswith('source'):
            from backend.domains.llm_wiki.semantic_repairs import build_semantic_repair
            from backend.tests.test_semantic_quote_repair import patch_for
            canonical = selection.draft_for_repair(encoded(draft))
            repair = build_semantic_repair(encoded(request), canonical)
            values = patch_for(json.loads(canonical), json.loads(repair.input))
            if fault == 'source_again':
                values['repairs']['passage_1']['notes'][0]['primary_quote_ids'] = selection.primary_ids[1]
            patch = encoded(values)
            responses[1] = patch
            if fault == 'source':
                expected = encoded(json.loads(repair.restore(patch)))
    calls = install_workflow(monkeypatch, responses)
    validate = lambda value: bind_interpretation(value, source_reader.chunks, primary, [])
    with execution_scope(scope):
        frozen = execution.create_job_run(snapshot, 'same-book-job', 'knowledge.process-source')
        reader = ReadingRuntime(snapshot.agent_id, 'test', 'fake', '', 1_000_000, frozen)
        if fault == 'source_again':
            with pytest.raises(ValueError, match='Invalid reading plan:.*primary_quote_ids'):
                reader.generate_structured(encoded(request), validate, 240)
            failed = [run for run in store.list_runs(scope) if run.operation == 'knowledge.process-source.phase']
            assert len(calls) == 2 and len(failed) == 1 and failed[0].status == 'failed' and not failed[0].result
            return
        text, model = reader.generate_structured(encoded(request), validate, 240)
        again, _ = reader.generate_structured(encoded(request), validate, 240)
        runs = [run for run in store.list_runs(scope) if run.operation == 'knowledge.process-source.phase']
    assert text == again and text == expected and model == 'fake'
    assert len(calls) == len(responses) and len(runs) == 1
    assert selection.restore(runs[0].result) == expected
    if fault != 'source':
        assert calls[0]['messages'][0].content == calls[-1]['messages'][0].content
    envelope = json.loads(calls[0]['messages'][0].content)
    prompt = json.loads(envelope['input'])
    assert prompt['source_quotes'] and 'quote_ids' in encoded(envelope['output_schema'])
    assert 'output_schema' not in prompt
    assert 'source_segment_id' not in selection.input
    assert execution._run.get() == ''


def test_compact_transport_preserves_every_evidence_character_and_response_value():
    _, _, request, answer, selection = selection_case()
    before = json.loads(selection.input)
    compact = json.loads(compact_structured_input(selection.input))
    assert compact.pop('instruction').startswith(before.pop('instruction'))
    before.pop('output_schema')
    assert compact == before
    assert selection.restore(json.dumps(answer, ensure_ascii=False, indent=2)) == selection.restore(
        json.dumps(answer, ensure_ascii=False, separators=(',', ':')))
    assert request['output_schema']
