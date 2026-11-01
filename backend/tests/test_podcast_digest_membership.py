"""Digest compression cannot lose sources through model-copied membership."""
from copy import deepcopy
import json
from types import SimpleNamespace

import jsonschema
import pytest

from backend.services.podcast_briefing import _Briefing, _section_schema
from backend.services.podcast_outline import _digest, _request


@pytest.fixture
def digest_context(monkeypatch):
    saved, calls = {}, []
    snapshot = SimpleNamespace(origin='button', parent_run_id='day', revision='digest-contract', scope='owner')

    def checkpoint(scope, parent, key, value=None):
        assert (scope, parent) == ('owner', 'day')
        if value is not None:
            saved[key] = deepcopy(value)
        return deepcopy(saved.get(key))

    def model(request, **kwargs):
        calls.append(request)
        value = {'topic': 'Daily developments', 'narration': 'Proposals remain proposals; distinct themes remain visible.'}
        text = json.dumps(value)
        kwargs['output_validator'](text)
        return SimpleNamespace(result=text)

    monkeypatch.setattr('backend.services.agent_execution_store.work_checkpoint', checkpoint)
    monkeypatch.setattr('backend.services.agent_execution.run_sync', model)
    context = _Briefing(snapshot, 'Catalan', 80_000, len, lambda: None)
    return SimpleNamespace(context=context, saved=saved, calls=calls)


@pytest.mark.parametrize('count', [1, 223, 254, 1000])
def test_one_recursive_record_keeps_every_member_without_model_transcription(digest_context, count):
    ids = [f'source-{i}:0' for i in range(count)]
    records = [{'topic': 'Complete day', 'part_ids': ids, 'summary': 'All source developments and qualifications.'}]
    original = deepcopy(records)
    result = _digest(digest_context.context, records)
    assert len(digest_context.calls) == 1
    request = digest_context.calls[0]
    assert json.loads(request.input)['data']['briefs'] == original
    assert set(request.output_schema['properties']) == {'topic', 'narration'}
    assert request.output_schema['additionalProperties'] is False
    assert request.timeout_seconds == 300 and request.options['max_words'] == 160
    assert 'Do not return part_ids' in request.options['digest_contract']
    assert result == [{'topic': 'Daily developments', 'part_ids': ids,
                       'summary': 'Proposals remain proposals; distinct themes remain visible.'}]
    assert records == original


def test_new_digest_protocol_does_not_reuse_legacy_section_cache(digest_context):
    ids = [f'{i}:0' for i in range(223)]
    records = [{'topic': 'All sources', 'part_ids': ids, 'summary': 'Complete evidence.'}]
    schema = _section_schema([{'part_id': value} for value in ids])
    schema['properties']['sections']['maxItems'] = 1
    legacy = _request(digest_context.context, 'digest', {'briefs': records}, schema, max_words=160)
    key = digest_context.context._cache_key(legacy)
    saved = {'result': {'sections': [{'topic': 'Old digest', 'part_ids': ids, 'narration': 'Old prose.'}]}}
    digest_context.saved[key] = deepcopy(saved)
    assert _digest(digest_context.context, records)[0]['part_ids'] == ids
    assert len(digest_context.calls) == 1
    assert digest_context.context._cache_key(digest_context.calls[0]) != key
    assert digest_context.saved[key] == saved


@pytest.mark.parametrize('invalid', [[], ['x:0', 'x:0'], ['x:0', None], ['x:0', {}], 'x:0'])
def test_invalid_input_membership_fails_before_any_model_call(digest_context, invalid):
    with pytest.raises(ValueError, match='podcast_day_coverage_incomplete_or_duplicate'):
        _digest(digest_context.context, [{'topic': 'Invalid', 'part_ids': invalid, 'summary': 'Evidence.'}])
    assert not digest_context.calls


def test_duplicate_across_separate_batches_is_not_hidden(digest_context):
    records = [{'part_id': f'{i}:0', 'topic': 'Topic', 'summary': 'Evidence'} for i in range(9)]
    records[-1]['part_id'] = records[0]['part_id']
    with pytest.raises(ValueError, match='podcast_day_coverage_incomplete_or_duplicate'):
        _digest(digest_context.context, records)
    assert not digest_context.calls


@pytest.mark.parametrize('field', ['topic', 'narration'])
def test_whitespace_model_prose_cannot_be_saved(digest_context, monkeypatch, field):
    def model(request, **kwargs):
        result = {'topic': 'Topic', 'narration': 'Meaningful evidence.'}
        result[field] = '   '
        kwargs['output_validator'](json.dumps(result))
        raise AssertionError('Invalid prose must be rejected')
    monkeypatch.setattr('backend.services.agent_execution.run_sync', model)
    with pytest.raises(ValueError, match='podcast_empty_narration'):
        _digest(digest_context.context, [{'part_id': 'a:0', 'topic': 'Topic', 'summary': 'Evidence'}])
    assert not digest_context.saved


def test_model_cannot_replace_server_membership(digest_context, monkeypatch):
    def model(request, **kwargs):
        kwargs['output_validator'](json.dumps({'topic': 'Topic', 'narration': 'Evidence.', 'part_ids': ['invented']}))
        raise AssertionError('Extra fields must be rejected')
    monkeypatch.setattr('backend.services.agent_execution.run_sync', model)
    with pytest.raises(jsonschema.ValidationError):
        _digest(digest_context.context, [{'part_id': 'a:0', 'topic': 'Topic', 'summary': 'Evidence'}])
    assert not digest_context.saved
