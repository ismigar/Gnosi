"""A remaining repair call owns fixed anchors, finding bindings and one word budget."""
import copy
import hashlib
import json

import jsonschema
import pytest

from backend.services.podcast_brief_edits import apply_edits
from backend.services.podcast_briefing import _object
from backend.services.podcast_revision_repair import revision_word_repair


def case():
    previous = 'original claim. ' + ' '.join(f'context{i}' for i in range(1392))
    findings = [{'kind': 'omission', 'detail': 'A qualified development is missing.',
                 'narration_quotes': [], 'source_part_ids': ['s:0']}]
    data = {'previous_draft': previous, 'feedback': findings,
            'briefs': [{'part_id': 's:0', 'summary': 'The proposal remains conditional.'}],
            'subject_groups': [{'topic': 'Context', 'subjects': ['Qualified development']}]}
    edit = _object({'before': {'type': 'string'}, 'after': {'type': 'string'},
                    'finding_indices': {'type': 'array', 'items': {'type': 'integer', 'enum': [0]}}})
    schema = _object({'draft_sha256': {'type': 'string', 'enum': [hashlib.sha256(previous.encode()).hexdigest()]},
                      'edits': {'type': 'array', 'minItems': 1, 'items': edit}})
    proposal = {'draft_sha256': hashlib.sha256(previous.encode()).hexdigest(), 'edits': [{
        'before': 'Original claim.', 'after': ' '.join(['qualified'] * 200), 'finding_indices': [0]}]}
    return data, schema, proposal


def test_remaining_repair_uses_exact_original_case_and_global_allowance_without_wire_regex():
    data, schema, proposal = case()
    original = copy.deepcopy((data, schema, proposal))
    repair = revision_word_repair(data, schema, 1242, 1504)(json.dumps(proposal), ValueError('rejected'))
    assert repair is not None
    sent = json.loads(repair.input)
    assert sent['anchors'] == [{'marker': '__gnosi_edit__:0', 'group_key': 'episode',
        'before': 'original claim.', 'finding_indices': [0]}]
    assert sent['untouched_words'] == 1392 and sent['replacement_word_range']['maximum'] == 112
    assert repair.output_schema['properties']['replacement_tokens'] == {
        'type': 'array', 'minItems': 1, 'maxItems': 113, 'items': {'type': 'string'}}
    good = {'replacement_tokens': ['__gnosi_edit__:0', 'A', 'qualified', 'conditional', 'proposal.']}
    restored = json.loads(repair.restore(json.dumps(good)))
    assert restored['edits'][0]['finding_indices'] == [0]
    assert apply_edits(restored, data['previous_draft'], data['feedback'], 1242, 1504).startswith('A qualified conditional proposal.')
    assert (data, schema, proposal) == original


@pytest.mark.parametrize('tokens', [
    ['__gnosi_edit__:0', *(['word'] * 113)],
    ['__gnosi_edit__:foreign', 'word'],
    ['__gnosi_edit__:0', 'two words'],
    ['__gnosi_edit__:0', 'original', 'claim.'],
])
def test_word_marker_whitespace_and_unresolved_finding_fail_closed(tokens):
    data, schema, proposal = case()
    repair = revision_word_repair(data, schema, 1242, 1504)(json.dumps(proposal), ValueError('rejected'))
    with pytest.raises((ValueError, jsonschema.ValidationError)):
        repair.restore(json.dumps({'replacement_tokens': tokens}))


@pytest.mark.parametrize('fault', ['absent-anchor', 'ambiguous-case', 'missing-finding', 'wrong-hash', 'missing-evidence'])
def test_unresolvable_or_incomplete_edits_keep_the_existing_ordinary_repair(fault):
    data, schema, proposal = case()
    if fault == 'absent-anchor':
        proposal['edits'][0]['before'] = 'Absent from the original'
    elif fault == 'ambiguous-case':
        data['previous_draft'] += ' ORIGINAL CLAIM.'
    elif fault == 'missing-finding':
        proposal['edits'][0]['finding_indices'] = []
    elif fault == 'wrong-hash':
        proposal['draft_sha256'] = 'wrong'
    else:
        data['briefs'] = []
    assert revision_word_repair(data, schema, 1242, 1504)(json.dumps(proposal), ValueError('rejected')) is None


def test_more_than_four_semantic_edits_keep_their_own_contract_limit():
    data, schema, proposal = case()
    proposal['edits'].extend({'before': f'context{i}', 'after': 'context', 'finding_indices': []}
                             for i in range(1300, 1305))
    repair = revision_word_repair(data, schema, 1242, 1504)(json.dumps(proposal), ValueError('rejected'))
    assert repair is not None
    tokens = [token for i in range(6) for token in [f'__gnosi_edit__:{i}', 'Revised']]
    result = json.loads(repair.restore(json.dumps({'replacement_tokens': tokens})))
    assert len(result['edits']) == 6
    assert len(apply_edits(result, data['previous_draft'], data['feedback'], 1242, 1504).split()) == 1393


def test_overlapping_repeated_literal_never_spends_the_specialized_repair_call():
    data, schema, proposal = case()
    data['previous_draft'] = 'a a a Beta old. Tail stays.'
    proposal['draft_sha256'] = hashlib.sha256(data['previous_draft'].encode()).hexdigest()
    schema['properties']['draft_sha256']['enum'] = [proposal['draft_sha256']]
    proposal['edits'] = [{'before': 'a a', 'after': 'a a', 'finding_indices': [0]},
                         {'before': 'Beta old.', 'after': 'expanded ' * 20, 'finding_indices': []}]
    assert revision_word_repair(data, schema, 7, 10)(json.dumps(proposal), ValueError('rejected')) is None
