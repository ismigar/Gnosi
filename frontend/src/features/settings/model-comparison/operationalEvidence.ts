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
