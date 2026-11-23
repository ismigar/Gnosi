import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HomePage from './HomePage';
import { ACTIVE_VAULT_SLUG_KEY, storageSet } from '../shared/api/vault-context';

const api = vi.hoisted(() => ({
    mode: 'page',
    fetchPage: vi.fn(),
    fetchHome: vi.fn(),
    scope: { vaultId: 'sample', workspaceId: 'team', userId: 'member', userEmail: '' },
}));
vi.mock('../shared/api/useHomePreferences', () => ({ useHomePreferences: () => ({
    query: { data: { revision: null, start_mode: api.mode, blocks: null } }, scope: api.scope, save: vi.fn(),
}) }));
vi.mock('../shared/api/vault-home', () => ({ fetchVaultHome: api.fetchHome }));
vi.mock('../shared/api/vaults', () => ({ fetchVaultPage: api.fetchPage }));
vi.mock('../features/home-canvas', () => ({ default: () => <div>Personal canvas</div> }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function Destination() { return <p>{useLocation().pathname}</p>; }
const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).forEach(fn => { fn(); }); vi.resetAllMocks(); });

async function render(mode: string) {
    api.mode = mode;
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    storageSet(ACTIVE_VAULT_SLUG_KEY, 'sample');
    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    cleanups.push(() => { act(() => { root.unmount(); }); client.clear(); host.remove(); storageSet(ACTIVE_VAULT_SLUG_KEY, ''); });
    await act(async () => {
        root.render(<QueryClientProvider client={client}><MemoryRouter><Routes>
            <Route path="/" element={<HomePage />} /><Route path="*" element={<Destination />} />
        </Routes></MemoryRouter></QueryClientProvider>);
        await Promise.resolve();
    });
    return host;
}
async function waitForRoute(host: HTMLElement, expected: string) {
    await vi.waitFor(async () => {
        await act(() => new Promise<void>(resolve => { setTimeout(resolve, 10); }));
        expect(host.textContent).toContain(expected);
    });
}

describe('the selected home screen', () => {
    it('opens an existing pinned dashboard and preserves its canonical document route', async () => {
        api.fetchHome.mockResolvedValue('dashboard-id');
        api.fetchPage.mockResolvedValue({ is_dashboard: true });
        const host = await render('page');
        await waitForRoute(host, '/dashboard/dashboard-id');
    });
    it('opens the canvas after a previously pinned page becomes unavailable', async () => {
        api.fetchHome.mockResolvedValue('removed');
        api.fetchPage.mockRejectedValue(new Error('Unavailable'));
        const host = await render('page');
        await waitForRoute(host, 'Personal canvas');
    });
    it('honors a personal canvas override without fetching the old page', async () => {
        const host = await render('canvas');
        await waitForRoute(host, 'Personal canvas');
        expect(api.fetchHome).not.toHaveBeenCalled();
    });
});
