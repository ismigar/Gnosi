"""A synthesis must contract, preserve complete work and stop within its cap."""
from copy import deepcopy
import json

import pytest

from backend.domains.llm_wiki.semantic_map_windows import MapOutputLimit
from backend.domains.llm_wiki.contextual_reading import fingerprint
from backend.domains.llm_wiki.semantic_map_reduction import compact, map_limit, REDUCTION_VERSION
from backend.domains.llm_wiki.semantic_reading import SemanticReader
from backend.tests.test_semantic_reading import setup


def engine_with_prose(generate, *, checkpoints=None, resume=''):
    reader, _, checkpoints = setup(checkpoints=checkpoints, resume=resume)
    calls = []
    def prose(prompt, validator, timeout):
        request = json.loads(prompt)
        calls.append(request)
        return validator(generate(request)), 'test-model'
    reader.dependencies.generate_prose = prose
    return SemanticReader(reader), calls, checkpoints


def test_complete_source_maps_contract_without_summary_splitting_or_source_repeat():
    compact = 'The author disputes the opponent; evidence is qualified and the ending remains unresolved.'
    engine, calls, _ = engine_with_prose(lambda _: compact)
    maps = [f'Attributed source map {i}; uncertainty persists. ' * 70 for i in range(25)]
    before = deepcopy(maps)
    assert engine.combine('semantic-global-map', maps) == compact
    assert maps == before and len(calls) < len(maps)
    # Every complete source map participates, in order, with no cut text.
    delivered = [value for call in calls for value in call['material'] if value in maps]
    assert delivered == maps
    assert not engine.state.get('map_splits')
    assert all(c['map_contract'] == 'bounded-reduction-v1' for c in calls)


def test_long_complete_draft_is_compressed_once_without_resending_original_maps():
    draft = 'The author qualifies the opponent’s claim, preserving a caveat. ' * 50
    replies = iter([draft, 'The author qualifies the opponent; uncertainty remains.'])
    engine, calls, checkpoints = engine_with_prose(lambda _: next(replies))
    originals = ['Original argument A', 'Original argument B']
    assert 'uncertainty' in engine.combine('global', originals)
    assert len(calls) == 2 and calls[0]['material'] == originals and calls[1]['material'] == [draft.strip()]
    assert calls[1]['summary_max_tokens'] < calls[0]['summary_max_tokens']
    resumed, new_calls, _ = engine_with_prose(lambda _: pytest.fail('paid synthesis repeated'), checkpoints=checkpoints, resume='new')
    assert 'uncertainty' in resumed.combine('global', originals)
    assert not new_calls


@pytest.mark.parametrize('prose', [True, False])
def test_retry_accepts_complete_map_within_capacity_even_when_above_shorter_target(prose):
    draft = 'The author qualifies the opponent’s claim; evidence remains uncertain. ' * 60
    answer = ('A disputed claim remains attributed to the opponent, with a qualified conclusion. ' * 18).strip()
    replies = iter([draft, answer])
    if prose:
        engine, calls, checkpoints = engine_with_prose(lambda _: next(replies))
    else:
        reader, calls, checkpoints = setup(generate=lambda _: {'summary': next(replies)})
        engine = SemanticReader(reader)
    originals = ['Original argument A', 'Original argument B']
    assert engine.combine('global', originals) == answer
    assert len(calls) == 2 and calls[1]['material'] == [draft.strip() if prose else draft]
    assert calls[1]['summary_max_tokens'] < engine.deps.count_tokens(answer) <= map_limit(engine.reader.budget)
    assert checkpoints['new', 'global-bounded-v1-0-0-result']['summary'] == answer


@pytest.mark.parametrize('model', [None, 'saved-model'])
@pytest.mark.parametrize('framed_count', [False, True])
def test_resume_promotes_old_complete_draft_that_already_fits_without_paid_call(model, framed_count):
    engine, calls, checkpoints = engine_with_prose(lambda _: pytest.fail('paid synthesis repeated'), resume='saved')
    if framed_count:
        from types import SimpleNamespace
        from backend.services.llm_wiki_reading_runtime import ReadingRuntime
        runtime = ReadingRuntime('test-agent', 'openrouter', 'unknown-tokenizer', '', engine.reader.budget,
                                 SimpleNamespace(behavior_resources=True))
        engine.deps.count_tokens = runtime.count_tokens
    material = ['Original argument A', 'Original argument B']
    answer = ('A complete synthesis preserves attributed disagreements and unresolved qualifications. ' * 18).strip()
    key = 'global-bounded-v1-0-0'
    identity = fingerprint([REDUCTION_VERSION, engine.deps.execution_revision, engine.reader.title,
                            engine.reader.language, material, map_limit(engine.reader.budget)])
    checkpoints['saved', key + '-draft'] = {'identity': identity, 'summary': answer, 'complete': True}
    if model:
        checkpoints['saved', key + '-draft']['model'] = model
    assert engine.combine('global', material) == answer and not calls
    assert engine.reader.models == ([model] if model else [])
    assert checkpoints['new', key + '-result']['summary'] == answer
    # The new result remains sufficient even if the old job is unavailable.
    del checkpoints['saved', key + '-draft']
    resumed, again, _ = engine_with_prose(lambda _: pytest.fail('paid synthesis repeated'), checkpoints=checkpoints, resume='new')
    resumed.reader.job_id = 'later'
    assert resumed.combine('global', material) == answer and not again


@pytest.mark.parametrize('invalid', ['identity', 'incomplete', 'empty', 'oversized'])
def test_resume_checks_draft_identity_completeness_and_capacity(invalid):
    engine, calls, checkpoints = engine_with_prose(lambda _: 'A complete qualified synthesis.', resume='saved')
    material = ['Original argument A', 'Original argument B']
    identity = fingerprint([REDUCTION_VERSION, engine.deps.execution_revision, engine.reader.title,
                            engine.reader.language, material, map_limit(engine.reader.budget)])
    draft = {'identity': identity, 'summary': 'An attributed claim with uncertainty. ' * 30, 'complete': True}
    if invalid == 'identity':
        draft['identity'] = 'different-policy-or-material'
    elif invalid == 'incomplete':
        draft['complete'] = False
    elif invalid == 'empty':
        draft['summary'] = '   '
    else:
        draft['summary'] = str(draft['summary']) * 3
    checkpoints['saved', 'global-draft'] = draft
    assert compact(engine, 'global', material) == 'A complete qualified synthesis.'
    assert len(calls) == 1
    assert calls[0]['material'] == ([draft['summary']] if invalid == 'oversized' else material)


def test_retry_still_rejects_complete_maps_above_capacity_and_retains_draft():
    draft = 'An attributed but overlong synthesis with unresolved qualifications. ' * 60
    engine, calls, checkpoints = engine_with_prose(lambda _: draft)
    with pytest.raises(RuntimeError, match='reading_map_synthesis_incomplete'):
        engine.combine('global', ['Original argument A', 'Original argument B'])
    assert len(calls) == 2
    assert checkpoints['new', 'global-bounded-v1-0-0-draft']['summary'] == draft.strip()
    assert not any(key.endswith('-result') for _, key in checkpoints)


def test_repeated_truncation_stops_after_two_calls_without_recursive_expansion():
    def clipped(_):
        raise MapOutputLimit(True)
    engine, calls, checkpoints = engine_with_prose(clipped)
    originals = ['Map A with attribution', 'Map B with caveats']
    with pytest.raises(RuntimeError, match='reading_map_synthesis_incomplete'):
        engine.combine('global', originals)
    assert len(calls) == 2 and all(c['material'] == originals for c in calls)
    assert not engine.state.get('map_splits')
    assert not any(k.endswith('-result') for _, k in checkpoints)


def test_interrupted_contraction_reuses_completed_group_then_resumes_remaining():
    maps = [f'Argument {i} with an attributed caveat. ' * 160 for i in range(8)]
    interrupted = False
    def generate(request):
        nonlocal interrupted
        if len(calls) == 2 and not interrupted:
            interrupted = True
            raise RuntimeError('budget_pause')
        return 'The author is cautious; the opponent’s claim is unresolved.'
    engine, calls, checkpoints = engine_with_prose(generate)
    with pytest.raises(RuntimeError, match='budget_pause'):
        engine.combine('global', maps)
    first = calls[0]['material']
    resumed, resumed_calls, _ = engine_with_prose(lambda _: 'The author is cautious; the opponent’s claim is unresolved.', checkpoints=checkpoints, resume='new')
    assert 'unresolved' in resumed.combine('global', maps)
    assert all(c['material'] != first for c in resumed_calls)


def test_one_oversized_map_is_contracted_and_empty_notes_need_no_model():
    engine, calls, _ = engine_with_prose(lambda _: 'The author preserves an unresolved caveat.')
    assert engine.combine('empty', []) == 'No proposed reading notes.' and not calls
    original = 'The author preserves an unresolved caveat. ' * 100
    assert engine.combine('global', [original]) == 'The author preserves an unresolved caveat.'
    assert len(calls) == 1 and calls[0]['material'] == [original]


@pytest.mark.parametrize('change', ['language', 'revision'])
def test_contraction_cache_keeps_language_and_execution_policy_boundaries(change):
    engine, _, checkpoints = engine_with_prose(lambda _: 'The author preserves an unresolved caveat.')
    material = ['Attributed argument A', 'Attributed argument B']
    engine.combine('global', material)
    resumed, calls, _ = engine_with_prose(lambda _: 'A new synthesis preserves an unresolved caveat.', checkpoints=checkpoints, resume='new')
    if change == 'language':
        resumed.reader.language = 'French'
    else:
        resumed.deps.execution_revision = 'different-policy'
    assert resumed.combine('global', material).startswith('A new synthesis')
    assert len(calls) == 1


def test_preflight_prices_contraction_of_actual_saved_source_windows():
    from types import SimpleNamespace
    from backend.services.reading_semantic_estimate import phase_estimate
    reader, _, _ = setup()
    source_maps = [f'Argument {i} with qualifications and attribution. ' * 100 for i in range(25)]
    runtime = SimpleNamespace(input_budget=reader.budget, count_tokens=reader.dependencies.count_tokens, instructions='Methodology')
    saved = {'overview_complete': {'0': source_maps}, 'maps': source_maps}
    pending = phase_estimate(runtime, reader.chunks, reader.chunks, [], saved, 4)
    assert pending['phase_calls']['overview'] > 1
    saved['global_map'] = 'The author preserves an unresolved caveat.'
    complete = phase_estimate(runtime, reader.chunks, reader.chunks, [], saved, 4)
    assert complete['phase_calls']['overview'] == 0
    assert pending['input_token_bound'] > complete['input_token_bound']
