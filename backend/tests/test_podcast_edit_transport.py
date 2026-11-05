"""Native anchor IDs remove copied/duplicate anchors while retaining literal edits."""
import copy
import hashlib
import json

import jsonschema
import pytest

from backend.services import agent_execution_store as store
from backend.services.agent_execution_scope import execution_scope
from backend.services.podcast_automatic import _request
from backend.services.podcast_brief_edits import _anchor_schema, apply_edits, revise
from backend.services.podcast_briefing import _object
from backend.services.podcast_edit_transport import anchor_ids
from backend.tests.test_agent_execution import runtime  # noqa: F401
from backend.tests.test_podcast_bounded_rewrites import context_for, counted_workflow


def observed_case():
    clauses = [' '.join([f'Event{i}', *(['context'] * (count - 2)), 'continues.'])
               for i, count in enumerate([16] * 107 + [37])]
    previous = ' '.join(clauses)
    findings = [{'kind': 'production' if i == 0 else 'omission',
        'narration_quotes': [clauses[0]] if i == 0 else [],
        'source_part_ids': [] if i == 0 else [f'source:{i}']} for i in range(85)]
    data = {'previous_draft': previous, 'feedback': findings,
        'briefs': [{'part_id': f'source:{i}', 'summary': f'Supported development {i}.'} for i in range(275)],
        'subject_groups': [{'topic': f'Theme{i}', 'subjects': [f'Theme{i}']} for i in range(12)]}
    schema = _object({'draft_sha256': {'type': 'string', 'enum': [hashlib.sha256(previous.encode()).hexdigest()]},
        'edits': {'type': 'array', 'minItems': 1, 'maxItems': 172, 'items': _object({
            'before': _anchor_schema(previous), 'after': {'type': 'string', 'maxLength': 1024},
            'finding_indices': {'type': 'array', 'uniqueItems': True, 'maxItems': 85,
                'items': {'type': 'integer', 'minimum': 0, 'maximum': 84}}})}})
    good = {'draft_sha256': schema['properties']['draft_sha256']['enum'][0],
        'finding_anchors': {str(i): [f'a{i}'] for i in range(85)},
        'changes': {f'a{i}': ' '.join([f'Updated{i}', *(['supported'] * (10 if i < 56 else 9)), 'continues.'])
                    if i < 85 else None for i in range(108)}}
    return data, schema, good


def test_all85_findings_are_bound_once_without_copying_or_changing_untouched_clauses():
    data, schema, good = observed_case()
    original = copy.deepcopy((data, schema, good))
    transport = anchor_ids(data, schema)
    assert transport is not None
    assert transport.data['briefs'] == data['briefs'] and len(transport.data['briefs']) == 275
    assert transport.data['feedback'] == data['feedback'] and len(transport.data['feedback']) == 85
    assert transport.data['subject_groups'] == data['subject_groups']
    restored = transport.decode(good)
    text = apply_edits(restored, data['previous_draft'], data['feedback'], 1104, 1656)
    assert len(text.split()) == 1380
    assert len(restored['edits']) == len({edit['before'] for edit in restored['edits']}) == 85
    assert text.endswith(data['previous_draft'][data['previous_draft'].index('Event85 '):])
    assert transport.encode(restored) == good
    assert (data, schema, good) == original


@pytest.mark.parametrize('fault', ['missing-finding', 'unknown-anchor', 'wrong-factual-anchor',
    'assigned-null', 'stale-hash', 'same-prose', 'overflow', 'overlong', 'missing-clause'])
def test_invalid_complete_mapping_never_reaches_publishable_prose(fault):
    data, schema, good = observed_case()
    transport = anchor_ids(data, schema)
    if fault == 'missing-finding':
        del good['finding_anchors']['84']
    elif fault == 'unknown-anchor':
        good['changes']['unknown'] = 'Unknown replacement.'
    elif fault == 'wrong-factual-anchor':
        good['finding_anchors']['0'] = ['a1']
    elif fault == 'assigned-null':
        good['finding_anchors']['1'] = ['a85']
    elif fault == 'stale-hash':
        good['draft_sha256'] = '0' * 64
    elif fault == 'same-prose':
        good['changes']['a0'] = transport.data['anchor_clauses']['a0']
    elif fault == 'overflow':
        for i in range(85):
            good['changes'][f'a{i}'] += ' Extra.' * 4
    elif fault == 'overlong':
        good['changes']['a0'] = 'x' * 1025
    else:
        del good['changes']['a107']
    with pytest.raises((ValueError, jsonschema.ValidationError)):
        restored = transport.decode(good)
        apply_edits(restored, data['previous_draft'], data['feedback'], 1104, 1656)


def test_remaining_word_repair_restores_ids_inside_same_two_call_stage(runtime, monkeypatch):
    scope, snapshot = runtime
    data, _, good = observed_case()
    bad = copy.deepcopy(good)
    for i in range(85):
        bad['changes'][f'a{i}'] += ' Extra.' * 4
    words = [token for i in range(85) for token in
             [f'__gnosi_edit__:{i}', *good['changes'][f'a{i}'].split()]]
    calls = counted_workflow(monkeypatch, [json.dumps(bad), json.dumps({'replacement_tokens': words})])
    context = context_for(snapshot)
    with execution_scope(scope):
        result = revise(context, data, {'min_words': 1104, 'max_words': 1656, 'target_words': 1380}, _request)
        rows = store.list_runs(scope)
    assert len(result['narration'].split()) == 1380
    assert len(context.requests) == len(rows) == 1 and len(calls) == rows[0].model_calls == 2
    assert context.requests[0].timeout_seconds == 300 and context.requests[0].max_model_calls == 2
    assert json.loads(context.requests[0].input)['data']['revision_encoding'] == 'grounded_anchor_ids_v1'
