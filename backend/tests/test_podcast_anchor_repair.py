"""An observed 85-finding edit failure stays bounded and preserves untouched prose."""
import copy
import hashlib
import json

import jsonschema
import pytest

from backend.services.agent_execution_scope import execution_scope
from backend.services import agent_execution_store as store
from backend.services.podcast_automatic import _request
from backend.services.podcast_brief_edits import _anchor_schema, apply_edits, revise
from backend.services.podcast_briefing import _object
from backend.services.podcast_revision_repair import revision_word_repair
from backend.tests.test_agent_execution import runtime  # noqa: F401
from backend.tests.test_podcast_bounded_rewrites import context_for, counted_workflow


def observed_case():
    counts = [16] * 107 + [37]
    clauses = [' '.join([f'Event{i}', *(['context'] * (count - 2)), 'continues.'])
               for i, count in enumerate(counts)]
    previous = ' '.join(clauses)
    findings = [{'kind': 'production' if i == 0 else 'omission',
        'detail': 'Correct the passage.' if i == 0 else 'Include the missing supported development.',
        'narration_quotes': [clauses[0]] if i == 0 else [],
        'source_part_ids': [] if i == 0 else [f'source:{i}']} for i in range(85)]
    data = {'previous_draft': previous, 'feedback': findings,
        'briefs': [{'part_id': f'source:{i}', 'summary': f'Supported development {i}.'} for i in range(275)],
        'subject_groups': [{'topic': f'Theme{i}', 'subjects': [f'Theme{i}']} for i in range(12)],
        'composition_groups': [{'key': f'group:{i}'} for i in range(12)]}
    schema = _object({'draft_sha256': {'type': 'string', 'enum': [hashlib.sha256(previous.encode()).hexdigest()]},
        'edits': {'type': 'array', 'minItems': 1, 'maxItems': 172, 'items': _object({
            'before': _anchor_schema(previous), 'after': {'type': 'string', 'maxLength': 1024},
            'finding_indices': {'type': 'array', 'uniqueItems': True, 'maxItems': 85,
                'items': {'type': 'integer', 'minimum': 0, 'maximum': 84}}})}})
    bad = {'draft_sha256': hashlib.sha256(previous.encode()).hexdigest(), 'edits': [
        {'before': clauses[0], 'after': 'One correction.', 'finding_indices': [0]},
        {'before': clauses[0], 'after': 'Another correction.', 'finding_indices': [1]}]}
    actions, tokens = {}, []
    for i, clause in enumerate(clauses):
        actions[f'e{i}'] = 'edit' if i < 85 else 'keep'
        words = ([f'Updated{i}', *(['supported'] * (10 if i < 56 else 9)), 'continues.']
                 if i < 85 else clause.split())
        tokens.extend(f'e{i}:{word}' for word in words)
    good = {'actions': actions, 'finding_anchors': {str(i): [f'e{i}'] for i in range(85)},
            'replacement_words': tokens}
    assert len(previous.split()) == 1749 and len(tokens) == 1380
    return data, schema, bad, good


def test_duplicate_anchors_and_missing_findings_become_disjoint_bounded_edits():
    data, schema, rejected, good = observed_case()
    original = copy.deepcopy((data, schema, rejected, good))
    repair = revision_word_repair(data, schema, 1104, 1656)(json.dumps(rejected), ValueError('rejected'))
    assert repair is not None
    payload = json.loads(repair.input)
    assert payload['revision_encoding'] == 'grounded_anchor_words_v1'
    assert payload['briefs'] == data['briefs'] and len(payload['briefs']) == 275
    assert payload['feedback'] == data['feedback'] and len(payload['feedback']) == 85
    assert payload['subject_groups'] == data['subject_groups'] and len(payload['planned_groups']) == 12
    assert payload['replacement_word_range'] == {'minimum': 1104, 'maximum': 1656}
    restored = json.loads(repair.restore(json.dumps(good)))
    narration = apply_edits(restored, data['previous_draft'], data['feedback'], 1104, 1656)
    assert len(narration.split()) == 1380
    suffix = data['previous_draft'][data['previous_draft'].index('Event85 '):]
    assert narration.endswith(suffix)
    assert len(restored['edits']) == len({edit['before'] for edit in restored['edits']}) == 85
    assert {index for edit in restored['edits'] for index in edit['finding_indices']} == set(range(85))
    assert (data, schema, rejected, good) == original


@pytest.mark.parametrize('fault', ['missing-finding', 'wrong-factual-anchor', 'kept-changed',
    'kept-claimed', 'packed-word', 'unknown-anchor', 'delete-with-words', 'missing-anchor-words',
    'duplicate-assignment', 'overflow', 'trailing-newline', 'old-response'])
def test_invalid_remaining_repair_never_returns_partial_or_unbounded_edits(fault):
    data, schema, rejected, good = observed_case()
    repair = revision_word_repair(data, schema, 1104, 1656)(json.dumps(rejected), ValueError('rejected'))
    if fault == 'missing-finding':
        del good['finding_anchors']['84']
    elif fault == 'wrong-factual-anchor':
        good['finding_anchors']['0'] = ['e1']
    elif fault == 'kept-changed':
        good['replacement_words'][next(i for i, token in enumerate(good['replacement_words']) if token.startswith('e85:'))] = 'e85:Changed'
    elif fault == 'kept-claimed':
        good['finding_anchors']['1'] = ['e85']
    elif fault == 'packed-word':
        good['replacement_words'][0] = 'e0:two words'
    elif fault == 'trailing-newline':
        good['replacement_words'][0] += '\n'
    elif fault == 'unknown-anchor':
        good['replacement_words'][0] = 'e999:Word'
    elif fault == 'delete-with-words':
        good['actions']['e0'] = 'delete'
    elif fault == 'missing-anchor-words':
        good['replacement_words'] = [token for token in good['replacement_words'] if not token.startswith('e85:')]
    elif fault == 'duplicate-assignment':
        good['finding_anchors']['1'] = ['e1', 'e1']
    elif fault == 'overflow':
        good['replacement_words'].extend(['e0:Extra'] * (1657 - len(good['replacement_words'])))
    else:
        good = rejected
    with pytest.raises((ValueError, jsonschema.ValidationError)):
        repair.restore(json.dumps(good))


def test_real_stage_uses_only_its_remaining_call_and_original_deadline(runtime, monkeypatch):
    scope, snapshot = runtime
    data, _, rejected, good = observed_case()
    calls = counted_workflow(monkeypatch, [json.dumps(rejected), json.dumps(good)])
    context = context_for(snapshot)
    with execution_scope(scope):
        result = revise(context, data, {'min_words': 1104, 'max_words': 1656, 'target_words': 1380}, _request)
        rows = store.list_runs(scope)
    assert len(result['narration'].split()) == 1380
    assert len(context.requests) == len(rows) == 1 and len(calls) == rows[0].model_calls == 2
    assert rows[0].status == 'completed'
    assert context.requests[0].timeout_seconds == 300
    assert context.requests[0].max_model_calls == 2
