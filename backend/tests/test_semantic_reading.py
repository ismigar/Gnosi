"""Deterministic source reading: semantic work only, grounding and resumability."""
from copy import deepcopy
import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from backend.domains.llm_wiki.chunking import encoded, reading_chunks
from backend.domains.llm_wiki.contextual_reading import ContextualReader
from backend.domains.llm_wiki.origins import finalize_origin
from backend.domains.llm_wiki.semantic_contracts import bind_interpretation, bind_review, interpretation_schema
from backend.domains.llm_wiki.semantic_repairs import build_semantic_repair
from backend.services.llm_wiki_reading_runtime import token_bound


def response(request):
    if request['phase'] == 'overview':
        return {'summary': 'The opponent claims knowledge is innate; the author rejects this in the conclusion. Uncertainty remains.'}
    if request['phase'] == 'verify':
        return {'assessment': 'Checked attribution against the conclusion and all proposed notes.', 'changes': [], 'warnings': [],
                **({'unresolved_issues': []} if 'unresolved_issues' in request['output_schema']['properties'] else {})}
    return {'passages': [{'reason': 'Substantive idea with attribution.', 'notes': [{
        'title': p['text'], 'body_md': p['text'], 'quotes': [p['text']], 'properties': {}}]}
        for p in request['primary_passages']], 'themes': ['Knowledge'], 'questions': ['What evidence is sufficient?'],
        'contradictions': ['The opponent is refuted, not the author contradicting himself.'], 'warnings': []}


def setup(*, count=8, checkpoints=None, resume='', generate=response, revision='semantic-v1'):
    origin = finalize_origin({'kind': 'text', 'label': 'Argument', 'input_order': 0,
        'segments': [{'text': f'Argument {i}: The opponent claims innate knowledge; experience contradicts this.',
                      'locator': {'section': f'Section {i}'}} for i in range(count)]})
    chunks = reading_chunks([origin], budget=1500, count=token_bound)
    checkpoints = {} if checkpoints is None else checkpoints
    calls = []
    def ask(prompt, validator, timeout):
        request = json.loads(prompt)
        calls.append(request)
        value = generate(request)
        validator(value)
        return json.dumps(value), 'test-model'
    deps = SimpleNamespace(input_budget=48000, count_tokens=token_bound, execution_revision=revision,
        semantic_reading=True, agent_directed=True, batch_size=4, resume_candidates=None, resume_job_status=None,
        generate_structured=ask, update_job=Mock(),
        save_checkpoint=lambda job, key, value: checkpoints.__setitem__((job, key), deepcopy(value)),
        load_checkpoint=lambda job, key: checkpoints.get((job, key)),
        reduce_plans=lambda plans, *_: ([n for _, p in plans for n in p['notes']], []))
    return ContextualReader(deps, chunks, [origin], 'Book', 'Catalan', [], [], 'new', resume), calls, checkpoints


def test_semantic_pipeline_covers_sources_and_reviews_every_note_with_whole_argument():
    reader, calls, checkpoints = setup()
    result, models = reader.run()
    assert result['reviewed'] is True and len(result['notes']) == len(reader.chunks)
    assert len(result['coverage']) == len(reader.chunks)
    assert models and all(m == 'test-model' for m in models)
    phases = [c['phase'] for c in calls]
    assert phases == ['overview', 'interpret', 'interpret', 'overview', 'verify']
    assert sum(len(c['primary_passages']) for c in calls if c['phase'] == 'interpret') == 8
    assert sum(len(c['notes']) for c in calls if c['phase'] == 'verify') == 8
    for call in calls:
        prompt = encoded(call)
        assert all(key not in prompt for key in ['source_segment_id', 'chunk_id', 'memory_updates', 'available_actions'])
        if call['phase'] in {'interpret', 'verify'}:
            assert 'rejects this in the conclusion' in call['global_map']
    assert calls[2]['related_notes'] and calls[2]['related_observations']
    assert calls[-1]['all_notes_map']
    for note, segment in zip(result['notes'], reader.origins[0]['segments'], strict=True):
        assert note['source_segment_id'] == segment['id']
        assert note['citations'] == [{'segment_id': segment['id'], 'quote': segment['text']}]
    state = checkpoints['new', 'semantic-state']
    assert state['completed'] and len(state['observations']) == 2 and len(state['plans']) == 8
    assert 'memory' not in state


def test_completed_resume_reuses_maps_plans_and_review_without_paid_calls():
    reader, _, checkpoints = setup()
    result, _ = reader.run()
    resumed, calls, _ = setup(checkpoints=checkpoints, resume='new', generate=lambda _: pytest.fail('paid repeat'))
    again, models = resumed.run()
    assert not calls and again == result and models == ['test-model']


def test_interruption_after_one_batch_keeps_it_and_resumes_remaining_only():
    batches = 0
    def generate(request):
        nonlocal batches
        if request['phase'] == 'interpret':
            batches += 1
            if batches == 2:
                raise RuntimeError('budget_pause')
        return response(request)
    reader, _, checkpoints = setup(generate=generate)
    with pytest.raises(RuntimeError, match='budget_pause'):
        reader.run()
    assert len(checkpoints['new', 'semantic-state']['plans']) == 4
    resumed, calls, _ = setup(checkpoints=checkpoints, resume='new')
    result, _ = resumed.run()
    assert len(result['notes']) == 8
    interpretations = [c for c in calls if c['phase'] == 'interpret']
    assert len(interpretations) == 1 and 'Argument 4' in interpretations[0]['primary_passages'][0]['text']
    assert calls[0]['phase'] == 'interpret'


def test_incomplete_output_splits_only_unsaved_batch_and_preserves_completed_work():
    from backend.domains.llm_wiki.reading_batch_recovery import IncompleteReadingBatch
    batches = []
    def generate(request):
        if request['phase'] == 'interpret':
            size = len(request['primary_passages'])
            batches.append(size)
            if len(batches) == 2:
                raise IncompleteReadingBatch()
        return response(request)
    reader, _, checkpoints = setup(generate=generate)
    result, _ = reader.run()
    assert batches == [4, 4, 2, 2]
    assert len(result['coverage']) == 8
    assert len(checkpoints['new', 'semantic-state']['plans']) == 8
    assert checkpoints['new', 'semantic-state']['batch_size_limit'] == 2


def test_semantic_link_candidates_use_small_ranked_navigation_without_changing_index():
    reader, calls, _ = setup()
    reader.brain_index = [{'id': str(i), 'title': f'Unrelated item {i}', 'type': 'concept'} for i in range(200)]
    reader.brain_index.append({'id': 'relevant', 'title': 'Innate knowledge and experience', 'type': 'concept'})
    original = deepcopy(reader.brain_index)
    reader.run()
    for call in calls:
        if call['phase'] == 'interpret':
            assert len(call['brain_notes']) <= 8
            assert call['brain_notes'][0]['id'] == 'relevant'
    assert reader.brain_index == original


@pytest.mark.parametrize('change', ['revision', 'language'])
def test_incompatible_policy_or_language_does_not_reuse_partial_work(change):
    reader, _, checkpoints = setup()
    reader.run()
    resumed, calls, _ = setup(checkpoints=checkpoints, resume='new', revision='changed' if change == 'revision' else 'semantic-v1')
    if change == 'language':
        resumed.language = 'French'
    resumed.run()
    assert calls[0]['phase'] == 'overview'


def test_output_exhaustion_reduces_delivery_without_model_actions_or_losing_progress():
    from backend.tests.test_reading_batch_recovery import exhausted
    failed = False
    def generate(request):
        nonlocal failed
        if request['phase'] == 'interpret' and not failed:
            failed = True
            raise exhausted()
        return response(request)
    reader, calls, checkpoints = setup(generate=generate)
    result, _ = reader.run()
    assert len(result['notes']) == 8
    assert [len(c['primary_passages']) for c in calls if c['phase'] == 'interpret'] == [4, 2, 2, 2, 2]
    assert checkpoints['new', 'semantic-state']['batch_size_limit'] == 2


def test_sparse_review_changes_only_requested_note_and_cannot_forge_grounding():
    reader, _, _ = setup(count=2)
    def generate(request):
        answer = response(request)
        if request['phase'] == 'verify':
            changed = deepcopy(request['notes'][0]['note'])
            changed['body_md'] = 'The opponent, not the author, holds the innate position.'
            answer['changes'] = [{'note': 1, 'replacement': changed}]
        return answer
    reader2, _, _ = setup(count=2, generate=generate)
    result, _ = reader2.run()
    assert result['notes'][0]['body_md'].startswith('The opponent, not the author')
    assert result['notes'][1]['body_md'] == reader.chunks[1]['segments'][0]['text']
    primary = reader.chunks[0]['segments'][0]
    target = (result['notes'][0], primary, [primary])
    changed = {'title': 'False', 'body_md': 'False', 'quotes': ['Invented'], 'properties': {}}
    with pytest.raises(ValueError):
        bind_review({'assessment': 'done', 'changes': [{'note': 1, 'replacement': changed}], 'warnings': []}, [target], [])


@pytest.mark.parametrize('fault', ['quote', 'order', 'missing', 'action', 'fields'])
def test_interpretation_rejects_invalid_evidence_and_coverage_before_save(fault):
    reader, _, _ = setup(count=2)
    primary = [s for c in reader.chunks for s in c['segments']]
    answer = response({'phase': 'interpret', 'primary_passages': [{'text': s['text']} for s in primary]})
    if fault == 'quote':
        answer['passages'][0]['notes'][0]['quotes'] = ['invented quote']
    elif fault == 'order':
        answer['passages'].reverse()
    elif fault == 'missing':
        answer['passages'].pop()
    elif fault == 'fields':
        answer['passages'][0]['notes'][0]['properties'] = {'invented_id': ['value']}
    else:
        answer = {'action': 'finish', 'arguments': {'summary': 'done'}}
    with pytest.raises(ValueError):
        bind_interpretation(answer, reader.chunks, primary, [])


def test_partial_repair_preserves_valid_passages_and_semantic_memory():
    reader, _, _ = setup(count=2)
    primary = [{'text': s['text'], 'location': {}} for c in reader.chunks for s in c['segments']]
    request = {'phase': 'interpret', 'primary_passages': primary, 'output_schema': interpretation_schema(2, [])}
    answer = response(request)
    answer['passages'][1]['notes'][0]['quotes'] = ['invented']
    before = deepcopy(answer)
    repair = build_semantic_repair(encoded(request), encoded(answer))
    assert repair
    payload = json.loads(repair.input)
    assert len(payload['passages']) == 1 and payload['passages'][0]['passage'] == 2
    fixed = deepcopy(answer['passages'][1]); fixed['notes'][0].pop('quotes')
    source = next(s for s in payload['source_quotes'] if s['source'] == payload['passages'][0]['primary_source'])
    fixed['notes'][0]['primary_quote_ids'] = [q['quote_id'] for q in source['quotes']]
    fixed['notes'][0]['context_quote_ids'] = []
    restored = json.loads(repair.restore(encoded({'repairs': {'passage_2': fixed}})))
    assert restored['passages'][0] == before['passages'][0]
    assert restored['questions'] == before['questions'] and answer == before
    with pytest.raises(ValueError):
        repair.restore(encoded({'repairs': {'passage_1': fixed}}))


def test_long_source_maps_all_sections_and_all_notes_before_review():
    reader, calls, _ = setup(count=160)
    result, _ = reader.run()
    source_maps = [c for c in calls if c['phase'] == 'overview' and isinstance(c['material'], list)
                   and c['material'] and isinstance(c['material'][0], dict) and 'passages' in c['material'][0]]
    assert len(source_maps) > 1
    texts = [p['text'] for c in source_maps for group in c['material'] for p in group['passages']]
    assert texts == [s['text'] for s in reader.origins[0]['segments']]
    assert 'Argument 159:' in texts[-1]
    assert len(result['notes']) == 160
    assert sum(len(c['notes']) for c in calls if c['phase'] == 'verify') == 160
    note_maps = [c for c in calls if c['phase'] == 'overview' and isinstance(c['material'], list)
                 and c['material'] and isinstance(c['material'][0], dict) and 'body_md' in c['material'][0]]
    mapped_notes = [n for c in note_maps for n in c['material'] if n['title'] != 'Reading observations']
    assert len(mapped_notes) == 160


def test_typed_properties_are_bound_by_code_not_copied_as_persistent_ids():
    reader, calls, _ = setup(count=2)
    reader.dimensions = [{'field_id': 'db-sensitive-field-uuid', 'name': 'Year', 'multiple': False,
                          'value_schema': {'type': 'integer'}}]
    def generate(request):
        answer = response(request)
        for passage in answer.get('passages', []):
            for note in passage['notes']:
                note['properties'] = {'property_1': [2026]}
        return answer
    def structured(prompt, validator, timeout):
        request = json.loads(prompt); calls.append(request)
        answer = generate(request); validator(answer)
        return json.dumps(answer), 'test-model'
    reader.dependencies.generate_structured = structured
    result, _ = reader.run()
    assert result['notes'][0]['dimensions'] == {'db-sensitive-field-uuid': [2026]}
    assert 'db-sensitive-field-uuid' not in encoded(calls)


def test_overview_and_joint_review_are_priced_without_inference():
    from backend.services.reading_semantic_estimate import phase_estimate
    reader, calls, _ = setup(count=191)
    runtime = SimpleNamespace(input_budget=reader.budget, count_tokens=token_bound, instructions='Methodology')
    estimate = phase_estimate(runtime, reader.chunks, reader.chunks, [], {}, 4)
    assert not calls
    assert all(estimate['phase_calls'][phase] > 0 for phase in ('overview', 'interpretation', 'joint_map', 'review'))
    assert estimate['planned_calls'] == sum(estimate['phase_calls'].values())
    assert estimate['phase_calls']['interpretation'] == 48
    assert estimate['input_token_bound'] > sum(len(s['text']) for s in reader.origins[0]['segments'])


def test_review_output_reduction_and_restart_retain_every_completed_group(monkeypatch):
    # Keep the serial recovery reference; the parallel suite checks saved peers.
    monkeypatch.setattr('backend.domains.llm_wiki.semantic_review_execution.REVIEW_WORKERS', 1)
    from backend.tests.test_reading_batch_recovery import exhausted
    reviewing = 0
    def generate(request):
        nonlocal reviewing
        if request['phase'] == 'verify':
            reviewing += 1
            if reviewing == 2:
                raise exhausted()
            if reviewing == 4:
                raise RuntimeError('budget_pause')
        return response(request)
    reader, calls, checkpoints = setup(count=80, generate=generate)
    with pytest.raises(RuntimeError, match='budget_pause'):
        reader.run()
    completed = checkpoints['new', 'semantic-state']['reviewed_groups']
    assert len(completed) == 2
    reviewed_titles = {n['note']['title'] for c in [c for c in calls if c['phase'] == 'verify'][:1] for n in c['notes']}
    resumed, new_calls, _ = setup(count=80, checkpoints=checkpoints, resume='new')
    result, _ = resumed.run()
    assert len(result['notes']) == 80
    assert all(n['note']['title'] not in reviewed_titles for c in new_calls if c['phase'] == 'verify' for n in c['notes'])


def test_resume_selects_completed_reviews_not_older_state_with_same_saved_chunks():
    reader, _, checkpoints = setup()
    reader.run()
    older = deepcopy(checkpoints['new', 'semantic-state'])
    older['reviewed_groups'] = {}; older['reviewed_ranges'] = {}; older.pop('completed')
    checkpoints['older', 'semantic-state'] = older
    resumed, calls, _ = setup(checkpoints=checkpoints, resume='new')
    resumed.dependencies.resume_candidates = lambda _: ['new', 'older']
    resumed.run()
    assert not calls


def test_production_argument_maps_use_prose_and_resume_without_json_or_paid_repeat():
    reader, calls, checkpoints = setup()
    prose_calls = []
    def prose(prompt, validator, timeout):
        request = json.loads(prompt)
        prose_calls.append(request)
        assert 'output_schema' not in request and 'plain text' in request['instruction']
        return validator(response(request)['summary']), 'test-model'
    reader.dependencies.generate_prose = prose
    result, _ = reader.run()
    assert len(prose_calls) == 2 and all(c['phase'] != 'overview' for c in calls)
    assert len(result['notes']) == 8 and checkpoints['new', 'semantic-overview-0']['summary']
    resumed, new_calls, _ = setup(checkpoints=checkpoints, resume='new')
    resumed.dependencies.generate_prose = lambda *_: pytest.fail('paid map repeat')
    assert resumed.run()[0] == result and not new_calls


@pytest.mark.parametrize('invalid', ['   ', '{"summary": "Incomplete"', '```json\n{}\n```'])
def test_prose_maps_do_not_accept_empty_or_broken_json_as_an_argument_map(invalid):
    reader, _, checkpoints = setup()
    reader.dependencies.generate_prose = lambda prompt, validator, timeout: (validator(invalid), 'test-model')
    with pytest.raises(ValueError, match='plain text'):
        reader.run()
    assert not checkpoints['new', 'semantic-state']['maps']


def test_useful_prose_map_above_target_is_retained_without_format_repair():
    reader, _, checkpoints = setup()
    long_map = 'The author qualifies the opponent’s claim; evidence and the conclusion matter. ' * 40
    assert 2000 < token_bound(long_map) < reader.budget // 8
    calls = []
    def prose(prompt, validator, timeout):
        request = json.loads(prompt); calls.append(request)
        assert request['summary_max_tokens'] == 2000
        return validator(response(request)['summary'] if request.get('map_contract') else long_map), 'test-model'
    reader.dependencies.generate_prose = prose
    reader.run()
    assert len(calls) == 4
    assert checkpoints['new', 'semantic-overview-0']['summary'] == long_map.strip()
    assert token_bound(checkpoints['new', 'semantic-state']['global_map']) <= 2000
    assert token_bound(checkpoints['new', 'semantic-state']['notes_map']) <= 2000


def test_prose_map_that_exceeds_reserved_context_capacity_is_not_accepted():
    reader, _, checkpoints = setup()
    reader.dependencies.generate_prose = lambda prompt, validator, timeout: (validator('x' * reader.budget), 'test-model')
    with pytest.raises(ValueError, match='reserved context capacity'):
        reader.run()
    assert not checkpoints['new', 'semantic-state']['maps']


def test_resume_identity_ignores_dictionary_order_and_knowledge_index_order():
    reader, _, checkpoints = setup()
    reader.brain_index = [{'id': 'b', 'title': 'Second'}, {'id': 'a', 'title': 'First'}]
    reader.run()
    resumed, calls, _ = setup(checkpoints=checkpoints, resume='new', generate=lambda _: pytest.fail('paid repeat'))
    resumed.chunks = [dict(reversed(list(c.items()))) for c in resumed.chunks]
    resumed.brain_index = [{'title': 'First', 'id': 'a'}, {'title': 'Second', 'id': 'b'}]
    resumed.run()
    assert not calls


def test_changed_knowledge_context_retains_drafts_but_repeats_every_review():
    reader, _, checkpoints = setup()
    calls = []
    def prose(prompt, validator, timeout):
        calls.append(json.loads(prompt))
        return validator('The author rejects the opponent’s position and preserves qualifications.'), 'test-model'
    reader.dependencies.generate_prose = prose
    reader.run()
    resumed, interpretations, _ = setup(checkpoints=checkpoints, resume='new')
    resumed.brain_index = [{'id': 'new-knowledge', 'title': 'A newly edited idea'}]
    resumed.dependencies.generate_prose = prose
    before = len(calls)
    resumed.run()
    assert all('passages' not in item for request in calls[before:] for item in request['material'] if isinstance(item, dict))
    assert not any(c['phase'] == 'interpret' for c in interpretations)
    reviews = [c for c in interpretations if c['phase'] == 'verify']
    assert sum(len(c['notes']) for c in reviews) == 8
    assert all(c['brain_notes'] == [{**resumed.brain_index[0], 'type': None}] for c in reviews)
    assert len(calls) == before


def test_map_window_truncation_splits_and_resumes_without_repeating_complete_sibling():
    from backend.domains.llm_wiki.semantic_map_windows import MapOutputLimit
    reader, _, checkpoints = setup()
    successful = []
    interrupted = False
    def prose(prompt, validator, timeout):
        nonlocal interrupted
        request = json.loads(prompt); material = request['material']
        if material and isinstance(material[0], dict) and 'passages' in material[0]:
            if len(material) == 8:
                raise MapOutputLimit(True)
            if 'Argument 4:' in material[0]['passages'][0]['text'] and not interrupted:
                interrupted = True
                raise RuntimeError('budget_pause')
            successful.append(material[0]['passages'][0]['text'])
        return validator('The argument develops through opposing positions and a qualified conclusion.'), 'test-model'
    reader.dependencies.generate_prose = prose
    with pytest.raises(RuntimeError, match='budget_pause'):
        reader.run()
    assert len(successful) == 1
    resumed, _, _ = setup(checkpoints=checkpoints, resume='new')
    resumed.dependencies.generate_prose = prose
    result, _ = resumed.run()
    assert len(result['notes']) == 8 and len(successful) == 2
    assert successful[0] != successful[1]


@pytest.mark.parametrize('metadata', [{'finish_reason': 'length'}, {'stop_reason': 'max_tokens'},
                                    {'incomplete_details': {'reason': 'max_output_tokens'}}])
def test_incomplete_prose_is_rejected_even_when_it_looks_like_complete_text(metadata):
    from backend.domains.llm_wiki.semantic_map_windows import ensure_complete, MapOutputLimit
    with pytest.raises(MapOutputLimit):
        ensure_complete('A plausible argument map.', metadata)
    ensure_complete('A complete argument map.', {'finish_reason': 'stop'})
