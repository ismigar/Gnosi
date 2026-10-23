"""Stateless-model regressions for retention, whole-day coverage and durable retries."""
import copy
import json
from types import SimpleNamespace

import pytest

from backend.services import podcast_briefing as briefing


@pytest.fixture
def pipeline(monkeypatch):
    saved, calls = {}, []
    snapshot = SimpleNamespace(profile={}, instructions=[], behavior_resources={}, origin='button',
                               parent_run_id='day', revision='new-contract', scope='owner')
    monkeypatch.setattr('backend.domains.agent.runtime_tools._model_context_window', lambda *_: 32000)
    monkeypatch.setattr('backend.services.agent_context_budget.count_tokens', lambda text, _: SimpleNamespace(tokens=len(text)))
    def checkpoint(scope, parent, key, value=None):
        assert scope == 'owner' and parent == 'day'
        if value is not None:
            saved[key] = copy.deepcopy(value)
        return copy.deepcopy(saved.get(key))
    monkeypatch.setattr('backend.services.agent_execution_store.work_checkpoint', checkpoint)
    def model(request, **kwargs):
        payload = json.loads(request.input)
        calls.append(payload)
        data = payload['data']
        if payload['task'].endswith('briefs'):
            result = {'briefs': {p['part_id']: {'topic': p['title'],
                'summary': f"{p['title']}: {p['text'][-70:]}", 'quote': p['text'][:60]} for p in data['sources']}}
        else:
            result = {'sections': [{'topic': 'INTERNAL editorial metadata', 'part_ids': [b['part_id']],
                'narration': f"Notícia de {b['title']}: {b['summary']}"} for b in data['briefs']]}
        text = json.dumps(result)
        kwargs['output_validator'](text)
        return SimpleNamespace(result=text)
    monkeypatch.setattr('backend.services.agent_execution.run_sync', model)
    def run(sources, guard=lambda: None):
        return briefing.build_podcast_script(sources, 'Catalan', snapshot=snapshot,
                                             check_active=guard, progress=lambda _: None)
    return SimpleNamespace(run=run, model=model, calls=calls, saved=saved, monkeypatch=monkeypatch)


def diverse_sources():
    return [{'id': str(i), 'title': topic, 'text': f'{topic} original evidence. ' + 'Context ' * 500 + f' Final qualification {topic}.'}
            for i, topic in enumerate(['Habitatge', 'Clima', 'Salut', 'Religió', 'Cultura', 'Treball'])]


def test_stateless_model_sees_all_batches_again_in_final_briefing(pipeline):
    sources = diverse_sources()
    pipeline.saved['document:old-delivery-only'] = {'completed': {'result': {'narration': 'Last two topics'}}}
    narration = pipeline.run(sources)
    extraction = [c['data']['sources'] for c in pipeline.calls if c['task'].endswith('briefs')]
    assert len(extraction) > 1
    delivered = [p for batch in extraction for p in batch]
    for source in sources:
        assert ''.join(p['text'] for p in delivered if p['source_id'] == source['id']) == source['text']
    final = pipeline.calls[-1]['data']['briefs']
    assert {b['part_id'] for b in final} == {p['part_id'] for p in delivered}
    assert {b['source_id'] for b in final} == {s['id'] for s in sources}
    assert all(s['title'] in narration for s in sources)
    assert 'Final qualification Treball.' in narration
    assert 'INTERNAL' not in narration
    report = pipeline.saved['podcast-coverage-report']
    assert len(report['article_ids']) == 6
    assert report['parts'] == len(delivered) == len(final)
    count = len(pipeline.calls)
    assert pipeline.run(sources) == narration
    assert len(pipeline.calls) == count


def test_resume_reuses_validated_briefs_without_losing_early_topics(pipeline):
    def interrupted(request, **kwargs):
        if len(pipeline.calls) == 1:
            raise RuntimeError('interrupted')
        return pipeline.model(request, **kwargs)
    pipeline.monkeypatch.setattr('backend.services.agent_execution.run_sync', interrupted)
    with pytest.raises(RuntimeError, match='interrupted'):
        pipeline.run(diverse_sources())
    first_batch = pipeline.calls[0]['data']['sources']
    pipeline.monkeypatch.setattr('backend.services.agent_execution.run_sync', pipeline.model)
    narration = pipeline.run(diverse_sources())
    assert sum(c['data'].get('sources') == first_batch for c in pipeline.calls) == 1
    assert 'Habitatge' in narration and 'Treball' in narration


@pytest.mark.parametrize('invalid', ['missing', 'foreign', 'empty', 'invented_quote'])
def test_bad_briefs_never_reach_checkpoint_or_narration(pipeline, invalid):
    def model(request, **kwargs):
        part = json.loads(request.input)['data']['sources'][0]
        record = {'topic': 'Topic', 'summary': 'Actual evidence', 'quote': 'Actual evidence'}
        result = {part['part_id']: record}
        if invalid == 'missing':
            result = {}
        elif invalid == 'foreign':
            result['foreign:0'] = record
        elif invalid == 'empty':
            record['summary'] = ' '
        else:
            record['quote'] = 'Invented words'
        return SimpleNamespace(result=json.dumps({'briefs': result}))
    pipeline.monkeypatch.setattr('backend.services.agent_execution.run_sync', model)
    with pytest.raises((ValueError, briefing.jsonschema.ValidationError)):
        pipeline.run([{'id': '1', 'title': 'Title', 'text': 'Actual evidence'}])
    assert pipeline.saved == {}


@pytest.mark.parametrize('ids', [['0:0'], ['0:0', '0:0', '1:0'], ['0:0', 'foreign:0']])
def test_final_sections_cannot_drop_duplicate_or_invent_sources(pipeline, ids):
    def model(request, **kwargs):
        if request.operation.endswith('briefs'):
            return pipeline.model(request, **kwargs)
        return SimpleNamespace(result=json.dumps({'sections': [{'topic': 'Only two themes',
            'part_ids': ids, 'narration': 'Narrow story.'}]}))
    pipeline.monkeypatch.setattr('backend.services.agent_execution.run_sync', model)
    with pytest.raises((ValueError, briefing.jsonschema.ValidationError)):
        pipeline.run([{'id': str(i), 'title': f'Topic {i}', 'text': f'Evidence {i}'} for i in range(2)])
    assert 'podcast-coverage-report' not in pipeline.saved


def test_final_context_overflow_fails_before_any_brief_is_dropped(pipeline):
    def model(request, **kwargs):
        data = json.loads(request.input)['data']
        assert request.operation.endswith('briefs'), 'Oversized final request must not be sent'
        result = {'briefs': {p['part_id']: {'topic': 'Topic', 'summary': 'Long summary ' * 60,
            'quote': p['text']} for p in data['sources']}}
        return SimpleNamespace(result=json.dumps(result))
    pipeline.monkeypatch.setattr('backend.services.agent_execution.run_sync', model)
    with pytest.raises(RuntimeError, match='complete_briefing_context_insufficient'):
        pipeline.run([{'id': str(i), 'title': f'Topic {i}', 'text': f'Evidence {i}'} for i in range(35)])
    assert 'podcast-coverage-report' not in pipeline.saved
    assert len(pipeline.saved) > 1


def test_cancellation_is_checked_even_when_all_briefs_are_cached(pipeline):
    sources = [{'id': '1', 'title': 'Title', 'text': 'Actual evidence'}]
    pipeline.run(sources)
    def cancelled():
        raise PermissionError('scope changed or cancelled')
    with pytest.raises(PermissionError, match='scope changed'):
        pipeline.run(sources, cancelled)
