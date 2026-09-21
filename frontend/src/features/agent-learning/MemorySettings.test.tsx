import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { MemoryList } from './MemorySettings';

const api = vi.hoisted(() => ({ fetch: vi.fn(), workspace: vi.fn(), save: vi.fn(), remove: vi.fn() }));
vi.mock('../../shared/api/agent-learning', () => ({ fetchAgentMemories: api.fetch, fetchLearningWorkspace: api.workspace, saveAgentMemory: api.save, removeAgentMemory: api.remove }));
const locale = createInstance();
let container: HTMLDivElement;
let root: Root;
const memory = { memory_id: 'synthetic', text: 'Use short summaries', category: 'preference', enabled: true, revision: 3, scope_kind: 'project', scope_id: 'project', provenance: 'conversation', updated_at: '2026-01-01T00:00:00Z', expires_at: null };
beforeAll(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    await locale.init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } });
});
beforeEach(() => {
    vi.resetAllMocks();
    api.fetch.mockResolvedValue({ memories: [memory] });
    api.workspace.mockResolvedValue({ projects: [{ id: 'project', name: 'Synthetic project' }], project_id: '' });
    api.save.mockResolvedValue({});
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => { root.unmount(); await Promise.resolve(); }); container.remove(); });
async function render(canEdit = true) {
    await act(async () => { root.render(<I18nextProvider i18n={locale}><MemoryList agentId="helper" skills={[]} canEdit={canEdit} /></I18nextProvider>); await Promise.resolve(); });
}
it('shows scope and provenance and preserves revision when disabling a memory', async () => {
    await render();
    expect(container.textContent).toContain('Synthetic project');
    expect(container.textContent).toContain('learning.from_conversation');
    const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]');
    expect(toggle).not.toBeNull();
    await act(async () => { toggle?.click(); await Promise.resolve(); });
    expect(api.save).toHaveBeenCalledWith('helper', expect.objectContaining({ scope_kind: 'project', scope_id: 'project', enabled: false, expected_revision: 3 }), 'synthetic');
});
it('keeps viewers read-only', async () => {
    await render(false);
    expect(container.querySelector('[role="switch"]')).toBeNull();
    expect(container.textContent).not.toContain('common.delete');
    expect(container.textContent).toContain('learning.read_only');
});
it('reports failed loads instead of showing an empty memory list', async () => {
    api.fetch.mockRejectedValue(new Error('synthetic failure'));
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('learning.load_error');
    expect(container.textContent).not.toContain('learning.no_memories');
});
