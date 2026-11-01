"""Independent source calls overlap without losing identity, context or retries."""
import json
from contextvars import ContextVar
from threading import Barrier, Event, Lock

import pytest

from backend.tests.test_podcast_briefing import pipeline  # noqa: F401


def test_brief_preparation_overlaps_four_calls_and_preserves_source_order_and_cache(pipeline):
    pipeline.snapshot.skill_instructions = {}
    marker = ContextVar('podcast_test_scope', default='missing')
    marker.set('authorized-vault')
    barrier, last_finished, lock = Barrier(4), Event(), Lock()
    active = peak = 0
    sources = [{'id': str(i), 'title': f'Topic {i}', 'text': f'Evidence {i}.'} for i in range(40)]

    def model(request, **kwargs):
        nonlocal active, peak
        if not request.operation.endswith('briefs'):
            return pipeline.model(request, **kwargs)
        assert marker.get() == 'authorized-vault'
        batch = json.loads(request.input)['data']['sources']
        with lock:
            active += 1
            peak = max(peak, active)
        if int(batch[0]['source_id']) < 32:
            barrier.wait(timeout=5)
        if batch[0]['source_id'] == '0':
            assert last_finished.wait(timeout=5)
        result = pipeline.model(request, **kwargs)
        if batch[0]['source_id'] == '24':
            last_finished.set()
        with lock:
            active -= 1
        return result

    pipeline.monkeypatch.setattr('backend.services.agent_execution.run_sync', model)
    pipeline.run(sources)
    report = pipeline.saved['podcast-coverage-report']
    assert peak == 4
    assert [b['source_id'] for b in report['briefs']] == [s['id'] for s in sources]
    assert report['parts'] == 40
    assert len([c for c in pipeline.calls if c['task'].endswith('briefs')]) == 5
    # Identical persisted requests are reused rather than duplicated on resume.
    pipeline.monkeypatch.setattr('backend.services.agent_execution.run_sync',
                                lambda *a, **k: pytest.fail('Cached source was regenerated'))
    pipeline.run(sources)


def test_preparation_failure_keeps_successful_batches_but_cannot_publish(pipeline):
    pipeline.snapshot.skill_instructions = {}
    barrier = Barrier(2)
    sources = [{'id': str(i), 'title': f'Topic {i}', 'text': f'Evidence {i}.'} for i in range(16)]
    def model(request, **kwargs):
        if request.operation.endswith('briefs'):
            batch = json.loads(request.input)['data']['sources']
            barrier.wait(timeout=5)
            if batch[0]['source_id'] == '0':
                raise ValueError('provider unavailable')
        return pipeline.model(request, **kwargs)
    pipeline.monkeypatch.setattr('backend.services.agent_execution.run_sync', model)
    with pytest.raises(ValueError, match='provider unavailable'):
        pipeline.run(sources)
    assert 'podcast-coverage-report' not in pipeline.saved
    assert not any(c['task'].endswith('write') for c in pipeline.calls)
    # A failed sibling does not erase the other batch's valid checkpoint.
    assert len(pipeline.saved) == 1


def test_cancelled_preparation_never_calls_model(pipeline):
    pipeline.snapshot.skill_instructions = {}
    pipeline.monkeypatch.setattr('backend.services.agent_execution.run_sync',
                                lambda *a, **k: pytest.fail('Cancelled call started'))
    def cancelled():
        raise PermissionError('vault access revoked')
    with pytest.raises(PermissionError, match='vault access revoked'):
        pipeline.run([{'id': '1', 'title': 'Source', 'text': 'Evidence.'}], cancelled)
