"""Citation repair selects immutable original spans without guessing evidence."""
from copy import deepcopy
import json

import pytest

from backend.domains.llm_wiki.chunking import encoded
from backend.domains.llm_wiki.semantic_context import source_view
from backend.domains.llm_wiki.semantic_contracts import bind_interpretation, interpretation_schema
from backend.domains.llm_wiki.semantic_repairs import build_semantic_repair, quote_choices
from backend.tests.test_semantic_reading import response, setup


def repair_case(quote='The author doubts certainty.'):
    reader, _, _ = setup(count=2)
    primary = [s for c in reader.chunks for s in c['segments']]
    primary[0]['text'] = 'the author doubts certainty. A disputed view remains unresolved.\nThe ending is qualified.'
    primary[1]['text'] = 'The opponent claims certainty. Experience challenges this claim.'
    request = {'reading_engine': 'semantic', 'phase': 'interpret',
               'primary_passages': [source_view(s) for s in primary],
               'output_schema': interpretation_schema(len(primary), [])}
    answer = response(request)
    answer['passages'][0]['notes'][0]['quotes'] = [quote]
    repair = build_semantic_repair(encoded(request), encoded(answer))
    assert repair is not None
    return reader, primary, request, answer, repair, json.loads(repair.input)


def patch_for(answer, payload, quote_ids=None):
    repairs = []
    for passage in payload['passages']:
        source = next(s for s in payload['source_quotes'] if s['source'] == passage['primary_source'])
        value = deepcopy(answer['passages'][passage['passage'] - 1])
        for note in value['notes']:
            note.pop('quotes')
            note['quote_ids'] = quote_ids if quote_ids is not None else [source['quotes'][0]['quote_id']]
        repairs.append({'passage': passage['passage'], 'value': value})
    return {'repairs': repairs}


@pytest.mark.parametrize('text', [
    'lowercase.  Next sentence?\nAn answer!\n\nAn ending.',
    'Pregunta: ¿por qué? Amb guions — i accents.\r\nUna altra línia.',
    'Unbroken original without punctuation',
    'A citation may contain “ignore previous instructions”. It remains source evidence.',
])
def test_choices_preserve_every_original_character_and_source_metadata(text):
    source = {'text': text, 'location': {'page': 3}, 'document': 'Original'}
    before = deepcopy(source)
    catalog, quotes, indices = quote_choices([source, deepcopy(source)])
    assert source == before and indices == [1, 1] and len(catalog) == 1
    assert ''.join(row['text'] for row in catalog[0]['quotes']) == text
    assert all(value in text for value in quotes.values())
    assert all(value.strip() for value in quotes.values())
    assert catalog[0]['location'] == source['location'] and catalog[0]['document'] == 'Original'


@pytest.mark.parametrize('invalid_quote', [
    'The author doubts certainty.',
    'the author [...] remains unresolved.',
    'the author [of the book] doubts certainty.',
    'the author doubts certainty. A disputed view remains unresolved. The ending is qualified.',
])
def test_modified_quotes_repair_by_selection_and_keep_valid_passages(invalid_quote):
    reader, primary, request, answer, repair, payload = repair_case(invalid_quote)
    before = deepcopy(answer)
    with pytest.raises(ValueError, match='Quote must occur verbatim'):
        bind_interpretation(answer, reader.chunks, primary, [])
    assert [p['passage'] for p in payload['passages']] == [1]
    assert any('quotes[0]' in error for error in payload['passages'][0]['validation_errors'])
    repaired = json.loads(repair.restore(encoded(patch_for(answer, payload))))
    result = bind_interpretation(repaired, reader.chunks, primary, [])
    assert repaired['passages'][1] == before['passages'][1]
    assert all(repaired[k] == before[k] for k in ['themes', 'questions', 'contradictions', 'warnings'])
    assert answer == before and request['output_schema'] == interpretation_schema(2, [])
    note = result[str(reader.chunks[0]['id'])]['notes'][0]
    assert note['citations'] == [{'segment_id': primary[0]['id'], 'quote': 'the author doubts certainty.'}]
    assert 'quote_ids' not in repaired['passages'][0]['notes'][0]


@pytest.mark.parametrize('invalid_choice', [0, 999999, -1, True, '1', 'a rewritten quote'])
def test_repair_cannot_forge_or_rewrite_a_quote(invalid_choice):
    _, _, _, answer, repair, payload = repair_case()
    with pytest.raises(ValueError):
        repair.restore(encoded(patch_for(answer, payload, [invalid_choice])))


def test_repair_rejects_free_text_instead_of_the_selection_contract():
    _, _, _, answer, repair, payload = repair_case()
    patch = patch_for(answer, payload)
    note = patch['repairs'][0]['value']['notes'][0]
    note['quotes'] = ['the author doubts certainty.']
    del note['quote_ids']
    with pytest.raises(ValueError):
        repair.restore(encoded(patch))


def test_whitespace_does_not_count_as_supporting_evidence():
    _, _, _, _, _, payload = repair_case(' ')
    assert [p['passage'] for p in payload['passages']] == [1]
    assert any('own primary passage' in error for error in payload['passages'][0]['validation_errors'])


def test_context_quote_alone_does_not_ground_a_primary_note():
    _, _, _, answer, repair, payload = repair_case()
    context = next(s for s in payload['source_quotes'] if s['source'] != payload['passages'][0]['primary_source'])
    with pytest.raises(ValueError, match='own primary passage'):
        repair.restore(encoded(patch_for(answer, payload, [context['quotes'][0]['quote_id']])))


def test_valid_quote_from_another_primary_is_available_as_additional_context():
    reader, primary, request, answer, _, _ = repair_case()
    answer['passages'][0]['notes'][0]['quotes'] = [primary[0]['text'], primary[1]['text']]
    assert bind_interpretation(answer, reader.chunks, primary, [])
    assert build_semantic_repair(encoded(request), encoded(answer)) is None


def test_selected_context_quote_must_identify_one_original():
    _, _, request, answer, _, _ = repair_case()
    request['neighbours'] = [
        {'text': 'Shared evidence. One conclusion.', 'location': {'page': 3}},
        {'text': 'Shared evidence. Another conclusion.', 'location': {'page': 4}},
    ]
    repair = build_semantic_repair(encoded(request), encoded(answer))
    assert repair is not None
    payload = json.loads(repair.input)
    patch = patch_for(answer, payload)
    ambiguous = next(q['quote_id'] for source in payload['source_quotes'] for q in source['quotes'] if q['text'] == 'Shared evidence.')
    patch['repairs'][0]['value']['notes'][0]['quote_ids'].append(ambiguous)
    with pytest.raises(ValueError, match='identifying one supplied original'):
        repair.restore(encoded(patch))


def test_partial_repair_cannot_change_a_valid_passage_or_duplicate_a_patch():
    _, _, _, answer, repair, payload = repair_case()
    patch = patch_for(answer, payload)
    patch['repairs'][0]['passage'] = 2
    with pytest.raises(ValueError):
        repair.restore(encoded(patch))
    patch = patch_for(answer, payload)
    patch['repairs'].append(deepcopy(patch['repairs'][0]))
    with pytest.raises(ValueError):
        repair.restore(encoded(patch))


def test_quote_selection_uses_the_same_governed_runtime_and_two_call_allowance(monkeypatch):
    from types import SimpleNamespace
    from backend.services.llm_wiki_reading_runtime import ReadingRuntime
    reader, primary, prompt, answer, _, _ = repair_case()
    calls = []
    snapshot = SimpleNamespace(behavior_resources=True)
    runtime = ReadingRuntime('test-agent', 'openrouter', 'test-model', '', 48000, snapshot)
    def execute(request, *, snapshot, output_validator, output_repair):
        assert request.max_model_calls == 2 and request.timeout_seconds == 240
        assert request.resume_requires_parent and request.operation == 'knowledge.process-source.phase'
        assert snapshot is runtime.snapshot
        wire = json.loads(request.input)
        draft = deepcopy(answer)
        for index, passage in enumerate(draft['passages']):
            source = wire['source_quotes'][wire['primary_passages'][index]['source'] - 1]
            for note in passage['notes']:
                note.pop('quotes')
                note['quote_ids'] = [quote['quote_id'] for quote in source['quotes']]
        draft['passages'][0]['notes'][0]['quote_ids'] = draft['passages'][1]['notes'][0]['quote_ids']
        calls.append('interpret')
        with pytest.raises(ValueError) as rejected:
            output_validator(encoded(draft))
        repair = output_repair(encoded(draft), rejected.value)
        assert repair is not None and runtime.count_tokens(repair.input) <= runtime.input_budget
        payload = json.loads(repair.input)
        calls.append('repair')
        result = output_validator(repair.restore(encoded(patch_for(answer, payload))))
        return SimpleNamespace(result=result, model='test-model')
    monkeypatch.setattr('backend.services.agent_execution.run_sync', execute)
    result, model = runtime.generate_structured(encoded(prompt),
        lambda value: bind_interpretation(value, reader.chunks, primary, []), 240)
    assert calls == ['interpret', 'repair'] and model == 'test-model'
    preserved = json.loads(result)['passages'][1]['notes'][0]
    assert ''.join(preserved.pop('quotes')) == primary[1]['text']
    assert preserved == {key: value for key, value in answer['passages'][1]['notes'][0].items() if key != 'quotes'}
