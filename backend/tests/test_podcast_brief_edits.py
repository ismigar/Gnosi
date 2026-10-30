"""Reviewed episodes retain their prose while bounded edits repair material findings."""
import copy
import hashlib
import json

import pytest

from backend.services import agent_execution_store as store
from backend.services.agent_execution_scope import execution_scope
from backend.services.podcast_automatic import _write_episode
from backend.services.podcast_brief_edits import apply_edits
from backend.tests.test_podcast_bounded_rewrites import context_for, counted_workflow
from backend.tests.test_agent_execution import runtime  # noqa: F401


def reply(previous, edits):
    return {'draft_sha256': hashlib.sha256(previous.encode()).hexdigest(), 'edits': edits}


def edit(before, after, *findings):
    return {'before': before, 'after': after, 'finding_indices': list(findings)}


def omissions(count):
    return [{'kind': 'omission'} for _ in range(count)]


def test_edit_offsets_always_refer_to_original_and_preserve_other_prose():
    previous = 'Housing remains uncertain. Ecology is discussed. Sport closes the episode.'
    result = reply(previous, [edit('Sport', 'Culture and sport', 1),
                              edit('Housing remains uncertain.', 'Housing funding is proposed.', 0)])
    assert apply_edits(result, previous, omissions(2), 10, 20) == (
        'Housing funding is proposed. Ecology is discussed. Culture and sport closes the episode.')
    assert previous == 'Housing remains uncertain. Ecology is discussed. Sport closes the episode.'


@pytest.mark.parametrize(('edits', 'findings', 'error'), [
    ([edit('Housing', 'Housing', 0)], 1, 'unique_original_anchor'),
    ([edit('absent passage', 'new passage', 0)], 1, 'unique_original_anchor'),
    ([edit('Housing', 'Revised housing', 0)], 2, 'all_findings'),
    ([edit('Housing remains', 'Housing is proposed', 0),
      edit('remains uncertain', 'funding is uncertain', 1)], 2, 'overlapping'),
    ([edit('Housing', ' '.join(['extra'] * 30), 0)], 1, 'word_budget'),
])
def test_invalid_edits_do_not_publish_partial_or_unbounded_prose(edits, findings, error):
    previous = 'Housing remains uncertain. Ecology is discussed.'
    with pytest.raises(ValueError, match=error):
        apply_edits(reply(previous, edits), previous, omissions(findings), 5, 12)


def test_repeated_anchor_and_stale_draft_are_rejected():
    previous = 'Housing is discussed. Housing remains uncertain.'
    result = reply(previous, [edit('Housing', 'Local housing', 0)])
    with pytest.raises(ValueError, match='unique_original_anchor'):
        apply_edits(result, previous, omissions(1), 5, 12)
    with pytest.raises(ValueError, match='draft_mismatch'):
        apply_edits(result, previous + ' News.', omissions(1), 5, 12)


def test_overlapping_occurrences_do_not_count_as_a_unique_anchor():
    previous = 'A very very very serious issue remains under review.'
    findings = [{'kind': 'distortion', 'narration_quotes': ['very very very serious issue']}]
    result = reply(previous, [edit('very very', 'extremely', 0)])
    with pytest.raises(ValueError, match='unique_original_anchor'):
        apply_edits(result, previous, findings, 5, 15)


def test_factual_finding_cannot_be_claimed_by_editing_unrelated_prose():
    previous = 'Funding has been granted. Ecology is discussed.'
    findings = [{'kind': 'distortion', 'narration_quotes': ['Funding has been granted.']}]
    with pytest.raises(ValueError, match='affected_quote'):
        apply_edits(reply(previous, [edit('Ecology', 'Local ecology', 0)]), previous, findings, 5, 12)
    result = reply(previous, [edit('has been granted', 'has been requested', 0)])
    assert apply_edits(result, previous, findings, 5, 12) == (
        'Funding has been requested. Ecology is discussed.')


def day():
    previous = ' '.join(f'word{i}' for i in range(1394))
    briefs = [{'part_id': f'source:{i}', 'summary': 'A supported qualified development.'}
              for i in range(239)]
    outline = [{'topic': f'Theme {i}', 'subjects': [f'Subject {i}']} for i in range(11)]
    findings = [{'kind': 'omission' if i < 4 else 'distortion',
                 'detail': 'Add the missing development.' if i < 4 else 'Preserve proposed status.',
                 'source_part_ids': [f'source:{i}'],
                 'narration_quotes': [] if i < 4 else [f'word{i}']} for i in range(7)]
    edits = [edit(f'word{i} ', f'corrected{i} development ', i) for i in range(7)]
    return previous, briefs, outline, findings, edits


def test_observed_sized_day_uses_compact_edits_and_preserves_the_complete_reviewed_base(runtime, monkeypatch):
    scope, snapshot = runtime
    previous, briefs, outline, findings, edits = day()
    original = copy.deepcopy((briefs, outline, findings))
    calls = counted_workflow(monkeypatch, [json.dumps(reply(previous, edits))])
    context = context_for(snapshot)
    with execution_scope(scope):
        section = _write_episode(context, briefs, outline, 1380, findings, previous)
        rows = store.list_runs(scope)
    expected = apply_edits(reply(previous, edits), previous, findings, 1242, 1504)
    assert section['narration'] == expected and len(expected.split()) == 1401
    assert section['part_ids'] == [b['part_id'] for b in briefs]
    assert (briefs, outline, findings) == original
    assert len(calls) == len(context.requests) == len(rows) == 1
    request = context.requests[0]
    sent = json.loads(request.input)['data']
    assert request.timeout_seconds == 300 and request.max_model_calls == 2
    assert rows[0].status == 'completed' and rows[0].model_calls == 1
    assert sent['previous_draft'] == previous and sent['feedback'] == findings
    assert sent['briefs'] == briefs and len(sent['planned_groups']) == 11
    assert sent['revision_encoding'] == 'grounded_edits_v1'
    assert 'revision_contract' in request.options
    assert set(request.output_schema['properties']) == {'draft_sha256', 'edits'}


def test_incomplete_edits_are_repaired_inside_original_two_call_stage(runtime, monkeypatch):
    scope, snapshot = runtime
    previous, briefs, outline, findings, edits = day()
    calls = counted_workflow(monkeypatch, [json.dumps(reply(previous, edits[:-1])),
                                          json.dumps(reply(previous, edits))])
    context = context_for(snapshot)
    with execution_scope(scope):
        result = _write_episode(context, briefs, outline, 1380, findings, previous)
        rows = store.list_runs(scope)
    assert len(result['narration'].split()) == 1401
    assert len(calls) == 2 and len(context.requests) == len(rows) == 1
    assert rows[0].model_calls == 2 and rows[0].status == 'completed'


def test_never_compliant_edits_fail_closed_without_extra_stage_or_deadline(runtime, monkeypatch):
    scope, snapshot = runtime
    previous, briefs, outline, findings, edits = day()
    bad = json.dumps(reply(previous, edits[:-1]))
    calls = counted_workflow(monkeypatch, [bad, bad])
    context = context_for(snapshot)
    with execution_scope(scope):
        with pytest.raises(ValueError, match='all_findings'):
            _write_episode(context, briefs, outline, 1380, findings, previous)
        rows = store.list_runs(scope)
    assert len(calls) == 2 and len(context.requests) == len(rows) == 1
    assert rows[0].status == 'failed' and rows[0].model_calls == 2
    assert context.requests[0].timeout_seconds == 300
