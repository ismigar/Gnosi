import type { AiModelComparisonEntry } from '../../../shared/api/ai';
import type { RoleEvaluationReport } from '../../../shared/api/ai-activity';
import { comparisonRouteCosts, knownPrice, type ComparisonPriceOffer } from './modelRouteCosts';

type Model = AiModelComparisonEntry;
type Role = RoleEvaluationReport['role'];
type Metric = 'intelligence' | 'coding' | 'agentic';
export const TASKS = [
    { id: 'classify', role: 'worker', input: 10000, output: 2000, context: 16000, tools: false, structured: true, weights: { intelligence: 1 } },
    { id: 'extract', role: 'administrative', input: 20000, output: 4000, context: 32000, tools: false, structured: true, weights: { intelligence: 1 } },
    { id: 'book', role: 'documentalist', input: 200000, output: 10000, context: 32000, tools: false, structured: false, weights: { intelligence: 1 } },
    { id: 'retrieve', role: 'documentalist', input: 50000, output: 4000, context: 64000, tools: false, structured: false, weights: { intelligence: 1 } },
    { id: 'code', role: 'allrounder', input: 30000, output: 6000, context: 48000, tools: true, structured: false, weights: { intelligence: .4, coding: .6 } },
    { id: 'workflow', role: 'director', input: 50000, output: 8000, context: 64000, tools: true, structured: false, weights: { intelligence: .4, agentic: .6 } },
    { id: 'analyse', role: 'expert', input: 50000, output: 10000, context: 64000, tools: false, structured: false, weights: { intelligence: 1 } },
] as const;
export type Task = typeof TASKS[number];
export type TaskId = Task['id'];
export type Exclusion = 'capabilities' | 'terms' | 'cost' | 'budget' | 'quality' | 'failed_test';
export interface TaskRequest {
    task: Task;
    input: number;
    output: number;
    context: number;
    minimumQuality: number;
    budgetUsd: number | null;
    attempts: number;
}
export interface Candidate {
    model: Model;
    offer: ComparisonPriceOffer;
    quality: number;
    report?: RoleEvaluationReport;
    sampleCostPerSuccess: number | null;
    sampleLatency: number | null;
    variantCount: number;
}

function currentReport(reports: readonly RoleEvaluationReport[], role: Role, offer: ComparisonPriceOffer, now: number) {
    return reports.filter(r => r.kind === 'role' && r.role === role && r.version === 'synthetic_roles_v1'
        && r.provider === offer.route.provider && r.model === offer.route.model_id
        && r.cases.length > 0 && knownPrice(r.score) && r.score <= 100 && now - Date.parse(r.created_at) >= 0
        && now - Date.parse(r.created_at) <= 30 * 86400000)
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
}

/** Quality excludes context, token tariffs and speed: those are separate constraints. */
function benchmarkQuality(model: Model, rankings: ReadonlyMap<Metric, readonly number[]>, task: Task): number | null {
    let score = 0;
    for (const [key, weight] of Object.entries(task.weights) as [Metric, number][]) {
        const value = model[key];
        if (!knownPrice(value)) return null;
        const values = rankings.get(key) ?? [];
        // A single value is insufficient to infer relative quality.
        if (values.length < 2) return null;
        const boundary = (inclusive: boolean) => {
            let low = 0; let high = values.length;
            while (low < high) {
                const middle = Math.floor((low + high) / 2);
                const current = values[middle] ?? Infinity;
                if (current < value || (inclusive && current === value)) low = middle + 1;
                else high = middle;
            }
            return low;
        };
        score += weight * Math.max(0, Math.min(1, (boundary(false) + boundary(true) - 1) / (2 * (values.length - 1))));
    }
    return Math.round(score * 1000) / 10;
}

/** Compare exact offers. Reading stored evaluations never initiates model calls. */
export function recommendTask(models: readonly Model[], peers: readonly Model[], provider: string,
    request: TaskRequest, reports: readonly RoleEvaluationReport[] = [], now = Date.now()) {
    const excluded: Record<Exclusion, number> = { capabilities: 0, terms: 0, cost: 0, budget: 0, quality: 0, failed_test: 0 };
    const candidates: Candidate[] = [];
    const seen = new Set<string>();
    const rankings = new Map((Object.keys(request.task.weights) as Metric[])
        .map(key => [key, peers.map(peer => peer[key]).filter(knownPrice).sort((a, b) => a - b)] as const));
    const variants = new Map<string, { model: Model; quality: number; ids: Set<string> }>();
    for (const peer of peers) {
        const quality = benchmarkQuality(peer, rankings, request.task);
        if (quality === null) continue;
        for (const route of peer.routes) {
            const key = JSON.stringify([route.provider, route.model_id]);
            const previous = variants.get(key);
            const ids = previous?.ids ?? new Set<string>(); ids.add(peer.id);
            // A provider route shared by multiple reasoning settings does not
            // identify which setting Gnosi will execute. Use the lowest known
            // benchmark variant, never silently award its best setting's score.
            if (!previous || quality < previous.quality) variants.set(key, { model: peer, quality, ids });
        }
    }
    for (const model of models) {
        const benchmark = benchmarkQuality(model, rankings, request.task);
        for (const offer of comparisonRouteCosts(model, provider, String(request.input * request.attempts), String(request.output * request.attempts))) {
            const route = offer.route;
            const variant = variants.get(JSON.stringify([route.provider, route.model_id]));
            const observed = variant?.quality ?? benchmark;
            const variantCount = variant?.ids.size ?? 1;
            const identity = JSON.stringify([route.provider, route.model_id, offer.plan?.name]);
            if (seen.has(identity)) continue;
            // Only deduplicate after checking quality: a duplicate benchmark row
            // lacking evidence must not hide a usable row for the same offer.
            if (route.billing?.notes?.includes('interactive_only')) { excluded.terms++; continue; }
            if (!knownPrice(route.context_window) || route.context_window < request.context
                || !route.input_modes?.includes('text') || !route.output_modes?.includes('text')
                || (request.task.tools && route.tool_call !== true)
                || (request.task.structured && !route.tags.some(tag => ['json', 'structured'].includes(tag)) && route.tool_call !== true)) {
                excluded.capabilities++; continue;
            }
            // Local token price zero excludes hardware/energy and is not comparable
            // to an actual execution price. Do not crown it the cheapest option.
            if (route.is_local || !knownPrice(offer.cost)
                || (offer.cost === 0 && route.billing?.kind !== 'free')) { excluded.cost++; continue; }
            if (request.budgetUsd !== null && offer.cost > request.budgetUsd) { excluded.budget++; continue; }
            const report = currentReport(reports, request.task.role, offer, now);
            if (report?.cases.some(c => !c.passed)) { excluded.failed_test++; continue; }
            const quality = observed === null ? null : report && variantCount === 1
                ? Math.round((.8 * observed + .2 * report.score) * 10) / 10 : observed;
            if (quality === null || quality < request.minimumQuality) { excluded.quality++; continue; }
            seen.add(identity);
            const successes = report?.cases.filter(c => c.passed).length ?? 0;
            const costs = report?.cases.map(c => c.cost_usd) ?? [];
            candidates.push({ model: variant?.model ?? model, offer, quality, report, variantCount,
                sampleCostPerSuccess: successes > 0 && costs.every(knownPrice)
                    ? costs.filter(knownPrice).reduce((a, b) => a + b, 0) / successes : null,
                sampleLatency: report ? report.cases.reduce((sum, c) => sum + c.latency_ms, 0) / report.cases.length : null });
        }
    }
    const cost = (a: Candidate, b: Candidate) => (a.offer.cost ?? Infinity) - (b.offer.cost ?? Infinity)
        || (a.sampleLatency ?? Infinity) - (b.sampleLatency ?? Infinity)
        || b.quality - a.quality || a.model.name.localeCompare(b.model.name);
    const byQuality = [...candidates].sort((a, b) => b.quality - a.quality || cost(a, b));
    const best = byQuality[0];
    const balanced = best ? [...candidates].filter(c => c.quality >= best.quality - 5).sort(cost)[0] : undefined;
    return { balanced, cheapest: [...candidates].sort(cost)[0], quality: best, excluded, count: candidates.length };
}
