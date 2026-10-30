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


def test_partial_quote_overlap_can_clarify_rule_without_reversing_reported_action():
    previous = ('Control authorized normal running, although the protocol only allowed '
                'sight running. Ecology closes.')
    findings = [{'kind': 'distortion', 'narration_quotes': [
        'Control authorized normal running, although the protocol']}]
    result = reply(previous, [edit('although the protocol only allowed sight running.',
        'although the applicable rule only permitted sight running.', 0)])
    assert apply_edits(result, previous, findings, 10, 25) == (
        'Control authorized normal running, although the applicable rule only permitted '
        'sight running. Ecology closes.')
    unrelated = reply(previous, [edit('Ecology closes.', 'The protocol applies elsewhere.', 0)])
    with pytest.raises(ValueError, match='affected_quote'):
        apply_edits(unrelated, previous, findings, 10, 25)


def test_repair_reports_word_overflow_and_all_independent_edit_errors_together():
    previous = 'Funding is proposed. Ecology closes. Sport closes.'
    findings = [{'kind': 'distortion', 'narration_quotes': ['Funding is proposed.']},
                {'kind': 'omission'}]
    result = reply(previous, [edit('Ecology', ' '.join(['detail'] * 20), 0),
                              edit('Not in original', 'New topic', 1)])
    with pytest.raises(ValueError) as rejected:
        apply_edits(result, previous, findings, 5, 15)
    diagnostic = json.loads(str(rejected.value))
    assert diagnostic['word_budget'] == {'minimum': 5, 'maximum': 15,
        'original_words': 7, 'proposed_words': 26, 'scope': 'valid_anchors_only',
        'unresolved_edit_indices': [1]}
    assert {e['error'] for e in diagnostic['errors']} == {
        'podcast_revision_word_budget', 'podcast_revision_anchor_must_include_affected_quote',
        'podcast_revision_requires_unique_original_anchor', 'podcast_revision_must_address_all_findings'}


def test_complete_word_count_is_reported_even_when_quote_binding_fails():
    previous = 'Funding is proposed. Ecology closes.'
    findings = [{'kind': 'distortion', 'narration_quotes': ['Funding is proposed.']}]
    with pytest.raises(ValueError) as rejected:
        apply_edits(reply(previous, [edit('Ecology', ' '.join(['detail'] * 20), 0)]),
                    previous, findings, 5, 12)
    diagnostic = json.loads(str(rejected.value))
    assert diagnostic['word_budget']['scope'] == 'complete'
    assert diagnostic['word_budget']['proposed_words'] == 24
    assert len(diagnostic['errors']) == 2


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
    assert sent['revision_budget'] == {'original_words': 1394, 'minimum': 1242,
        'maximum': 1504, 'target': 1380, 'minimum_word_delta': -152, 'maximum_word_delta': 110}
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


def test_observed_sized_overflow_and_invalid_anchor_repair_with_compression(runtime, monkeypatch):
    scope, snapshot = runtime
    previous, briefs, outline, findings, edits = day()
    bad = copy.deepcopy(edits)
    bad[0]['before'] = 'not present in the original'
    bad[1]['after'] = ' '.join(['secondary'] * 250) + ' '
    compressed = [*edits, edit(' '.join(f'word{i}' for i in range(100, 130)), 'Concise context.')]
    calls = counted_workflow(monkeypatch, [json.dumps(reply(previous, bad)),
                                          json.dumps(reply(previous, compressed))])
    context = context_for(snapshot)
    with execution_scope(scope):
        section = _write_episode(context, briefs, outline, 1380, findings, previous)
        rows = store.list_runs(scope)
    assert len(section['narration'].split()) == 1373
    assert all(f'corrected{i} development' in section['narration'] for i in range(7))
    assert len(calls) == rows[0].model_calls == 2 and rows[0].status == 'completed'
    assert len(context.requests) == len(rows) == 1
    assert context.requests[0].timeout_seconds == 300


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
