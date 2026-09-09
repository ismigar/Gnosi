import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, beforeAll, expect, it, vi} from 'vitest';

import App from './App';
import {PluginRoute} from '../shared/plugins/PluginGate';
import {PLUGIN_BOOTSTRAP_TIMEOUT_MS, reloadPluginState} from '../shared/plugins/usePlugins';
import {emitAppEvent} from '../shared/platform/app-events';
import {
    ACTIVE_VAULT_ID_KEY,
    ACTIVE_VAULT_SLUG_KEY,
    getActiveVaultId,
    persistVaultCatalog,
    storageSet,
} from '../shared/api/vault-context';
import {requestAt, resetApiTestStorage} from '../../tests/api-request';

const auth = vi.hoisted(() => ({
    user: null,
    gnosiMode: 'personal',
    requireAuth: false,
    loading: false,
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({t: (key: string, fallback?: string) => fallback ?? key}),
}));
vi.mock('../shared/auth/auth-context', () => ({useAuth: () => auth}));
vi.mock('../shared/hooks/useTheme', () => ({useTheme: () => ({effectiveTheme: 'light'})}));
vi.mock('../shared/hooks/useFocusModality', () => ({useFocusModality: () => undefined}));
vi.mock('./integration/useFileLinkInterceptor', () => ({useFileLinkInterceptor: () => undefined}));
vi.mock('./routes', () => ({
    ApplicationRoutes: () => <div data-app-route>Loaded application route</div>,
    SharedRoutes: () => null,
}));
vi.mock('./navigation/AppSidebar', () => ({AppSidebar: () => null}));
vi.mock('./navigation/CommandPalette', () => ({default: () => null}));
vi.mock('./outline/PageOutline', () => ({default: () => null}));
vi.mock('./desktop/DesktopUpdateNotice', () => ({DesktopUpdateNotice: () => null}));
vi.mock('../features/notebooks', () => ({NotebookCreateDialog: () => null}));
vi.mock('../features/meetings', () => ({MeetingRecorder: () => null, MeetingReminderWatcher: () => null}));
vi.mock('../features/agent/AgentChatLauncher', () => ({AgentChatLauncher: () => null}));
vi.mock('../features/agent-context/model/vaultAgentContext', () => ({vaultAgentContextRefs: () => []}));
vi.mock('../features/auth', () => ({LoginPage: () => <div data-login>Login required</div>}));
vi.mock('../shared/notifications/toast', () => ({Toaster: () => null}));

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeAll(() => {
    (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    resetApiTestStorage();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

function renderGates() {
    root?.render(
        <MemoryRouter initialEntries={['/@fixture-a/mail']}>
            <App />
            <aside data-plugin-route>
                <PluginRoute pluginId="mail"><div data-mail>Loaded mail</div></PluginRoute>
            </aside>
        </MemoryRouter>,
    );
}

function retryButton(scope: ParentNode): HTMLButtonElement {
    const button = scope.querySelector('[role="alert"] button');
    if (!(button instanceof HTMLButtonElement)) throw new Error('Expected a visible retry action');
    return button;
}

it('recovers App and PluginRoute after timeout and rejection through real retry clicks in the active vault', async () => {
    vi.useFakeTimers();
    resetApiTestStorage();
    persistVaultCatalog([
        {id: 'vault-a', slug: 'fixture-a'},
        {id: 'vault-b', slug: 'fixture-b'},
    ]);
    storageSet(ACTIVE_VAULT_ID_KEY, 'vault-a');
    storageSet(ACTIVE_VAULT_SLUG_KEY, 'fixture-a');

    let resolveRetry: (value: Response) => void = () => {throw new Error('Retry has not started');};
    let resolveStale: (value: Response) => void = () => {throw new Error('Old vault reload has not started');};
    const fetchMock = vi.fn<typeof fetch>()
        .mockImplementationOnce(() => new Promise<Response>(() => undefined))
        .mockImplementationOnce(() => new Promise<Response>((resolve) => {resolveRetry = resolve;}))
        .mockImplementationOnce(() => new Promise<Response>((resolve) => {resolveStale = resolve;}))
        .mockRejectedValueOnce(new TypeError('Network unavailable'))
        .mockResolvedValueOnce(Response.json({enabled_builtin: [], disabled: ['mail']}));
    vi.stubGlobal('fetch', fetchMock);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {renderGates(); await Promise.resolve();});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector('main')).toBeNull();
    expect(container.querySelector('[data-mail]')).toBeNull();
    await act(async () => {await vi.advanceTimersByTimeAsync(PLUGIN_BOOTSTRAP_TIMEOUT_MS);});
    expect(requestAt(fetchMock.mock.calls, 0).signal.aborted).toBe(true);
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(2);
    expect(container.textContent).toContain('The configuration could not be loaded');

    // A catalog failure must not bypass the session gate.
    auth.requireAuth = true;
    await act(async () => {renderGates(); await Promise.resolve();});
    expect(container.querySelector('[data-login]')).not.toBeNull();
    expect(container.querySelector('main')).toBeNull();
    auth.requireAuth = false;
    await act(async () => {renderGates(); await Promise.resolve();});

    const retry = retryButton(container);
    await act(async () => {retry.click(); await Promise.resolve();});
    expect(retry.disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.querySelector('main')).toBeNull();
    expect(container.querySelector('[data-mail]')).toBeNull();
    await act(async () => {resolveRetry(Response.json({enabled_builtin: ['mail']})); await Promise.resolve();});
    expect(container.querySelector('[data-app-route]')).not.toBeNull();
    expect(container.querySelector('[data-mail]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(getActiveVaultId()).toBe('vault-a');

    let staleReload: ReturnType<typeof reloadPluginState> | undefined;
    await act(async () => {staleReload = reloadPluginState(); await Promise.resolve();});
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => {
        storageSet(ACTIVE_VAULT_ID_KEY, 'vault-b');
        storageSet(ACTIVE_VAULT_SLUG_KEY, 'fixture-b');
        emitAppEvent('gnosi:vault-changed', {id: 'vault-b', name: 'Fixture B', slug: 'fixture-b'});
        await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(requestAt(fetchMock.mock.calls, 2).signal.aborted).toBe(true);
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(2);
    expect(container.querySelector('main')).toBeNull();
    expect(container.querySelector('[data-mail]')).toBeNull();
    // Even a transport that completes after cancellation cannot restore vault A.
    await act(async () => {
        resolveStale(Response.json({enabled_builtin: ['mail']}));
        await staleReload;
    });
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(2);
    expect(container.querySelector('main')).toBeNull();
    expect(container.querySelector('[data-mail]')).toBeNull();
    const pluginRoute = container.querySelector('[data-plugin-route]');
    if (!pluginRoute) throw new Error('Expected the plugin route');
    await act(async () => {retryButton(pluginRoute).click(); await Promise.resolve();});

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(getActiveVaultId()).toBe('vault-b');
    expect(container.querySelector('[data-app-route]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[data-mail]')).toBeNull();
    expect(pluginRoute.textContent).toContain('Activate this plugin');
    for (const index of [0, 1, 2, 3, 4]) {
        const request = requestAt(fetchMock.mock.calls, index);
        const suffix = index < 3 ? 'a' : 'b';
        expect(request.method).toBe('GET');
        expect(request.headers.get('X-Vault-ID')).toBe(`vault-${suffix}`);
        expect(new URL(request.url).pathname).toBe('/api/vault/plugins');
    }
});
