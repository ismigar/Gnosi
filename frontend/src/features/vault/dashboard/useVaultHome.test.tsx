import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { TFunction } from 'i18next';
import { expect, it, vi } from 'vitest';
import { useVaultHome } from './useVaultHome';
import { fetchVaultHome } from '../../../shared/api/vault-home';
import { getActiveVaultId } from '../../../shared/api/vault-context';
vi.mock('../../../shared/api/vault-home', () => ({ fetchVaultHome: vi.fn(), saveVaultHome: vi.fn() }));
vi.mock('../../../shared/api/vault-context', () => ({ getActiveVaultId: vi.fn() }));
vi.mock('../../../shared/notifications/notifyError', () => ({ notifyError: vi.fn() }));
const t = ((key: string) => key) as TFunction;

it.each(['', 'page/explicit'])('opens home only for a bare vault route (%s)', async nestedPath => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.mocked(getActiveVaultId).mockReturnValue('a');
    vi.mocked(fetchVaultHome).mockResolvedValue('home-a');
    const loadPage = vi.fn(() => Promise.resolve());
    function Harness() {
        useVaultHome({ nestedPath, activeTabId: null, loadPage, t });
        return null;
    }
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
        await act(async () => { root.render(<Harness />); await Promise.resolve(); });
        if (nestedPath) expect(loadPage).not.toHaveBeenCalled();
        else expect(loadPage).toHaveBeenCalledExactlyOnceWith('home-a');
        vi.mocked(getActiveVaultId).mockReturnValue('b');
        vi.mocked(fetchVaultHome).mockResolvedValue('home-b');
        loadPage.mockClear();
        await act(async () => { root.render(<Harness />); await Promise.resolve(); });
        if (nestedPath) expect(loadPage).not.toHaveBeenCalled();
        else expect(loadPage).toHaveBeenCalledExactlyOnceWith('home-b');
    } finally {
        await act(async () => { root.unmount(); await Promise.resolve(); });
        vi.unstubAllGlobals();
    }
});
