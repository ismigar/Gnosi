"""Repeated words keep their selected source through interpretation and repair."""
from copy import deepcopy
import json

import pytest

from backend.domains.llm_wiki.chunking import encoded
from backend.domains.llm_wiki.semantic_context import source_view
from backend.domains.llm_wiki.semantic_contracts import bind_interpretation
from backend.domains.llm_wiki.semantic_quote_contracts import select_note, source_key
from backend.domains.llm_wiki.semantic_quote_selection import quote_selection
from backend.tests.test_semantic_quote_repair import repair_case, selected_answer


def repeated_context():
    reader, primary, request, answer, _, _ = repair_case()
    context = [
        {'id': 'continuation', 'text': 'of lasting hope. Its meaning is qualified.', 'locator': {'page': 2}, 'origin_label': 'Book'},
        {'id': 'later', 'text': 'Another argument speaks of lasting hope.', 'locator': {'page': 3}, 'origin_label': 'Book'},
    ]
    request['neighbours'] = [source_view(s) for s in context]
    selection = quote_selection(request)
    assert selection is not None
    payload = json.loads(selection.input)
    wire = selected_answer(answer, payload)
    number = next(q['quote_id'] for s in payload['source_quotes'] for q in s['quotes'] if q['text'] == 'of lasting hope.')
    wire['passages']['passage_1']['notes'][0]['context_quote_ids'] = [number]
    return reader, primary, context, selection, wire


def test_first_interpretation_preserves_selected_context_despite_repeated_substring():
    reader, primary, context, selection, wire = repeated_context()
    restored = json.loads(selection.restore(encoded(wire)))
    plans = bind_interpretation(restored, reader.chunks, [*primary, *context], [])
    citation = plans[reader.chunks[0]['id']]['notes'][0]['citations'][-1]
    assert citation == {'segment_id': 'continuation', 'quote': 'of lasting hope.'}
    assert 'quote_source_keys' not in encoded(selection.schema)
    note = restored['passages'][0]['notes'][0]
    assert select_note(note, selection.quotes, selection.primary_ids[0], selection.quote_sources) == wire['passages']['passage_1']['notes'][0]
    # A literal cache without provenance remains ambiguous and must not guess.
    note.pop('quote_source_keys')
    with pytest.raises(ValueError, match='identify one source passage'):
        bind_interpretation(restored, reader.chunks, [*primary, *context], [])


def test_interpretation_provenance_cannot_replace_primary_or_accept_changed_evidence():
    reader, primary, context, selection, wire = repeated_context()
    restored = json.loads(selection.restore(encoded(wire)))
    broken = deepcopy(restored)
    broken['passages'][0]['notes'][0]['quote_source_keys'][-1] = source_key(source_view(context[1]))
    # The selected literal happens to occur in both passages, but a changed
    # source cannot be substituted during transport restoration or cache reuse.
    with pytest.raises(ValueError, match='absent from the operation'):
        select_note(broken['passages'][0]['notes'][0], selection.quotes, selection.primary_ids[0], selection.quote_sources)
    context[0]['text'] = 'Edited source with no matching evidence.'
    with pytest.raises(ValueError, match='identify one source passage'):
        bind_interpretation(restored, reader.chunks, [*primary, *context], [])
