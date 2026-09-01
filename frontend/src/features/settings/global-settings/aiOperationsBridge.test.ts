import { describe, expect, it, vi } from 'vitest';
import { automationResources, operationResources } from './aiOperationsBridge';

const automation = { id: 'automation', agent_id: 'agent', skill_id: 'skill', name: 'Fixture', instruction: 'Inspect fixture', interval_minutes: 1440, enabled: false, budgets: { max_runs_per_day: 4, max_ai_calls_per_run: 4, max_runtime_seconds: 180 }, extension: { keep: true } };
function automations() {
    return { automations: [automation], skills: [], loading: false,
        saveAutomation: vi.fn<Parameters<typeof automationResources>[0]['saveAutomation']>().mockResolvedValue({}),
        runAutomation: vi.fn<Parameters<typeof automationResources>[0]['runAutomation']>().mockResolvedValue({}),
        deleteAutomation: vi.fn<Parameters<typeof automationResources>[0]['deleteAutomation']>().mockResolvedValue(undefined),
    };
}
function operations() {
    return {
        approvals: [{ agent_id: 'agent', session_id: 'session', confirmation_id: 'confirmation', details: { tool: 'fixture', extension: 7 } }],
        jobs: [{ job_id: 'job', status: 'done', extension: 8 }],
        auditEvents: [{ id: 'audit', agent_id: 'agent', created_at: 1720000000, duration_ms: 21, tool_name: 'fixture' }], tools: [],
        resolveApproval: vi.fn<Parameters<typeof operationResources>[0]['resolveApproval']>().mockResolvedValue(undefined),
    };
}
describe('typed AI operation panel boundaries', () => {
    it('preserves the backend nested-budget document and every extension without executing operations', () => {
        const source = automations(); const result = automationResources(source);
        expect(result.automations).toBe(source.automations);
        expect(result.automations[0]).toBe(automation);
        expect(result.automations[0]).not.toHaveProperty('max_runs_per_day');
        expect(source.runAutomation).not.toHaveBeenCalled();
        expect(source.saveAutomation).not.toHaveBeenCalled();
    });
    it('forwards a requested save exactly once without changing budgets', async () => {
        const source = automations(); const draft = { ...automation, ...automation.budgets };
        await automationResources(source).saveAutomation(draft);
        expect(source.saveAutomation).toHaveBeenCalledExactlyOnceWith(draft);
    });
    it('rejects invalid automation rows instead of dropping them or inventing required identifiers', () => {
        const source = automations();
        expect(() => automationResources({ ...source, automations: [{ ...automation, id: 1 }] })).toThrow('Invalid AI automations response');
        expect(() => automationResources({ ...source, automations: [{ ...automation, budgets: { max_runs_per_day: false } }] })).toThrow();
    });
    it('preserves history and approval details without automatically resolving an approval', async () => {
        const source = operations(); const result = operationResources(source);
        expect(result.approvals).toBe(source.approvals);
        expect(result.jobs).toBe(source.jobs); expect(result.auditEvents).toBe(source.auditEvents);
        expect(source.resolveApproval).not.toHaveBeenCalled();
        const approval = result.approvals[0]; if (!approval) throw new Error('Missing fixture approval');
        await result.resolveApproval(approval, 'cancel');
        expect(source.resolveApproval).toHaveBeenCalledExactlyOnceWith(approval, 'cancel');
    });
    it('rejects malformed job, audit and approval responses explicitly', () => {
        const source = operations();
        expect(() => operationResources({ ...source, jobs: [{ id: 'wrong-key' }] })).toThrow('jobs');
        expect(() => operationResources({ ...source, auditEvents: [{ id: 'missing-fields' }] })).toThrow('audit events');
        expect(() => operationResources({ ...source, approvals: [{ agent_id: 'missing-session' }] })).toThrow('approvals');
    });
});
