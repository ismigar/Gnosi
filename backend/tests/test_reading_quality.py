"""Failures observed after an allegedly successful book must block acceptance."""
from copy import deepcopy

import pytest

from backend.domains.llm_wiki.reading_quality import prose_issues, validate_reviewed_prose
from backend.tests.test_semantic_reading import response, setup
from backend.tests.test_semantic_review_parallel import prepared


@pytest.mark.parametrize('body', ['An idea [[27]].', 'Evidence [[#quote:8]].',
                                 'An idea [^1].', 'Ha viscut 역사적ament.', 'Es 해석과란 mútuament.'])
def test_invalid_generated_prose_is_not_accepted_as_a_reviewed_note(body):
    with pytest.raises(ValueError, match='Reading quality validation failed'):
        validate_reviewed_prose([{'body_md': body}], [{'text': 'Original complete evidence.'}], 'Catalan')


def test_valid_links_defined_footnotes_and_multilingual_originals_are_preserved():
    original = 'The term 한국어 is part of the original.'
    assert not prose_issues({'body_md': '[[A meaningful concept]] [^source].\n\n[^source]: Complete reference.'}, [])
    assert not prose_issues({'body_md': original}, [{'text': original}], 'Catalan')
    assert not prose_issues({'body_md': '한국어로 쓴 글'}, [], 'Korean')


def test_review_sees_full_adjacent_continuation_across_page_boundaries():
    engine, gm, nm, calls, _ = prepared(count=3)
    chunks = engine.reader.chunks
    chunks[0]['segments'][0]['locator'] = {'page': 8}
    chunks[1]['segments'][0]['locator'] = {'page': 9}
    engine.review(gm, nm)
    first = next(c['notes'][0] for c in calls if c['phase'] == 'verify')
    assert any(s['text'] == chunks[1]['segments'][0]['text'] and s['location']['page'] == 9
               for s in first['support'])


def test_unchanged_corrupt_note_cannot_pass_review_or_be_marked_complete():
    engine, gm, nm, calls, checkpoints = prepared(count=2)
    plan = next(iter(engine.state['plans'].values()))
    plan['notes'][0]['body_md'] = 'Not resolved [[42]].'
    with pytest.raises(ValueError, match='Reading quality validation failed'):
        engine.review(gm, nm)
    assert not engine.state.get('completed')
    assert not engine.state['reviewed_groups']
    assert next(c for c in calls if c['phase'] == 'verify')['notes'][0]['validation_issues']


def test_explicit_unresolved_evidence_stops_before_publication():
    def generate(request):
        answer = response(request)
        if request['phase'] == 'verify':
            answer['unresolved_issues'] = ['note_1: the cited conclusion cannot be established from this evidence.']
        return answer
    reader, _, checkpoints = setup(count=2, generate=generate)
    with pytest.raises(RuntimeError, match='reading_quality_unresolved'):
        reader.run()
    state = checkpoints['new', 'semantic-state']
    assert state['plans'] and not state.get('completed') and not state['reviewed_groups']


def test_old_completed_reviews_are_rechecked_without_reinterpreting_paid_sources():
    reader, _, checkpoints = setup(count=2)
    reader.run()
    state = checkpoints['new', 'semantic-state']
    original_plans = deepcopy(state['plans'])
    original_reviews = deepcopy(state['reviewed_groups'])
    state.pop('review_quality_version')
    resumed, calls, _ = setup(count=2, checkpoints=checkpoints, resume='new')
    resumed.run()
    assert all(c['phase'] == 'verify' for c in calls)
    assert checkpoints['new', 'semantic-state']['plans'] == original_plans
    assert checkpoints['new', 'semantic-state']['previous_reviewed_groups'] == original_reviews


def test_generated_notes_do_not_displace_their_original_knowledge_context(monkeypatch):
    from types import SimpleNamespace
    from backend.services import llm_wiki as service
    pages = [SimpleNamespace(id=f'old-{i:03}', title=f'Independent note {i}', metadata={}) for i in range(310)]
    monkeypatch.setattr(service.legacy_ports, 'table_by_id', lambda *_: {})
    monkeypatch.setattr(service.legacy_ports, 'table_pages', lambda *_: pages)
    monkeypatch.setattr(service.llm_wiki_config, 'load_config', lambda: {})
    monkeypatch.setattr(service.llm_wiki_storage, 'page_metadata', lambda p: p.metadata)
    before = service._load_brain_index('brain', 'book')
    pages.extend(SimpleNamespace(id=f'generated-{i}', title=f'Output {i}', metadata={'llm_wiki_resource_id': 'book'}) for i in range(689))
    assert service._load_brain_index('brain', 'book') == before


def test_preflight_prices_revalidation_of_legacy_reviews_at_the_saved_batch_limit():
    from backend.services.reading_semantic_estimate import phase_estimate
    engine, gm, nm, _, _ = prepared(count=8, size=2)
    engine.review(gm, nm)
    engine.deps.instructions = 'Read carefully.'
    state = deepcopy(engine.state)
    state.pop('review_quality_version')
    estimate = phase_estimate(engine.deps, engine.reader.chunks, [], [], state, 4)
    assert estimate['phase_calls']['interpretation'] == 0
    assert estimate['phase_calls']['review'] >= 4
