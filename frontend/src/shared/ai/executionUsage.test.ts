import { expect, it } from 'vitest';
import type { AgentExecutionRun } from '../api/ai-activity';
import { executionUsage } from './executionUsage';

const row = (id: string, parent = '', model = '', calls = 0): AgentExecutionRun => ({
    run_id: id, parent_run_id: parent, agent_id: 'a', skill_id: '', operation: 'writing', origin: 'button', status: 'completed',
    created_at: 1, updated_at: 1, model, provider: model ? 'p' : '', model_calls: calls,
    input_tokens: calls * 100, output_tokens: calls * 10, usage_available: true,
    resumable: false, result: '', error: '', execution_revision: '', trace_state: 'available',
});
it('counts model usage exactly once across job and team parents', () => {
    const parent = row('job', '', '', 2);
    const team = row('team', 'job');
    const runs = [parent, team, row('director', 'team', 'big', 1), row('worker', 'team', 'small', 1)];
    expect(executionUsage(parent, runs)).toEqual({ input: 200, output: 20, calls: 2, available: true });
    expect(executionUsage(team, runs).calls).toBe(2);
});
it('keeps missing usage unknown even when another executor reports it', () => {
    const parent = row('team');
    const runs = [parent, row('a', 'team', 'big', 1), { ...row('b', 'team', 'small', 1), usage_available: false }];
    expect(executionUsage(parent, runs).available).toBe(false);
});
