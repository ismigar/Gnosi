"""Concurrent review preserves serial evidence, ordering, scope and paid progress."""
from contextvars import ContextVar
from copy import deepcopy
from threading import Barrier, Event, Lock, get_ident
import uuid
import json

import pytest

from backend.domains.llm_wiki import semantic_review_execution as execution
from backend.domains.llm_wiki.semantic_reading import SemanticReader
from backend.tests.test_semantic_reading import response, setup
from backend.tests.test_agent_execution import runtime as runtime


def prepared(generate=response, *, count=8, size=2):
    reader, calls, checkpoints = setup(count=count, generate=generate)
    engine = SemanticReader(reader)
    global_map = engine.overview()
    engine.extract(global_map)
    notes_map = engine.note_map()
    engine.state['review_size_limit'] = size
    engine.save()
    return engine, global_map, notes_map, calls, checkpoints


def test_two_reviews_overlap_with_identical_serial_context_and_order(monkeypatch):
    inherited = ContextVar('review_test_scope', default='missing')
    inherited.set('authenticated-vault-and-parent')
    barrier, lock = Barrier(2), Lock()
    active, maximum = 0, 0
    def generate(request):
        nonlocal active, maximum
        if request['phase'] == 'verify':
            assert inherited.get() == 'authenticated-vault-and-parent'
            with lock:
                active += 1
                maximum = max(maximum, active)
            barrier.wait(timeout=5)
            with lock:
                active -= 1
        return response(request)
    parallel, global_map, notes_map, calls, checkpoints = prepared(generate)
    owner = get_ident()
    save = parallel.deps.save_checkpoint
    def checkpoint(job, key, value):
        if key == 'semantic-state':
            assert get_ident() == owner
        save(job, key, value)
    parallel.deps.save_checkpoint = checkpoint
    parallel.deps.update_job.side_effect = lambda *args, **kwargs: pytest.fail('worker progress') if get_ident() != owner else None
    result = parallel.review(global_map, notes_map)
    assert maximum == 2
    parallel_calls = [c for c in calls if c['phase'] == 'verify']
    monkeypatch.setattr(execution, 'REVIEW_WORKERS', 1)
    serial, gm, nm, baseline_calls, _ = prepared()
    assert serial.review(gm, nm) == result
    key = lambda c: c['notes'][0]['note']['title']
    assert sorted(parallel_calls, key=key) == sorted([c for c in baseline_calls if c['phase'] == 'verify'], key=key)
    assert len(checkpoints['new', 'semantic-state']['reviewed_groups']) == 4


@pytest.mark.parametrize('error', ['agent_run_cancelled', 'provider_failed'])
def test_failed_wave_drains_and_retains_other_success_then_resumes_only_missing(error):
    both = Barrier(2)
    def generate(request):
        if request['phase'] == 'verify':
            both.wait(timeout=5)
            if 'Argument 0:' in request['notes'][0]['note']['title']:
                raise RuntimeError(error)
        return response(request)
    engine, gm, nm, _, checkpoints = prepared(generate)
    with pytest.raises(RuntimeError, match=error):
        engine.review(gm, nm)
    state = checkpoints['new', 'semantic-state']
    assert state['reviewed_ranges'] == {'2': 2}
    assert len(state['reviewed_groups']) == 1
    resumed, calls, _ = setup(checkpoints=checkpoints, resume='new')
    result, _ = resumed.run()
    assert len(result['notes']) == 8
    titles = [n['note']['title'] for c in calls if c['phase'] == 'verify' for n in c['notes']]
    assert len(titles) == 6
    assert not any('Argument 2:' in t or 'Argument 3:' in t for t in titles)


def test_truncation_splits_only_failed_range_with_later_success_retained():
    from backend.tests.test_reading_batch_recovery import exhausted
    reviews = []
    def generate(request):
        if request['phase'] == 'verify':
            titles = [n['note']['title'] for n in request['notes']]
            reviews.append(titles)
            if len(titles) == 4 and 'Argument 0:' in titles[0]:
                raise exhausted()
        return response(request)
    engine, gm, nm, _, checkpoints = prepared(generate, size=4)
    original = deepcopy(engine.state['plans'])
    result = engine.review(gm, nm)
    assert len(result) == 8 and engine.state['plans'] == original
    assert sorted(map(len, reviews)) == [2, 2, 4, 4]
    assert checkpoints['new', 'semantic-state']['reviewed_ranges'] == {'0': 2, '2': 2, '4': 4}


@pytest.mark.parametrize('cancelled', [False, True])
def test_governed_review_children_keep_parent_scope_and_cancellation(runtime, monkeypatch, cancelled):
    from dataclasses import replace
    from langchain_core.messages import AIMessage
    from backend.services import agent_execution as governed, agent_execution_store as store, reading_budget as budget
    from backend.services.agent_execution_scope import current_scope, execution_scope
    from backend.services.context_vars import active_vault_path
    from backend.services.llm_wiki_reading_runtime import ReadingRuntime
    from backend.services.agent_skill_catalog import resolve_agent_runtime
    from backend.domains.llm_wiki.reading_skill import SKILL_ID
    scope, snapshot = runtime
    snapshot.skill_ids.append(SKILL_ID)
    resolved = resolve_agent_runtime({})
    monkeypatch.setattr('backend.services.agent_skill_catalog.resolve_agent_runtime', lambda *a, **kw:
                        replace(resolved, active_skill_ids=tuple(snapshot.skill_ids)))
    monkeypatch.setattr('backend.agent.model_router.budget_status', lambda: {'over_cap': False})
    barrier, calls = Barrier(2), []
    class Application:
        def compile(self):
            return self
        async def astream(self, inputs, **kwargs):
            governed.before_model_call()
            assert current_scope() == scope
            assert str(active_vault_path.get()) == scope.vault_path
            assert budget.active()
            calls.append(governed._run.get())
            barrier.wait(timeout=5)
            yield {'operation': {'messages': [AIMessage(content=json.dumps({
                'assessment': 'Checked full evidence and both maps.',
                'changes': {'note_1': None, 'note_2': None}, 'warnings': [], 'unresolved_issues': [], 'evidence_requests': []}))]}}
    async def factory(*args, **kwargs):
        assert not kwargs['operation_team_help']
        return Application(), {'provider': 'test', 'model': 'fake'}
    monkeypatch.setattr('backend.agent.factory.create_agent_workflow', factory)
    engine, gm, nm, _, _ = prepared(count=4)
    with execution_scope(scope):
        frozen = governed.create_job_run(snapshot, 'review-parent', 'knowledge.process-source')
        reader = ReadingRuntime(snapshot.agent_id, 'test', 'fake', '', 1_000_000, frozen)
        engine.deps.generate_structured = reader.generate_structured
        if cancelled:
            store.cancel(scope, 'review-parent')
        with governed.operation_session(frozen), budget.session('inherited-budget'):
            if cancelled:
                with pytest.raises(RuntimeError, match='agent_run_cancelled'):
                    engine.review(gm, nm)
            else:
                assert len(engine.review(gm, nm)) == 4
    assert len(calls) == (0 if cancelled else 2)
    assert all(store.read(scope, run).parent_run_id == 'review-parent' for run in calls)


@pytest.mark.parametrize('settled', [True, False])
def test_concurrent_budget_reservations_share_cap_and_preserve_pending_cost(tmp_path, monkeypatch, settled):
    from backend.services import ai_usage_ledger as ledger, reading_budget as budget
    monkeypatch.setenv('GNOSI_DATA_DIR', str(tmp_path))
    # This test never constructs a provider client or uses a real vault.
    identifier = budget.configure(.03)
    rejected, lock = Event(), Lock()
    reservations, provider_calls = [], []
    def generate(request):
        if request['phase'] != 'verify':
            return response(request)
        call_id = uuid.uuid4().hex
        try:
            budget.reserve(call_id, 'original evidence', {'max_tokens': 16384}, {'cost_in': 1, 'cost_out': 1}, 'openrouter')
        except budget.ReadingBudgetError:
            rejected.set()
            raise
        with lock:
            reservations.append(call_id)
            provider_calls.append(request)
            first = len(provider_calls) == 1
        if first:
            assert rejected.wait(5)
        if settled:
            with ledger.connect() as db:
                budget.settle(db, call_id, '.001')
        return response(request)
    engine, gm, nm, _, checkpoints = prepared(generate, count=4)
    with budget.session(identifier):
        if settled:
            assert len(engine.review(gm, nm)) == 4
        else:
            with pytest.raises(budget.ReadingBudgetError, match='reading_budget_pending_cost'):
                engine.review(gm, nm)
    total = budget.status(identifier)
    assert total['spent_usd'] + total['reserved_usd'] <= .03
    assert len(provider_calls) == (2 if settled else 1)
    assert len(checkpoints['new', 'semantic-state']['reviewed_groups']) == len(provider_calls)
    assert total['reserved_usd'] == 0 if settled else total['reserved_usd'] > 0
