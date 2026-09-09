import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';

import { AuthProvider } from '../features/auth/context/AuthProvider';
import type { AuthUser } from '../shared/api/auth';
import type { PluginState } from '../shared/api/plugins';
import { GnosiApiError } from '../shared/api/errors';
import {
    ACTIVE_VAULT_ID_KEY,
    ACTIVE_VAULT_SLUG_KEY,
    getActiveVaultId,
    persistVaultCatalog,
    storageSet,
} from '../shared/api/vault-context';
import { resetApiTestStorage } from '../../tests/api-request';
import App from './App';

const mocks = vi.hoisted(() => ({
    fetchCurrentAuthUser: vi.fn(),
    fetchSystemHealth: vi.fn(),
    fetchPluginState: vi.fn(),
    fetchVaultCatalog: vi.fn(),
    invalidateVaultCatalog: vi.fn(),
    loginWithPassword: vi.fn(),
    logoutCurrentUser: vi.fn(),
    success: vi.fn(),
}));

vi.mock('../shared/api/auth', async (importOriginal) => ({
    ...await importOriginal<typeof import('../shared/api/auth')>(),
    fetchCurrentAuthUser: mocks.fetchCurrentAuthUser,
    loginWithPassword: mocks.loginWithPassword,
    logoutCurrentUser: mocks.logoutCurrentUser,
}));
vi.mock('../shared/api/system', async (importOriginal) => ({
    ...await importOriginal<typeof import('../shared/api/system')>(),
    fetchSystemHealth: mocks.fetchSystemHealth,
}));
vi.mock('../shared/api/plugins', async (importOriginal) => ({
    ...await importOriginal<typeof import('../shared/api/plugins')>(),
    fetchPluginState: mocks.fetchPluginState,
}));
vi.mock('../shared/api/vault-catalog', () => ({
    fetchVaultCatalog: mocks.fetchVaultCatalog,
    invalidateVaultCatalog: mocks.invalidateVaultCatalog,
}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));
vi.mock('../shared/hooks/useTheme', () => ({ useTheme: () => ({ effectiveTheme: 'light' }) }));
vi.mock('../shared/hooks/useFocusModality', () => ({ useFocusModality: () => undefined }));
vi.mock('./integration/useFileLinkInterceptor', () => ({ useFileLinkInterceptor: () => undefined }));
vi.mock('./routes', () => ({
    ApplicationRoutes: () => <div data-app-route>Application ready</div>,
    SharedRoutes: () => null,
}));
vi.mock('./navigation/AppSidebar', () => ({ AppSidebar: () => null }));
vi.mock('./navigation/CommandPalette', () => ({ default: () => null }));
vi.mock('./outline/PageOutline', () => ({ default: () => null }));
vi.mock('./desktop/DesktopUpdateNotice', () => ({ DesktopUpdateNotice: () => null }));
vi.mock('../features/notebooks', () => ({ NotebookCreateDialog: () => null }));
vi.mock('../features/meetings', () => ({ MeetingRecorder: () => null, MeetingReminderWatcher: () => null }));
vi.mock('../features/agent/AgentChatLauncher', () => ({ AgentChatLauncher: () => null }));
vi.mock('../features/agent-context/model/vaultAgentContext', () => ({ vaultAgentContextRefs: () => [] }));
vi.mock('../shared/notifications/toast', () => ({ Toaster: () => null, toast: { success: mocks.success } }));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    window.history.replaceState(null, '', '/');
    resetApiTestStorage();
    vi.resetAllMocks();
});

function setInput(view: ParentNode, type: string, value: string): void {
    const input = view.querySelector(`input[type="${type}"]`);
    if (!(input instanceof HTMLInputElement)) throw new Error(`Missing ${type} field`);
    act(() => {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        if (!descriptor?.set) throw new Error('Missing input setter');
        descriptor.set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

it('reloads the catalog and plugins after login to the same vault, then leaves Login', async () => {
    const vault = { id: 'login-recovery-vault', slug: 'login-recovery-vault', name: 'Synthetic vault' };
    const user: AuthUser = {
        id: 'synthetic-user', email: 'member@example.test',
        workspaces: [{ id: 'personal', name: 'Personal', role: 'owner' }],
    };
    resetApiTestStorage();
    persistVaultCatalog([vault]);
    storageSet(ACTIVE_VAULT_ID_KEY, vault.id);
    storageSet(ACTIVE_VAULT_SLUG_KEY, vault.slug);
    window.history.replaceState(null, '', `/@${vault.slug}/calendar`);
    mocks.fetchSystemHealth.mockResolvedValue({
        status: 'ok', gnosi_mode: 'personal', require_auth: false,
    });
    mocks.fetchCurrentAuthUser.mockRejectedValue(new GnosiApiError(
        new Response(null, { status: 401 }), { detail: 'Not authenticated' },
    ));
    mocks.loginWithPassword.mockResolvedValue(user);
    mocks.fetchVaultCatalog.mockResolvedValue({ vaults: [vault] });
    mocks.invalidateVaultCatalog.mockResolvedValue(undefined);
    let finishPlugins: (value: PluginState) => void = () => { throw new Error('Plugin refresh not started'); };
    mocks.fetchPluginState
        .mockRejectedValueOnce(new GnosiApiError(
            new Response(null, { status: 401 }), { detail: 'Authentication required' },
        ))
        .mockImplementationOnce(() => new Promise<PluginState>((resolve) => { finishPlugins = resolve; }));

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
        root?.render(<MemoryRouter initialEntries={[window.location.pathname]}>
            <AuthProvider><App /></AuthProvider>
        </MemoryRouter>);
        await Promise.resolve();
    });
    expect(container.querySelector('form')).not.toBeNull();
    expect(mocks.fetchPluginState).toHaveBeenCalledOnce();
    expect(mocks.loginWithPassword).not.toHaveBeenCalled();
    setInput(container, 'email', user.email);
    setInput(container, 'password', 'synthetic-password');
    const form = container.querySelector('form');
    if (!form) throw new Error('Expected Login form');
    await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await Promise.resolve();
    });

    expect(mocks.loginWithPassword).toHaveBeenCalledWith({ email: user.email, password: 'synthetic-password' });
    expect(mocks.invalidateVaultCatalog).toHaveBeenCalledOnce();
    expect(mocks.fetchVaultCatalog).toHaveBeenCalledOnce();
    expect(mocks.fetchPluginState).toHaveBeenCalledTimes(2);
    expect(getActiveVaultId()).toBe(vault.id);
    // Keep the gate until the new credential has produced a successful read.
    expect(container.querySelector('form')).not.toBeNull();
    expect(container.querySelector('[data-app-route]')).toBeNull();
    await act(async () => { finishPlugins({ enabled_builtin: ['calendar'] }); await Promise.resolve(); });

    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('[data-app-route]')).not.toBeNull();
    expect(mocks.fetchPluginState).toHaveBeenCalledTimes(2);
    expect(mocks.logoutCurrentUser).not.toHaveBeenCalled();
});
