import type { AgentExecutionRun } from '../../../shared/api/ai-activity';

/** Operational history cannot certify quality or attribute a mixed run's bill. */
export function operationalEvidence(runs: readonly AgentExecutionRun[], provider: string, model: string, now = Date.now()) {
    const matching = runs.filter(run => !run.parent_run_id && run.provider === provider && run.model === model
        && now / 1000 - run.created_at >= 0 && now / 1000 - run.created_at <= 30 * 86400);
    return {
        completed: matching.filter(run => run.status === 'completed').length,
        failed: matching.filter(run => ['failed', 'interrupted'].includes(run.status)).length,
        other: matching.filter(run => !['completed', 'failed', 'interrupted'].includes(run.status)).length,
    };
}

/** Observed reader steps, including repairs; never extrapolate a whole book. */
export function readingTimings(runs: readonly AgentExecutionRun[], provider: string, model: string, now = Date.now()) {
    const recent = runs.filter(run => run.operation === 'knowledge.process-source.phase'
        && run.provider === provider && run.model === model && Boolean(run.parent_run_id)
        && ['completed', 'failed', 'interrupted'].includes(run.status)
        && run.closed_at != null && run.closed_at >= run.created_at && run.closed_at <= now / 1000
        && now / 1000 - run.created_at <= 30 * 86400 && run.model_calls > 0);
    const durations = recent.filter(run => run.status === 'completed')
        .map(run => ((run.closed_at ?? run.created_at) - run.created_at) * 1000).sort((a, b) => a - b);
    const middle = Math.floor(durations.length / 2);
    return { completed: durations.length, failed: recent.length - durations.length,
        medianMs: durations.length ? ((durations[middle] ?? 0) + (durations[Math.floor((durations.length - 1) / 2)] ?? 0)) / 2 : null };
}
