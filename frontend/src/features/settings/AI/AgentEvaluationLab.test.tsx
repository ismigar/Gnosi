import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { AgentEvaluationLab } from './AgentEvaluationLab';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../../shared/hooks/useActiveVaultId', () => ({ useActiveVaultId: () => 'test' }));
vi.mock('../../../shared/api/ai-activity', () => ({
    fetchEvaluationAgents: () => Promise.resolve([{ id: 'a', name: 'Agent', provider: 'test', model: 'model' }]),
    fetchRoleEvaluations: () => Promise.resolve([]),
    runRoleEvaluation: mocks.run,
}));
describe('evaluation authorization', () => {
    it('requires selecting an enabled agent and explicit authorization before any calls', async () => {
        const container = document.createElement('div');
        const root = createRoot(container);
        await act(async () => { await Promise.resolve(); root.render(<AgentEvaluationLab />); });
        expect(mocks.run).not.toHaveBeenCalled();
        await act(async () => { await Promise.resolve(); container.querySelector<HTMLButtonElement>('button')?.click(); });
        const button = [...container.querySelectorAll('button')].find(b => b.textContent === 'agent_team.lab_run');
        expect(button?.disabled).toBe(true);
        const agent = [...container.querySelectorAll('select')].find(s => s.querySelector('option[value="a"]'));
        await act(async () => { await Promise.resolve(); if (agent) { agent.value = 'a'; agent.dispatchEvent(new Event('change', { bubbles:true })); } });
        expect(button?.disabled).toBe(true);
        await act(async () => { await Promise.resolve(); container.querySelector<HTMLElement>('[role="switch"]')?.click(); });
        expect(button?.disabled).toBe(false);
        mocks.run.mockResolvedValue({ id:'report', kind:'role', role:'allrounder', model:'model', version:'v1', score:100, cases:[], created_at:'today' });
        await act(async () => { await Promise.resolve(); button?.click(); });
        expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ agent_id:'a', role:'allrounder', authorize_model_calls:true }));
        expect(button?.disabled).toBe(true);
        expect(container.textContent).toContain('100%');
        await act(async () => { await Promise.resolve(); root.unmount(); });
    });
});
