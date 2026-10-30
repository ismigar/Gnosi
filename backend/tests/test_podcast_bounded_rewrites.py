"""Actual length failures are repaired under a bounded schema, not word-count guesses."""
import copy
import json

import jsonschema
import pytest

from backend.services import agent_execution_store as store
from backend.services.agent_execution_scope import execution_scope
from backend.services.podcast_automatic import _bounded_write
from backend.services.podcast_briefing import _Briefing
from backend.tests.test_agent_execution import install_workflow, runtime  # noqa: F401
from backend.tests.test_podcast_word_text import broad_day


def counted_workflow(monkeypatch, answers):
    from backend.agent import factory, model_router
    from backend.services import agent_execution
    calls = install_workflow(monkeypatch, answers)
    original = factory.create_agent_workflow
    async def create(*args, **kwargs):
        app, selection = await original(*args, **kwargs)
        stream = app.astream
        async def counted(*stream_args, **stream_kwargs):
            agent_execution.before_model_call()
            async for chunk in stream(*stream_args, **stream_kwargs):
                yield chunk
        app.astream = counted
        return app, selection
    monkeypatch.setattr(factory, 'create_agent_workflow', create)
    monkeypatch.setattr(model_router, 'budget_status', lambda: {'over_cap': False})
    return calls


def stream(words):
    _, value = broad_day(words, groups=11)
    return {'paragraphs': value['paragraphs'], 'tokens': value['token_text'].split()}


def correction():
    value, _ = broad_day(1380, groups=11)
    return {**{k: v for k, v in value.items() if k != 'composition_encoding'},
        'briefs': [{'part_id': f'source:{i}', 'summary': 'A supported qualified claim.'} for i in range(239)],
        'subject_groups': [{'topic': f'Subject {i}', 'subjects': [f'Subject {i}']} for i in range(11)],
        'previous_draft': 'The exact previously reviewed episode.',
        'feedback': [{'kind': 'omission', 'detail': 'Include a supported missing development.',
                      'source_part_ids': ['source:238']}]}


def context_for(snapshot):
    class Context(_Briefing):
        def request(self, task, data, contract):
            return super().request(task, data, contract).model_copy(update={'skill_id': snapshot.skill_ids[0]})
        def stage(self, request, validate, **kwargs):
            self.requests.append(request)
            return super().stage(request, validate, **kwargs)
    context = Context(snapshot, 'Catalan', 800000, lambda text: 1, lambda: None)
    context.requests = []
    return context


@pytest.mark.parametrize('bad_words', [1815, 765, 1574])
def test_observed_semantic_rewrite_lengths_are_schema_repaired_in_same_bounded_stage(runtime, monkeypatch, bad_words):
    scope, snapshot = runtime
    calls = counted_workflow(monkeypatch, [json.dumps(stream(bad_words)), json.dumps(stream(1380))])
    context = context_for(snapshot)
    data = correction();original = copy.deepcopy(data)
    with execution_scope(scope):
        result = _bounded_write(context, data, {'min_words': 1242, 'max_words': 1504, 'target_words': 1380})
        rows = store.list_runs(scope)
    assert len(result['narration'].split()) == 1380 and '__gnosi_group__' not in result['narration']
    assert len(calls) == 2 and len(context.requests) == len(rows) == 1
    assert rows[0].status == 'completed' and rows[0].model_calls == 2
    request = context.requests[0];sent = json.loads(request.input)['data']
    assert request.timeout_seconds == 300 and request.max_model_calls == 2
    assert sent['composition_encoding'] == 'word_tokens_v1'
    assert sent['briefs'] == data['briefs'] and len(sent['briefs']) == 239
    assert sent['subject_groups'] == data['subject_groups']
    assert sent['previous_draft'] == data['previous_draft'] and data == original
    assert request.output_schema['properties']['tokens']['minItems'] == 1253
    assert request.output_schema['properties']['tokens']['maxItems'] == 1515
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(stream(bad_words), request.output_schema)


def test_provider_that_never_returns_bounded_rewrite_fails_closed_with_original_call_limit(runtime, monkeypatch):
    scope, snapshot = runtime
    calls = counted_workflow(monkeypatch, [json.dumps(stream(1815)), json.dumps(stream(1574))])
    context = context_for(snapshot)
    with execution_scope(scope):
        with pytest.raises((ValueError, jsonschema.ValidationError)):
            _bounded_write(context, correction(), {'min_words': 1242, 'max_words': 1504, 'target_words': 1380})
        rows = store.list_runs(scope)
    assert len(calls) == 2 and len(context.requests) == len(rows) == 1
    assert rows[0].status == 'failed' and rows[0].model_calls == 2
