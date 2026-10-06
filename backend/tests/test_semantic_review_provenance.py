"""Selected review citations keep their exact source through binding and resume."""
from copy import deepcopy
import json

import pytest

from backend.tests.test_agent_execution import runtime as runtime

from backend.domains.llm_wiki.chunking import encoded
from backend.domains.llm_wiki.semantic_context import source_view
from backend.domains.llm_wiki.semantic_contracts import bind_review, review_schema
from backend.domains.llm_wiki.semantic_quote_selection import quote_selection
from backend.tests.test_semantic_review_parallel import prepared


def review_case():
    segments = [{'id': str(i), 'text': text, 'locator': {'page': i}, 'origin_label': 'Book'}
                for i, text in enumerate(['The first claim. Shared caution.',
                                         'The second claim. Shared caution.',
                                         'The third claim. Shared caution.'])]
    notes = [{'title': f'Claim {i}', 'body_md': s['text'], 'source_segment_id': s['id'],
              'citations': [{'segment_id': s['id'], 'quote': s['text']}], 'dimensions': {}}
             for i, s in enumerate(segments)]
    request = {'reading_engine': 'semantic', 'phase': 'verify', 'output_schema': review_schema(3, []),
               'notes': [{'note': {}, 'primary': source_view(s), 'support': []} for s in segments],
               'retrieved_originals': []}
    selection = quote_selection(request)
    catalog = json.loads(selection.input)['source_quotes']
    replacement = {'title': 'Qualified claim', 'body_md': 'The first claim is qualified by the second.',
                   'properties': {}, 'primary_quote_ids': [catalog[0]['quotes'][0]['quote_id']],
                   'context_quote_ids': [catalog[1]['quotes'][1]['quote_id']]}
    raw = {'assessment': 'Checked attribution.', 'changes': {'note_1': replacement, 'note_2': None, 'note_3': None},
           'warnings': []}
    targets = [(n, s, segments) for n, s in zip(notes, segments, strict=True)]
    return selection, raw, targets


def test_repeated_literal_is_bound_to_selected_context_even_when_it_occurs_in_primary():
    selection, raw, targets = review_case()
    answer = json.loads(selection.restore(encoded(raw)))
    result = bind_review(answer, targets, [])
    assert result[0]['citations'] == [
        {'segment_id': '0', 'quote': 'The first claim.'},
        {'segment_id': '1', 'quote': ' Shared caution.'}]
    assert result[1:] == [t[0] for t in targets[1:]]
    assert bind_review(json.loads(encoded(answer)), targets, []) == result
    assert 'quote_source_keys' not in encoded(selection.schema)


@pytest.mark.parametrize('fault', ['unknown_source', 'wrong_text', 'missing_source', 'misaligned_sources', 'primary_replaced'])
def test_provenance_never_weakens_literal_or_primary_validation(fault):
    selection, raw, targets = review_case()
    answer = json.loads(selection.restore(encoded(raw)))
    note = answer['changes'][0]['replacement']
    if fault == 'unknown_source':
        note['quote_source_keys'][1] = 'unknown'
    elif fault == 'wrong_text':
        note['quotes'][1] = 'Invented evidence.'
    elif fault == 'missing_source':
        targets = [(n, p, [targets[0][1]]) for n, p, _ in targets]
    elif fault == 'misaligned_sources':
        note['quote_source_keys'].pop()
    else:
        note['quotes'][0] = note['quotes'][1]
        note['quote_source_keys'][0] = note['quote_source_keys'][1]
    with pytest.raises(ValueError):
        bind_review(answer, targets, [])


def test_old_unambiguous_review_checkpoints_remain_valid_but_ambiguous_quotes_fail():
    selection, raw, targets = review_case()
    answer = json.loads(selection.restore(encoded(raw)))
    note = answer['changes'][0]['replacement']
    note.pop('quote_source_keys')
    note['quotes'] = ['The first claim.']
    assert bind_review(answer, targets, [])[0]['citations'][0]['segment_id'] == '0'
    targets[0][1]['text'] = 'The first claim.'
    note['quotes'].append('Shared caution.')
    with pytest.raises(ValueError, match='identify one source passage'):
        bind_review(answer, targets, [])


def test_shared_batch_originals_are_validated_persisted_and_reused_without_another_call(monkeypatch):
    from backend.domains.llm_wiki import semantic_review_execution as execution
    engine, gm, nm, _, checkpoints = prepared(count=4, size=2)
    original = deepcopy(engine.state['plans'])
    monkeypatch.setattr(execution, 'relevant', lambda *args, **kwargs: [])
    calls = []
    def generate(prompt, validator, timeout):
        request = json.loads(prompt)
        selection = quote_selection(request)
        first = request['notes'][0]['note']
        value = {k: v for k, v in first.items() if k != 'quotes'}
        value.update(primary_quote_ids=[selection.primary_ids[0][0]],
                     context_quote_ids=[selection.primary_ids[1][0]])
        answer = selection.restore(encoded({'assessment': 'Cross-checked.',
            'changes': {'note_1': value, 'note_2': None}, 'warnings': [], 'unresolved_issues': []}))
        validator(json.loads(answer))
        calls.append(request)
        return answer, 'offline'
    engine.deps.generate_structured = generate
    result = engine.review(gm, nm)
    assert len(calls) == 2 and engine.state['plans'] == original
    for index in [0, 2]:
        plan = result[index][1]
        cited = plan['notes'][0]['citations']
        assert cited[1]['segment_id'] == result[index + 1][0]['segments'][0]['id']
        assert any(s['id'] == cited[1]['segment_id'] for s in plan['evidence_segments'])
    engine.deps.generate_structured = lambda *args: pytest.fail('repeat paid review')
    assert engine.review(gm, nm) == result
    assert len(checkpoints['new', 'semantic-state']['reviewed_groups']) == 2


def test_legacy_cache_keeps_its_original_evidence_scope_when_batch_context_expands():
    selection, raw, targets = review_case()
    answer = json.loads(selection.restore(encoded(raw)))
    note = answer['changes'][0]['replacement']
    note.pop('quote_source_keys')
    targets[0][1]['text'] = 'The first claim.'
    original = [(n, p, sources[:2]) for n, p, sources in targets]
    result = bind_review(answer, original, [], shared_evidence=targets[0][2])
    assert result[0]['citations'][1]['segment_id'] == '1'


@pytest.mark.parametrize('incomplete', [
    '{"assessment":"A partial assessment...',
    '{',
    '{"assessment":"Checked","changes":{',
    '{"assessment":"' + 'A qualified assessment. ' * 250,
])
def test_incomplete_review_stops_first_call_for_bounded_split(runtime, monkeypatch, incomplete):
    from dataclasses import replace
    from backend.services import agent_execution as execution
    from backend.services.agent_execution_scope import execution_scope
    from backend.services.llm_wiki_reading_runtime import ReadingRuntime
    from backend.domains.llm_wiki.reading_batch_recovery import IncompleteReadingBatch
    from backend.tests.test_agent_execution import install_workflow
    from backend.domains.llm_wiki.reading_skill import SKILL_ID
    from backend.services.agent_skill_catalog import resolve_agent_runtime
    _, _, targets = review_case()
    request = {'reading_engine': 'semantic', 'phase': 'verify', 'output_schema': review_schema(3, []),
               'notes': [{'note': {}, 'primary': source_view(p), 'support': []} for _, p, _ in targets]}
    calls = install_workflow(monkeypatch, [incomplete])
    scope, snapshot = runtime
    resolved = resolve_agent_runtime({})
    snapshot.skill_ids.append(SKILL_ID)
    monkeypatch.setattr('backend.services.agent_skill_catalog.resolve_agent_runtime', lambda *args, **kwargs:
        replace(resolved, active_skill_ids=tuple(snapshot.skill_ids)))
    with execution_scope(scope):
        frozen = execution.create_job_run(snapshot, 'incomplete-review-job', 'knowledge.process-source')
        reader = ReadingRuntime(snapshot.agent_id, 'test', 'fake', '', 1_000_000, frozen)
        with pytest.raises(IncompleteReadingBatch):
            reader.generate_structured(encoded(request), lambda _: None, 240)
    assert len(calls) == 1


@pytest.mark.parametrize('message,phase,expected', [
    ('Unterminated string starting at: line 1 column 15 (char 14)', 'verify', 2),
    ('Unterminated string starting at: line 1 column 15 (char 14)', 'interpret', 4),
    ('Quote must occur verbatim', 'verify', 4),
    ('reading_budget_pending_cost', 'verify', 4),
])
def test_resume_of_legacy_incomplete_review_reduces_only_known_failed_phase(message, phase, expected):
    from backend.domains.llm_wiki.semantic_reading import SemanticReader
    from backend.tests.test_semantic_reading import setup
    engine, _, _, _, checkpoints = prepared(count=8, size=4)
    engine.state['last_action'] = {'phase': phase}
    engine.save()
    previous = deepcopy(checkpoints['new', 'semantic-state'])
    reader, _, _ = setup(count=8, checkpoints=checkpoints, resume='new')
    reader.dependencies.resume_job_status = lambda _: {'error': message}
    resumed = SemanticReader(reader)
    assert resumed.state['review_size_limit'] == expected
    assert resumed.state['plans'] == previous['plans']


def test_repeated_incomplete_review_halves_to_one_and_stops_without_publishing(monkeypatch):
    from backend.domains.llm_wiki import semantic_review_execution as execution
    from backend.domains.llm_wiki.reading_batch_recovery import IncompleteReadingBatch
    engine, gm, nm, _, checkpoints = prepared(count=4, size=4)
    monkeypatch.setattr(execution, 'REVIEW_WORKERS', 1)
    sizes = []
    def incomplete(prompt, *args):
        sizes.append(len(json.loads(prompt)['notes']))
        raise IncompleteReadingBatch()
    engine.deps.generate_structured = incomplete
    with pytest.raises(IncompleteReadingBatch):
        engine.review(gm, nm)
    assert sizes == [4, 2, 1]
    assert not checkpoints['new', 'semantic-state']['reviewed_groups']
    assert not checkpoints['new', 'semantic-state'].get('completed')


def test_odd_batch_split_does_not_cross_a_later_saved_review_range():
    from backend.domains.llm_wiki.reading_batch_recovery import IncompleteReadingBatch
    from backend.tests.test_semantic_reading import response
    reviews = []
    def generate(request):
        if request['phase'] == 'verify':
            titles = [n['note']['title'] for n in request['notes']]
            reviews.append(titles)
            if len(titles) == 5 and 'Argument 0:' in titles[0]:
                raise IncompleteReadingBatch()
        return response(request)
    engine, gm, nm, _, checkpoints = prepared(generate, count=10, size=5)
    assert len(engine.review(gm, nm)) == 10
    assert sorted(map(len, reviews)) == [1, 2, 2, 5, 5]
    assert sum('Argument 5:' in title for batch in reviews for title in batch) == 1
    assert checkpoints['new', 'semantic-state']['reviewed_ranges'] == {'0': 2, '2': 2, '4': 1, '5': 5}


@pytest.mark.parametrize('invalid', ['', 'Provider unavailable', '{"assessment":"ok" "changes":{}}'])
def test_unrelated_invalid_output_keeps_normal_repair_instead_of_incomplete_split(invalid):
    from types import SimpleNamespace
    from backend.services.llm_wiki_reading_runtime import ReadingRuntime
    selection, _, _ = review_case()
    with pytest.raises(json.JSONDecodeError) as error:
        json.loads(invalid)
    runtime = ReadingRuntime('test', 'test', 'fake', '', 1_000_000, SimpleNamespace(behavior_resources=True))
    assert runtime._repair_structured('', {'reading_engine': 'semantic'}, selection, lambda _: None, invalid, error.value) is None
