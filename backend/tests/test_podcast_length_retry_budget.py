"""Length repairs get their existing outer stage, not a spent format-repair deadline."""
import asyncio
import json
from types import SimpleNamespace

import pytest

from backend.services import agent_execution as execution
from backend.services import agent_execution_store as store
from backend.services.agent_execution_scope import execution_scope
from backend.services.podcast_automatic import _bounded_write
from backend.services.podcast_briefing import _Briefing
from backend.tests.test_agent_execution import install_workflow, runtime  # noqa: F401
from backend.tests.test_podcast_word_text import broad_day


@pytest.mark.parametrize('malformed_first', [False, True])
def test_slow_length_rejection_uses_exact_draft_in_fresh_bounded_stage(runtime, monkeypatch, malformed_first):
    scope, snapshot = runtime
    value, rejected = broad_day(2846, groups=30)
    _, accepted = broad_day(1380, groups=30)
    accepted = {'paragraphs': accepted['paragraphs'], 'tokens': accepted['token_text'].split()}
    answers = [json.dumps(rejected), json.dumps(accepted)]
    if malformed_first:
        answers.insert(0, 'not json')
    calls = install_workflow(monkeypatch, answers)
    clock = [0.0]
    real_time = execution.time.time
    monkeypatch.setattr(execution, 'time', SimpleNamespace(time=real_time, monotonic=lambda: clock[0]))
    from backend.agent import factory
    create = factory.create_agent_workflow
    async def timed_workflow(*args, **kwargs):
        application, selection = await create(*args, **kwargs)
        stream = application.astream
        async def timed_stream(*stream_args, **stream_kwargs):
            clock[0] += 1 if malformed_first and not calls else 210
            async for chunk in stream(*stream_args, **stream_kwargs):
                yield chunk
        application.astream = timed_stream
        return application, selection
    monkeypatch.setattr(factory, 'create_agent_workflow', timed_workflow)
    timeout = asyncio.timeout
    deadlines = []
    def capture(seconds):
        deadlines.append(seconds)
        return timeout(seconds)
    monkeypatch.setattr(asyncio, 'timeout', capture)
    requests = []
    class Context(_Briefing):
        def request(self, task, data, contract):
            return super().request(task, data, contract).model_copy(update={'skill_id': snapshot.skill_ids[0]})
        def stage(self, request, validate, **kwargs):
            requests.append(request)
            return super().stage(request, validate, **kwargs)
    context = Context(snapshot, 'Catalan', 80000, lambda text: 1, lambda: None)
    with execution_scope(scope):
        result = _bounded_write(context, value, {'min_words': 1242, 'max_words': 1504, 'target_words': 1380})
        rows = store.list_runs(scope)
    assert len(result['narration'].split()) == 1380
    assert len(calls) == 2 + int(malformed_first)
    assert len(requests) == 2 and all(r.timeout_seconds == 300 and r.max_model_calls == 2 for r in requests)
    assert deadlines == ([300, 299, 300] if malformed_first else [300, 300])
    repair = json.loads(requests[1].input)['data']
    assert repair['previous_composition'] == rejected
    assert repair['length_repair']['current_words'] == 2846
    assert repair['length_repair']['word_delta'] == -1466
    assert repair['composition_groups'] == value['composition_groups']
    assert sorted(row.status for row in rows) == ['completed', 'failed']
    assert all(row.model_calls <= 2 for row in rows)
