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
