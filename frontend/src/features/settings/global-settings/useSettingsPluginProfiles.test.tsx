import { act, useState, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { emitConfigChanged } from '../../../shared/platform/configEvents';
import { useSettingsPluginProfiles } from './useSettingsPluginProfiles';
import type { AgentDraft, SettingsDraft } from './types';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), vault: 'same-vault', error: vi.fn() }));
vi.mock('../../../shared/api/configuration', () => ({ fetchEditorConfiguration: mocks.fetch }));
vi.mock('../../../shared/api/vault-context', () => ({ getActiveVaultId: () => mocks.vault }));
vi.mock('../../../shared/notifications/notifyError', () => ({ notifyError: mocks.error }));
const mail = { id: 'mail', managed_by: 'builtin:mail', model: 'saved-model', persona: 'Unsaved local edit' };
let root: Root;
let host: HTMLDivElement;

function Harness({ open = true }: { open?: boolean }) {
    const [draft, setDraft] = useState({ ai: { agents: [mail], active_agent_id: 'mail' } } as SettingsDraft);
    const [editingAgent, setEditingAgent] = useState<AgentDraft | null>(mail);
    useSettingsPluginProfiles({ isOpen: open, setDraft, setEditingAgent, t: ((key: string) => key) as Parameters<typeof useSettingsPluginProfiles>[0]['t'] });
    return <output>{JSON.stringify({ draft, editingAgent })}</output>;
}
function render(props: ComponentProps<typeof Harness> = {}) { act(() => { root.render(<Harness {...props} />); }); }
beforeEach(() => {
    vi.clearAllMocks(); mocks.vault = 'same-vault';
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = document.createElement('div'); root = createRoot(host);
});
afterEach(() => { act(() => { root.unmount(); }); vi.unstubAllGlobals(); });

it('refreshes suspension and restoration in the open form while retaining local edits', async () => {
    render();
    mocks.fetch.mockResolvedValueOnce({ ai: { agents: [{ ...mail, persona: 'Older server value', plugin_suspended: true }] } });
    await act(async () => { emitConfigChanged(); await Promise.resolve(); });
    expect(host.textContent).toContain('"plugin_suspended":true');
    expect(host.textContent).toContain('"editingAgent":null');
    expect(host.textContent).toContain('Unsaved local edit');
    expect(host.textContent).not.toContain('Older server value');
    mocks.fetch.mockResolvedValueOnce({ ai: { agents: [{ ...mail, plugin_suspended: false }] } });
    await act(async () => { emitConfigChanged(); await Promise.resolve(); });
    expect(host.textContent).toContain('"plugin_suspended":false');
    expect(host.textContent).toContain('"active_agent_id":"mail"');
});

it.each(['closed', 'other-vault'])('discards a late refresh after the form is %s', async target => {
    let resolve: (value: unknown) => void = () => undefined;
    mocks.fetch.mockReturnValueOnce(new Promise(result => { resolve = result; }));
    render();
    act(() => { emitConfigChanged(); });
    if (target === 'closed') render({ open: false });
    else mocks.vault = 'other-vault';
    await act(async () => { resolve({ ai: { agents: [{ ...mail, plugin_suspended: true }] } }); await Promise.resolve(); });
    expect(host.textContent).not.toContain('"plugin_suspended":true');
    expect(mocks.error).not.toHaveBeenCalled();
});
