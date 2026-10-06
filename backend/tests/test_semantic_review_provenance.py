"""Selected review citations keep their exact source through binding and resume."""
from copy import deepcopy
import json

import pytest

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
            'changes': {'note_1': value, 'note_2': None}, 'warnings': []}))
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
