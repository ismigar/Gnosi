import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentBehaviorInspection } from './AgentBehaviorInspection';
import { bindAgentOperation, previewAgentBehavior } from '../../../shared/api/ai-activity';
vi.mock('../../../shared/api/ai-activity', () => ({ bindAgentOperation: vi.fn(), previewAgentBehavior: vi.fn() }));
vi.mock('../../../shared/hooks/useActiveVaultId', () => ({ useActiveVaultId: () => 'vault' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
    vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    vi.mocked(previewAgentBehavior).mockResolvedValue({ instructions: 'Persona', context: 'References', sources: [], system: 'Data boundary', skills: [], operations: [{ operation: 'podcast', skill_id: 'podcast', name: 'Podcast', agent_id: 'original' }], catalog_revision: '1', missing_skill_ids: [], system_resources: [] });
});
afterEach(async () => { await act(async () => { await Promise.resolve(); root.unmount(); }); container.remove(); vi.unstubAllGlobals(); });
it('shows the current executor and changes it with concurrency protection', async () => {
    vi.mocked(bindAgentOperation).mockResolvedValue(undefined);
    await act(async () => { await Promise.resolve(); root.render(<AgentBehaviorInspection profile={{ id: 'personal' }} operationsOnly />); });
    expect(container.textContent).toContain('original');
    await act(async () => { await Promise.resolve(); container.querySelector('button')?.click(); });
    expect(bindAgentOperation).toHaveBeenCalledWith('podcast', 'personal', 'original');
    expect(previewAgentBehavior).toHaveBeenCalledTimes(2);
});
it('inspects the draft without changing an operation binding', async () => {
    await act(async () => { await Promise.resolve(); root.render(<AgentBehaviorInspection profile={{ id: 'personal', persona: 'Draft' }} />); });
    expect(container.textContent).toContain('Persona');
    expect(container.textContent).toContain('Data boundary');
    expect(bindAgentOperation).not.toHaveBeenCalled();
});
