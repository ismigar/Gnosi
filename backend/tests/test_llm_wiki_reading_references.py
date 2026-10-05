"""Canonical reference spelling never substitutes for literal evidence validation."""
from copy import deepcopy
from types import SimpleNamespace
import json

import pytest

from backend.domains.llm_wiki.reading_contracts import validate_notes, ReadingPlanError
from backend.domains.llm_wiki.reading_references import normalize_action_references
from backend.tests.test_reading_batches import fixture, plan
from backend.tests.test_llm_wiki_reading_runtime import configured  # noqa: F401
from backend.domains.llm_wiki.directed_reading import validate_action, _apply_action


def truncated_fixture():
    reader, chunks, _ = fixture()
    state = {'step': 0, 'read': list(chunks), 'plans': {}, 'memory': 'Earlier argument', 'delivered': list(chunks)}
    answer = {'action': 'save_batch', 'arguments': {'plans': [
        {'chunk_id': key, 'plan': plan(chunk)} for key, chunk in chunks.items()], 'memory': 'Complete global argument'}}
    original = deepcopy(answer)
    for entry in answer['arguments']['plans']:
        for row in entry['plan']['coverage']:
            row['segment_id'] = row['segment_id'].rsplit('-', 1)[0]
        for note in entry['plan']['notes']:
            note['source_segment_id'] = note['source_segment_id'].rsplit('-', 1)[0]
            for citation in note['citations']:
                citation['segment_id'] = citation['segment_id'].rsplit('-', 1)[0]
    return reader, chunks, state, answer, original


def test_whole_batch_restores_digests_without_changing_quotes_memory_or_note_content():
    reader, chunks, state, answer, original = truncated_fixture()
    previous = deepcopy(state)
    validate_action(reader, state, chunks, answer)
    assert answer == original
    assert state == previous
    _apply_action(reader, state, chunks, 'save_batch', answer['arguments'])
    assert len(state['plans']) == 4
    assert normalize_action_references(answer, chunks, state['read']) == 0


@pytest.mark.parametrize('fault', ['changed_quote', 'wrong_digest', 'wrong_origin', 'unread', 'ambiguous'])
def test_normalization_does_not_accept_unverified_evidence(fault):
    _, chunks, state, answer, _ = truncated_fixture()
    chunk = next(iter(chunks.values()))
    primary = chunk['segments']
    note = answer['arguments']['plans'][0]['plan']['notes'][0]
    citation = note['citations'][0]
    if fault == 'changed_quote':
        citation['quote'] += ' Invented qualification.'
    elif fault == 'wrong_digest':
        citation['segment_id'] += '-deadbeef'
    elif fault == 'wrong_origin':
        citation['segment_id'] = 'ffffffffffffffff-s0'
    elif fault == 'unread':
        state['read'].remove(chunk['id'])
    else:
        primary.append({**primary[0], 'id': primary[0]['id'].rsplit('-', 1)[0] + '-deadbeef'})
    normalize_action_references(answer, chunks, state['read'])
    with pytest.raises(ReadingPlanError):
        validate_notes(answer['arguments']['plans'][0]['plan'], primary, primary)


def test_normalized_structured_answer_is_the_persisted_runtime_result(configured, tmp_path):
    from backend.services.llm_wiki_reading_runtime import prepare_reading_runtime
    _, _, execute = configured
    reader, chunks, state, answer, original = truncated_fixture()
    def run(request, **kwargs):
        # The central executor persists exactly what the validator returns.
        canonical = kwargs['output_validator'](json.dumps(answer))
        return SimpleNamespace(result=canonical, model='offline')
    execute.side_effect = run
    runtime = prepare_reading_runtime(tmp_path)
    result, _ = runtime.generate_structured('{}', lambda value: validate_action(reader, state, chunks, value), 120)
    assert json.loads(result) == original
    assert execute.call_count == 1
