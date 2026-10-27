"""Resuming a split audit must preserve its already confirmed findings."""
import copy
import json
from types import SimpleNamespace

import pytest

from backend.services.agent_behavior import revision
from backend.services.podcast_automatic import _request
from backend.services.podcast_briefing import _Briefing
from backend.services.podcast_review import _schema, review


@pytest.fixture
def audit(monkeypatch):
    saved, sent = {}, []
    snapshot = SimpleNamespace(scope='test', parent_run_id='day', revision='frozen-v1', origin='button')
    context = _Briefing(snapshot, 'Català', 1_000_000, len, lambda: None)
    def checkpoint(scope, parent, key, value=None):
        assert (scope, parent) == ('test', 'day')
        if value is not None:
            saved[key] = copy.deepcopy(value)
        return copy.deepcopy(saved.get(key))
    monkeypatch.setattr('backend.services.agent_execution_store.work_checkpoint', checkpoint)
    def respond(request, **kwargs):
        data = json.loads(request.input)['data']
        sent.append(data)
        result = ({'confirmed_finding_ids': [c['finding_id'] for c in data['candidate_findings']]}
                  if 'candidate_findings' in data else {'issues': []})
        return SimpleNamespace(result=json.dumps(result))
    monkeypatch.setattr('backend.services.agent_execution.run_sync', respond)
    data = {'narration': 'A complete narration.', 'review_focus': 'coverage', 'subjects': [['Conditions']],
            'briefs': [{'part_id': f'{i}:0', 'title': f'Theme {i}',
                        'source_text': f'Important condition {i}.'} for i in range(4)]}
    def seed(value, result):
        request = _request(context, 'audit', value, _schema(value))
        saved[context._cache_key(request)] = {'result': copy.deepcopy(result)}
    return SimpleNamespace(context=context, saved=saved, sent=sent, data=data, seed=seed)


def issue(index):
    return {'kind': 'omission', 'detail': f'Include condition {index}.', 'narration_quotes': [],
            'source_part_ids': [f'{index}:0'], 'evidence_quote': f'Important condition {index}.'}


def confirmed_child(audit, value, finding):
    audit.seed(value, {'issues': [finding]})
    audit.seed({**value, 'candidate_findings': [{'finding_id': 'finding:0', 'finding': finding}]},
               {'confirmed_finding_ids': ['finding:0']})


def test_cached_empty_parent_cannot_hide_previously_confirmed_child(audit):
    before = copy.deepcopy(audit.data)
    left = {**audit.data, 'briefs': audit.data['briefs'][:2]}
    right = {**audit.data, 'briefs': audit.data['briefs'][2:]}
    audit.seed(audit.data, {'issues': []})
    confirmed_child(audit, left, issue(0))
    audit.seed(right, {'issues': []})
    assert review(audit.context, audit.data, _request) == [issue(0)]
    assert audit.sent == []
    assert audit.data == before


def test_resume_only_calls_missing_child_and_keeps_confirmed_sibling(audit):
    left = {**audit.data, 'briefs': audit.data['briefs'][:2]}
    confirmed_child(audit, left, issue(0))
    assert review(audit.context, audit.data, _request) == [issue(0)]
    assert len(audit.sent) == 1
    assert audit.sent[0]['briefs'] == audit.data['briefs'][2:]
    assert audit.sent[0]['narration'] == audit.data['narration']


def test_parent_and_child_positive_findings_are_both_retained(audit):
    confirmed_child(audit, audit.data, issue(3))
    confirmed_child(audit, {**audit.data, 'briefs': audit.data['briefs'][:2]}, issue(0))
    audit.seed({**audit.data, 'briefs': audit.data['briefs'][2:]}, {'issues': []})
    assert review(audit.context, audit.data, _request) == [issue(3), issue(0)]
    assert audit.sent == []


def test_nested_legacy_split_reuses_all_completed_leaves_without_parent_retry(audit):
    confirmed_child(audit, {**audit.data, 'briefs': audit.data['briefs'][:1]}, issue(0))
    for parts in (audit.data['briefs'][1:2], audit.data['briefs'][2:]):
        audit.seed({**audit.data, 'briefs': parts}, {'issues': []})
    assert review(audit.context, audit.data, _request) == [issue(0)]
    assert audit.sent == []


@pytest.mark.parametrize('changed', ['narration', 'original', 'revision'])
def test_different_frozen_request_never_reuses_a_partition(audit, changed):
    confirmed_child(audit, {**audit.data, 'briefs': audit.data['briefs'][:2]}, issue(0))
    if changed == 'narration':
        audit.data['narration'] += ' Updated.'
    elif changed == 'original':
        audit.data['briefs'][0]['source_text'] += ' Updated.'
    else:
        audit.context.snapshot.revision = 'frozen-v2'
    assert review(audit.context, audit.data, _request) == []
    assert len(audit.sent) == 1 and len(audit.sent[0]['briefs']) == 4


def test_invalid_cached_evidence_fails_closed(audit):
    left = {**audit.data, 'briefs': audit.data['briefs'][:2]}
    audit.seed(left, {'issues': [{**issue(0), 'evidence_quote': 'Invented original.'}]})
    with pytest.raises(ValueError, match='podcast_audit_invented_evidence_quote'):
        review(audit.context, audit.data, _request)
    assert audit.sent == []


def test_partition_decision_survives_interruption_before_any_child_completes(audit, monkeypatch):
    def fail(request, **kwargs):
        data = json.loads(request.input)['data']
        if len(data['briefs']) == 4:
            raise TimeoutError()
        raise RuntimeError('cancelled')
    monkeypatch.setattr('backend.services.agent_execution.run_sync', fail)
    with pytest.raises(RuntimeError, match='cancelled'):
        review(audit.context, audit.data, _request)
    operation = _request(audit.context, 'audit', audit.data, _schema(audit.data))
    assert audit.context.audit_partition(operation)
    assert not audit.context.has_saved(operation)


def test_normal_checkpoint_key_is_unchanged_and_corrupt_partition_is_rejected(audit):
    operation = _request(audit.context, 'audit', audit.data, _schema(audit.data))
    digest = revision([audit.context.snapshot.revision, operation.model_dump()])
    assert audit.context._cache_key(operation) == 'podcast-coverage-v1:' + digest
    audit.saved['podcast-audit-partition-v1:' + digest] = {'split': False}
    with pytest.raises(ValueError, match='podcast_invalid_audit_partition_state'):
        review(audit.context, audit.data, _request)
    assert audit.sent == []
