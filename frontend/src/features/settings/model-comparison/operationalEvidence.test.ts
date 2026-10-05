import { expect, it } from 'vitest';
import type { AgentExecutionRun } from '../../../shared/api/ai-activity';
import { operationalEvidence } from './operationalEvidence';

const now = Date.parse('2026-10-04T12:00:00Z');
const run = (status: string, changed: Partial<AgentExecutionRun> = {}) => ({ provider: 'p', model: 'm', status, parent_run_id: '', created_at: now / 1000 - 20, ...changed }) as AgentExecutionRun;
it('counts available operational states without declaring output quality or prices', () => {
    expect(operationalEvidence([run('completed'), run('failed'), run('interrupted'), run('running')], 'p', 'm', now))
        .toEqual({ completed: 1, failed: 2, other: 1 });
});
it('does not mix providers, models, child runs, future timestamps or obsolete activity', () => {
    expect(operationalEvidence([run('completed', { provider: 'other' }), run('completed', { model: 'other' }),
        run('completed', { parent_run_id: 'parent' }), run('completed', { created_at: now / 1000 + 1 }),
        run('completed', { created_at: now / 1000 - 31 * 86400 })], 'p', 'm', now))
        .toEqual({ completed: 0, failed: 0, other: 0 });
});

it('shows real reading-step durations separately from failed work and whole jobs', async () => {
    const { readingTimings } = await import('./operationalEvidence');
    const step = (seconds: number, changed: Partial<AgentExecutionRun> = {}) => run('completed', {
        operation: 'knowledge.process-source.phase', parent_run_id: 'book', model_calls: 2,
        created_at: now / 1000 - seconds, closed_at: now / 1000, ...changed,
    });
    const rows = [step(10), step(300), step(600, { status: 'failed' }), step(50, { status: 'running' }),
        step(20, { operation: 'knowledge.process-source' }), step(30, { provider: 'other' }),
        step(5, { closed_at: null }), step(10, { model_calls: 0 }), step(10, { parent_run_id: '' })];
    expect(readingTimings(rows, 'p', 'm', now)).toEqual({ completed: 2, failed: 1, medianMs: 155000 });
    expect(readingTimings([step(10, { status: 'failed' })], 'p', 'm', now)).toEqual({ completed: 0, failed: 1, medianMs: null });
});
