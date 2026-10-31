"""Immutable composition edits preserve scope and fail closed before publication."""
import copy
import json

import jsonschema
import pytest

from backend.services.podcast_composition import composition_blocks, spoken_text
from backend.services.podcast_length_edits import apply_edits, composition_digest, schema
from backend.tests.test_podcast_briefing import length_edited
from backend.tests.test_podcast_word_text import broad_day
from backend.tests.test_agent_execution import runtime  # noqa: F401


DATA = {'composition_groups': [{'key': 'main'}, {'key': 'minority'}, {'key': 'access'}]}
BASE = {'paragraphs': {
    'main': {'text': "Segons la font, la mesura encara és provisional i s'està estudiant.",
             'non_editorial': False},
    'minority': {'text': "La cooperativa explica com comunicar incidències del vehicle després de la reserva.",
                 'non_editorial': False},
    'access': {'text': '', 'non_editorial': True}}}


def proposal(base=BASE, **edit):
    return {'composition_sha256': composition_digest(base), 'edits': [
        {'group_key': 'main', 'before': "la mesura encara és provisional i s'està estudiant.",
         'after': "la mesura continua provisional i s'estudia.", **edit}]}


def test_atomic_clause_edit_preserves_qualifications_minority_groups_flags_and_exact_base():
    previous, data = copy.deepcopy(BASE), copy.deepcopy(DATA)
    value = proposal()
    jsonschema.validate(value, schema({**data, 'previous_composition': previous}))
    result = apply_edits(value, previous, data, 1, 100)
    assert "continua provisional i s'estudia." in result['paragraphs']['main']['text']
    assert result['paragraphs']['minority'] == BASE['paragraphs']['minority']
    assert result['paragraphs']['access'] == BASE['paragraphs']['access']
    assert set(result['paragraphs']) == set(BASE['paragraphs'])
    assert previous == BASE and data == DATA


@pytest.mark.parametrize('words', [1241, 1242, 1380, 1504, 1505, 1891])
def test_whole_episode_word_boundaries_are_checked_after_complete_atomic_application(words):
    data, base = broad_day(1891, groups=12)
    _, desired = broad_day(words, groups=12)
    value = length_edited(desired, {**data, 'previous_composition': base})
    if words == 1891:
        # An empty proposal has no model change and is rejected by its wire schema.
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(value, schema({**data, 'previous_composition': base}))
        return
    jsonschema.validate(value, schema({**data, 'previous_composition': base}))
    original = copy.deepcopy(base)
    if 1242 <= words <= 1504:
        result = apply_edits(value, base, data, 1242, 1504)
        assert len(spoken_text(result, data).split()) == words
        assert result['paragraphs']['group:0']['text'].count('notícia') == words - 11
    else:
        with pytest.raises(ValueError) as error:
            apply_edits(value, base, data, 1242, 1504)
        assert json.loads(str(error.value))['word_budget']['proposed_words'] == words
    assert base == original


@pytest.mark.parametrize('encoding', ['paragraphs', 'tokens', 'token_text'])
def test_decoded_groups_retain_the_exact_original_transport_hash_and_spoken_words(encoding):
    from backend.tests.test_podcast_briefing import tokenized
    base = copy.deepcopy(BASE) if encoding == 'paragraphs' else tokenized(
        BASE, DATA['composition_groups'], text=encoding == 'token_text')
    if encoding == 'token_text':
        base['token_text'] = '\t'.join(base['token_text'].split())
    snapshot = copy.deepcopy(base)
    result = apply_edits(proposal(base), base, DATA, 1, 100)
    assert result['paragraphs'] == apply_edits(proposal(), BASE, DATA, 1, 100)['paragraphs']
    assert base == snapshot


def test_phrase_anchor_can_preserve_adjacent_punctuation():
    result = apply_edits(proposal(before='Segons la font', after='La font'), BASE, DATA, 1, 100)
    assert result['paragraphs']['main']['text'].startswith('La font, la mesura')


@pytest.mark.parametrize('before', ["està", "s'est"])
def test_anchor_cannot_split_a_catalan_contraction(before):
    with pytest.raises(ValueError, match='splits_original_word'):
        apply_edits(proposal(before=before, after='era'), BASE, DATA, 1, 100)


@pytest.mark.parametrize('edit,message', [
    ({'group_key': 'foreign'}, 'unknown_group'),
    ({'before': 'Absent original clause'}, 'unique_original_anchor'),
    ({'before': 'la'}, 'unique_original_anchor'),
    ({'before': 'mesu', 'after': 'pol'}, 'splits_original_word'),
    ({'before': ' la mesura ', 'after': ''}, 'joins_words'),
    ({'after': '__gnosi_group__:main'}, 'internal_marker'),
    ({'before': BASE['paragraphs']['main']['text'], 'after': ''}, 'requires_prose'),
    ({'group_key': 'access', 'before': 'anything'}, 'unique_original_anchor'),
])
def test_invalid_edits_never_return_partial_prose_or_modify_the_original(edit, message):
    before = copy.deepcopy(BASE)
    with pytest.raises(ValueError, match=message):
        apply_edits(proposal(**edit), before, DATA, 1, 100)
    assert before == BASE


def test_repeated_or_overlapping_edits_are_atomic_and_budget_is_not_claimed():
    value = proposal()
    value['edits'].append(copy.deepcopy(value['edits'][0]))
    with pytest.raises(ValueError) as error:
        apply_edits(value, BASE, DATA, 1, 100)
    detail = json.loads(str(error.value))
    assert detail['word_budget']['proposed_words'] is None
    assert detail['word_budget']['scope'] == 'unavailable_overlapping'


def test_sequential_dependency_and_word_budget_errors_reach_the_same_repair_call():
    value = proposal(before='mesura', after='política')
    value['edits'].append({'group_key': 'main', 'before': 'política', 'after': 'norma'})
    with pytest.raises(ValueError) as error:
        apply_edits(value, BASE, DATA, 90, 109)
    detail = json.loads(str(error.value))
    assert detail['word_budget']['scope'] == 'valid_anchors_only'
    assert detail['word_budget']['unresolved_edit_indices'] == [1]
    assert {row['error'] for row in detail['errors']} == {
        'podcast_length_edit_word_budget', 'podcast_length_edit_requires_unique_original_anchor'}


def test_hash_and_schema_protect_original_exclusion_metadata():
    value = proposal()
    value['composition_sha256'] = '0' * 64
    with pytest.raises(ValueError, match='composition_mismatch'):
        apply_edits(value, BASE, DATA, 1, 100)
    value = proposal(non_editorial=True)
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(value, schema({**DATA, 'previous_composition': BASE}))


def test_small_clause_proposal_does_not_reserialize_the_rest_of_the_episode():
    base = copy.deepcopy(BASE)
    base['paragraphs']['main']['text'] += ' Context.' * 500
    value = proposal(base)
    result = apply_edits(value, base, DATA, 1, 1000)
    assert len(json.dumps(value, ensure_ascii=False)) < len(json.dumps(result, ensure_ascii=False))
    assert result['paragraphs']['main']['text'].endswith(' Context.' * 500)
    assert composition_blocks(base, DATA)['access']['non_editorial'] is True


@pytest.mark.parametrize('accepted', [True, False])
def test_real_executor_repairs_against_same_base_within_original_two_call_stage(runtime, monkeypatch, accepted):
    from backend.services import agent_execution_store as store
    from backend.services.agent_execution_scope import execution_scope
    from backend.services.podcast_automatic import _bounded_write
    from backend.tests.test_podcast_bounded_rewrites import counted_workflow, context_for
    scope, snapshot = runtime
    data, stream = broad_day(1891, groups=12)
    base = {'paragraphs': composition_blocks(stream, data)}
    data = {key: value for key, value in data.items()
            if key not in {'composition_encoding', 'composition_word_range'}}
    data.update(briefs=[{'part_id': f'source:{i}', 'summary': 'Supported qualified claim.'} for i in range(222)],
                subject_groups=[{'topic': f'Subject {i}', 'subjects': [f'Material strand {i}']}
                                for i in range(12)], feedback=[])
    _, desired = broad_day(1380, groups=12)
    good = length_edited(desired, {**data, 'previous_composition': base})
    bad = copy.deepcopy(good);bad['edits'][0]['before'] = 'Invented original anchor'
    calls = counted_workflow(monkeypatch, [json.dumps(base), json.dumps(bad), json.dumps(good if accepted else bad)])
    context = context_for(snapshot)
    context.editorial_policy = context.editorial_policy.model_copy(update={'review_mode': 'brief'})
    with execution_scope(scope):
        if accepted:
            result = _bounded_write(context, data, {'min_words': 1242, 'max_words': 1504, 'target_words': 1380})
            assert len(result['narration'].split()) == 1380
        else:
            with pytest.raises(ValueError):
                _bounded_write(context, data, {'min_words': 1242, 'max_words': 1504, 'target_words': 1380})
        rows = store.list_runs(scope)
    assert len(calls) == 3 and len(context.requests) == len(rows) == 2
    assert sorted(row.model_calls for row in rows) == [1, 2]
    assert all(r.max_model_calls == 2 and r.timeout_seconds == 300 for r in context.requests)
    repair = json.loads(context.requests[1].input)['data']
    assert repair['previous_composition'] == base
    assert repair['source_part_ids'] == [f'source:{i}' for i in range(222)]
    assert repair['subject_groups'] == data['subject_groups']
    assert 'briefs' not in repair and 'feedback' not in repair
    assert 'Invented original anchor' in str(calls[2]['messages'])
    assert composition_digest(base) in str(calls[2]['messages'])
