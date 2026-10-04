import { describe, expect, it } from 'vitest';
import type { AiModelComparisonEntry } from '../../../shared/api/ai';
import type { RoleEvaluationReport } from '../../../shared/api/ai-activity';
import { recommendTask, TASKS, type TaskRequest } from './taskRecommendations';
import { suite, checked } from './__fixtures__/taskEvidence';

function firstRoute(model: AiModelComparisonEntry) {
    const route = model.routes[0];
    if (!route) throw new Error('Missing fixture route');
    return route;
}
const caseDefaults = { id: 'citation', metric: 'citation_fidelity', passed: true, model_calls: 1, latency_ms: 300, cost_usd: .01, failure: '', strategy: '', director_calls: 0, avoidable_director_calls: 0, unnecessary_assignments: 0, unnecessary_assignments_measured: true, executor_id: '', planner_valid: null };
const now = Date.parse('2026-10-04T12:00:00Z');
const book = TASKS[2];
const request: TaskRequest = { task: book, input: 200000, output: 10000, context: 32000, budgetUsd: .5, minimumQuality: 40, attempts: 1 };
function model(id: string, intelligence: number, price = 1): AiModelComparisonEntry {
    return { id, name: id, intelligence, coding: intelligence, agentic: intelligence,
        routes: [{ provider: 'p', provider_name: 'Provider', model_id: id, model_name: id,
            cost_in: price, cost_out: price, context_window: 64000, is_local: false,
            quality: 4, tags: ['json'], input_modes: ['text'], output_modes: ['text'], tool_call: true,
            billing: { kind: 'metered', source_url: 'https://example.com', stale: false } }] } as AiModelComparisonEntry;
}
const peers = Array.from({ length: 21 }, (_, index) => model(String(index + 1), index + 1));
const high = model('high', 21, 2);
const near = model('near', 20, 1);
const cheap = model('cheap', 10, .1);
const report = (changed: Partial<RoleEvaluationReport> = {}): RoleEvaluationReport => ({
    id: 'evaluation', kind: 'role', role: 'documentalist', provider: 'p', model: 'high', agent_id: 'a',
    version: 'synthetic_roles_v1', created_at: '2026-10-03T12:00:00Z', score: 100, model_calls: 2, participants: [], limitations: [],
    cases: [{ ...caseDefaults, id: 'citation', metric: 'citation_fidelity', passed: true, model_calls: 1, latency_ms: 300, cost_usd: .01 },
        { ...caseDefaults, id: 'coverage', metric: 'coverage', passed: true, model_calls: 1, latency_ms: 500, cost_usd: .03 }],
    ...changed,
});
const compare = (models = [high, near, cheap], changes: Partial<TaskRequest> = {}, reports: RoleEvaluationReport[] = [], provider = 'all') =>
    recommendTask(models, peers, provider, { ...request, ...changes }, reports, now);

it('reuses task-specific evidence for the selected bot and prefers checked near-best offers', () => {
    const stored = { suite, reports: [checked({ created_at: '2026-10-03T12:00:00Z', cases: checked().cases?.map(item => ({ ...item, checked_at: '2026-10-03T12:00:00Z' })) })] };
    const translate = TASKS.find(task => task.id === 'translate');
    if (!translate) throw new Error('Missing translation');
    const knowledge = recommendTask([high, near, cheap], peers, 'all', request, [], now, stored);
    expect(knowledge.balanced?.model.id).toBe('near'); expect(knowledge.balanced?.taskChecks?.complete).toBe(true);
    const translation = recommendTask([high, near, cheap], peers, 'all', { ...request, task: translate }, [], now, stored);
    expect(translation.balanced?.model.id).toBe('high'); expect(translation.excluded.failed_test).toBe(1);
});

describe('task recommendations', () => {
    it('gives distinct quality, economical and near-best balanced choices', () => {
        const result = compare();
        expect(result.quality?.model.id).toBe('high');
        expect(result.balanced?.model.id).toBe('near');
        expect(result.cheapest?.model.id).toBe('cheap');
        expect(result.balanced?.offer.cost).toBeCloseTo(.21);
    });
    it('changes eligibility with actual execution budget, volume and attempts', () => {
        expect(compare(undefined, { budgetUsd: .1 }).quality?.model.id).toBe('cheap');
        expect(compare(undefined, { input: 1000000 }).quality?.model.id).toBe('cheap');
        expect(compare(undefined, { attempts: 3 }).excluded.budget).toBe(2);
        expect(compare(undefined, { minimumQuality: 60 }).cheapest?.model.id).toBe('near');
    });
    it('never borrows a lower-priced offer from another provider', () => {
        const multi = { ...high, routes: [firstRoute(high), { ...firstRoute(high), provider: 'other', cost_in: .01, cost_out: .01 }] };
        expect(compare([multi], {}, [], 'p').quality?.offer.cost).toBeCloseTo(.42);
        expect(compare([multi], {}, [], 'other').quality?.offer.cost).toBeCloseTo(.0021);
    });
    it('uses the full subscription fee, not its amortized token rate', () => {
        const subscribed = { ...high, routes: [{ ...firstRoute(high), billing: { kind: 'subscription' as const, stale: false, source_url: '',
            plans: [{ name: 'Plan', currency: 'USD', monthly_fee: 10, monthly_fee_usd: 10, quota: 1000000,
                quota_unit: 'tokens' as const, quota_period: 'month' as const, input_units_per_million: 1000000, output_units_per_million: 1000000 }] } }] };
        expect(compare([subscribed]).excluded.budget).toBe(1);
        expect(compare([subscribed], { budgetUsd: 10 }).quality?.offer.cost).toBe(10);
        expect(compare([subscribed], { budgetUsd: 10, attempts: 5 }).excluded.cost).toBe(1);
    });
    it('discards documented interactive-only subscriptions for Gnosi processing', () => {
        const restricted = { ...high, routes: [{ ...firstRoute(high), billing: { kind: 'metered' as const, source_url: '', stale: false, notes: ['interactive_only'] } }] };
        expect(compare([restricted]).excluded.terms).toBe(1);
        expect(compare([restricted]).quality).toBeUndefined();
    });
    it('requires the exact route to declare context, modes and necessary tools', () => {
        const incomplete = { ...high, routes: [{ ...firstRoute(high), input_modes: null }] };
        expect(compare([incomplete]).excluded.capabilities).toBe(1);
        const noTools = { ...high, routes: [{ ...firstRoute(high), tool_call: false }] };
        expect(compare([noTools], { task: TASKS[5] }).excluded.capabilities).toBe(1);
        expect(compare(undefined, { context: 100000 }).count).toBe(0);
    });
    it('does not recommend unverified zero tariffs or declare local hardware free', () => {
        const zero = { ...high, routes: [{ ...firstRoute(high), cost_in: 0, cost_out: 0, billing: null }] };
        expect(compare([zero]).excluded.cost).toBe(1);
        const free = { ...zero, routes: [{ ...firstRoute(zero), billing: { kind: 'free' as const, stale: false, source_url: '' } }] };
        expect(compare([free]).cheapest?.offer.cost).toBe(0);
        expect(compare([{ ...free, routes: [{ ...firstRoute(free), is_local: true }] }]).excluded.cost).toBe(1);
    });
    it('reuses only current role tests for the exact provider/model', () => {
        const failed = report({ score: 0, cases: [{ ...caseDefaults, ...report().cases[0], passed: false }] });
        expect(compare([high], {}, [failed]).excluded.failed_test).toBe(1);
        for (const mismatch of [{ provider: 'other' }, { model: 'different' }, { role: 'worker' }, { kind: 'strategies' },
            { version: 'obsolete' }, { created_at: '2026-08-01' }, { created_at: '2026-12-01' }]) {
            expect(compare([high], {}, [{ ...failed, ...mismatch }]).quality?.report).toBeUndefined();
        }
        expect(compare([high], {}, [report()]).quality).toMatchObject({ sampleCostPerSuccess: .02, sampleLatency: 400 });
    });
    it('uses the newest report even if an older report was more favourable', () => {
        const failed = report({ created_at: '2026-10-04T11:00:00Z', cases: [{ ...caseDefaults, ...report().cases[0], passed: false }] });
        expect(compare([high], {}, [report(), failed]).excluded.failed_test).toBe(1);
    });
    it('keeps missing sample costs unknown and does not extrapolate test durations', () => {
        const partial = report({ cases: [{ ...caseDefaults, ...report().cases[0], cost_usd: null }] });
        expect(compare([high], {}, [partial]).quality?.sampleCostPerSuccess).toBeNull();
        expect(compare([high]).quality?.sampleLatency).toBeNull();
    });
    it('never inflates quality from larger context, cheaper tariffs or faster benchmarks', () => {
        const changed = { ...high, speed: 100000, context_window: 1000000, input_price: 0, output_price: 0 };
        expect(compare([changed]).quality?.quality).toBe(compare([high]).quality?.quality);
        expect(recommendTask([high], [high], 'all', request, [], now).quality).toBeUndefined();
    });
    it('uses the weakest known reasoning variant when one executable route maps to several benchmarks', () => {
        const weaker = { ...cheap, routes: high.routes };
        const result = recommendTask([high], [...peers, high, weaker], 'p', { ...request, minimumQuality: 0 }, [], now);
        expect(result.quality?.model.id).toBe('cheap');
        expect(result.quality?.variantCount).toBe(2);
        expect(result.quality?.quality).toBeLessThan(60);
        expect(recommendTask([high], [...peers, high, weaker], 'p', { ...request, minimumQuality: 0 }, [report()], now).quality?.quality)
            .toBe(result.quality?.quality);
        expect(recommendTask([high], [...peers, high, weaker], 'p', { ...request, minimumQuality: 60 }, [], now).quality).toBeUndefined();
    });
});

it('requires every bot task and scores the weakest task rather than its best specialty', () => {
    const weakAgent = { ...high, agentic: 1 };
    const result = compare([weakAgent, near], { tasks: [TASKS[2], TASKS[5]], minimumQuality: 60, budgetUsd: 1 });
    expect(result.quality?.model.id).toBe('near');
    const noTools = { ...high, routes: [{ ...firstRoute(high), tool_call: false }] };
    expect(compare([noTools], { needsTools: true }).excluded.capabilities).toBe(1);
    expect(compare([noTools], { tasks: [TASKS[2], TASKS[5]] }).excluded.capabilities).toBe(1);
    const missingAgentic = { ...high, agentic: null };
    expect(compare([missingAgentic], { tasks: [TASKS[2], TASKS[5]] }).excluded.quality).toBe(1);
});
