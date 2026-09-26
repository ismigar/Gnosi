import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentExecutionHistory } from './AgentExecutionHistory';
import { changeAgentRun, fetchAgentRuns } from '../../../shared/api/ai-activity';

vi.mock('../../../shared/api/ai-activity', () => ({ fetchAgentRuns: vi.fn(), changeAgentRun: vi.fn() }));
vi.mock('./AgentTeamProposals', () => ({ AgentTeamProposals: () => null }));
vi.mock('./AgentTraceRetention', () => ({ AgentTraceRetention: () => null }));
vi.mock('../../../shared/hooks/useActiveVaultId', () => ({ useActiveVaultId: () => 'vault' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
    i18n: { resolvedLanguage: 'ca' },
}) }));

const run = (id: string, parent = '', resumable = false) => ({
    run_id: id, parent_run_id: parent, agent_id: 'personal', skill_id: 'writing',
    operation: id, origin: 'worker', status: 'failed', created_at: 1, updated_at: 1,
    resumable, usage_available: false, model_calls: 0, input_tokens: 0, output_tokens: 0,
    model: 'model', provider: 'provider', result: '', error: '', execution_revision: '1', trace_state: 'available',
});

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => { root.unmount(); await Promise.resolve(); }); container.remove(); vi.unstubAllGlobals(); });
async function mount() { await act(async () => { root.render(<AgentExecutionHistory canEdit />); await Promise.resolve(); }); }
function resumeButtons() { return Array.from(container.querySelectorAll('button')).filter(button => button.textContent === 'agent_execution.resume'); }

describe('principal execution activity', () => {
    it('shows nested phases and offers only supported resumptions', async () => {
        vi.mocked(fetchAgentRuns).mockResolvedValue([
            run('conversation'), run('job', 'conversation', true), run('phase', 'job'),
        ]);
        await mount();
        expect(container.textContent).toContain('phase');
        expect(container.querySelectorAll('article')).toHaveLength(3);
        expect(resumeButtons()).toHaveLength(1);
        expect(container.textContent.match(/agent_execution.usage_unavailable/g)).toHaveLength(3);
    });

    it('resumes the selected job and reloads activity', async () => {
        vi.mocked(fetchAgentRuns).mockResolvedValue([run('job', '', true)]);
        vi.mocked(changeAgentRun).mockResolvedValue(run('job'));
        await mount();
        await act(async () => { resumeButtons()[0]?.click(); await Promise.resolve(); });
        expect(changeAgentRun).toHaveBeenCalledWith('job', 'resume');
        expect(fetchAgentRuns).toHaveBeenCalledTimes(2);
    });
});
