"""A large configured context avoids unnecessary synthesis calls without losing sources."""
import json
from collections import Counter
from threading import Lock
from types import SimpleNamespace

import pytest

from backend.services.agent_behavior import operation_input
from backend.tests.test_podcast_briefing import pipeline, written  # noqa: F401


@pytest.mark.parametrize('mode', ['brief', 'full'])
def test_complete_day_uses_available_context_but_full_mode_retains_legacy_cap(pipeline, mode):
    pipeline.snapshot.skill_instructions = {'core.gnosi-daily-briefing':
        '```json\n' + json.dumps({'podcast_preferences': {'review_mode': mode}}) + '\n```'}
    pipeline.monkeypatch.setattr('backend.domains.agent.runtime_tools._model_context_window',
                                lambda *_: 1_050_000)
    sources = [{'id': str(i), 'title': f'Topic{i}',
                'text': f'Topic{i} remains provisional. ' + 'Evidence ' * 70} for i in range(225)]
    calls, costs, supplied, lock = Counter(), {}, {}, Lock()
    def model(request, **kwargs):
        phase = request.operation.rsplit('.', 1)[-1]
        data = json.loads(request.input)['data']
        with lock:
            calls[phase] += 1
            costs.setdefault(phase, []).append(len(operation_input(request)))
            if phase in {'plan', 'write', 'audit'}:
                supplied.setdefault(phase, []).append(data)
        if phase == 'briefs':
            result = {'briefs': {p['part_id']: {'topic': p['title'],
                'summary': p['text'][:390], 'quote': p['text'][-120:]} for p in data['sources']}}
        elif phase == 'write':
            text = ' '.join(f"{s['title']} remains provisional." for s in sources)
            text += ' Context.' * (request.options['target_words'] - len(text.split()))
            result = written(request, text)
        else:
            return pipeline.model(request, **kwargs)
        text = json.dumps(result)
        kwargs['output_validator'](text)
        return SimpleNamespace(result=text)
    pipeline.monkeypatch.setattr('backend.services.agent_execution.run_sync', model)
    script = pipeline.run(sources)
    report = pipeline.saved['podcast-coverage-report']
    assert report['article_ids'] == sorted(s['id'] for s in sources)
    assert report['parts'] == len(report['briefs']) == 225
    assert all(s['title'] in script for s in sources)
    assert 1242 <= len(script.split()) <= 1504
    assert calls['write'] == 1
    if mode == 'brief':
        assert calls['plan'] == calls['audit'] == 1
        assert calls['digest'] == 0
        # All three complete requests exceed the former arbitrary cap, while
        # remaining within the configured window after its existing reserve.
        assert all(80_000 < costs[phase][0] < 785_452 for phase in ('plan', 'write', 'audit'))
        assert len(supplied['plan'][0]['cards']) == 225
        assert len(supplied['write'][0]['briefs']) == 225
        assert len(supplied['audit'][0]['source_summaries']) == 225
    else:
        assert calls['plan'] > 1 and calls['digest'] > 0 and calls['audit'] > 1


def test_small_context_still_rejects_an_oversized_synthesis_before_model_call(pipeline):
    from backend.services.podcast_briefing import _Briefing
    pipeline.snapshot.skill_instructions = {}
    context = _Briefing(pipeline.snapshot, 'Catalan', 9000, len, lambda: None)
    request = context.request('podcast.coverage.write', {'evidence': 'x' * 10000},
                              {'type': 'object'})
    pipeline.monkeypatch.setattr('backend.services.agent_execution.run_sync',
                                lambda *a, **k: pytest.fail('Exceeded model context'))
    with pytest.raises(RuntimeError, match='context_insufficient'):
        context.stage(request, lambda _: None)
