"""Large context windows must not cause every batch to reread auxiliary material."""
from copy import deepcopy

import pytest

from backend.domains.llm_wiki.chunking import encoded
from backend.domains.llm_wiki.semantic_context import reading_context, relevant, auxiliary_limit
from backend.services.llm_wiki_reading_runtime import token_bound


@pytest.mark.parametrize('budget', [48000, 390000])
def test_navigation_is_bounded_but_original_passages_and_neighbours_remain_complete(budget):
    primary = {'id': 'primary', 'text': 'Rarequalification knowledge requires experience.', 'locator': {}}
    neighbour = {'id': 'neighbour', 'text': 'A qualification. ' * 700, 'locator': {}}
    distant = {'id': 'distant', 'text': 'Rarequalification disputes certainty, but preserves experience.', 'locator': {}}
    selected = [{'id': 'first', 'segments': [primary], 'context_segments': [neighbour]}]
    chunks = [*selected, {'id': 'last', 'segments': [distant]}]
    chunks.extend({'id': str(i), 'segments': [{'id': str(i), 'text': 'Knowledge experience. ' * 60,
                                               'locator': {}}]} for i in range(80))
    plans = {str(i): {'notes': [{'title': 'Knowledge', 'body_md': 'Experience knowledge. ' * 30}]}
             for i in range(80)}
    original = deepcopy(chunks)
    context = reading_context(chunks, selected, plans, token_bound, budget)
    assert chunks == original
    assert context['neighbours'][0]['text'] == neighbour['text']
    assert any(row['text'] == distant['text'] for row in context['retrieved_originals'])
    assert token_bound(encoded(context['retrieved_originals'])) <= min(budget // 10, 8000)
    assert token_bound(encoded(context['related_notes'])) <= min(budget // 12, 6000)
    assert len(context['retrieved_originals']) < 81
    assert context['evidence'][0]['text'] == primary['text']
    for supplied in context['retrieved_originals']:
        assert any(supplied['text'] == segment['text'] for chunk in original for segment in chunk['segments'])


def test_observation_retrieval_remains_bounded_as_saved_reading_grows():
    observations = [{'text': 'Experience qualification. ' * 50} for _ in range(200)]
    selected = relevant(observations, 'Experience qualification', token_bound,
                        auxiliary_limit(390000, 20, 4000))
    assert selected and token_bound(encoded(selected)) <= 4000
    assert all(row in observations for row in selected)
