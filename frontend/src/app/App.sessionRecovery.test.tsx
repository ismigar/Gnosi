import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import type { AuthContextValue } from '../shared/auth/auth-context';
import App from './App';

const mocks = vi.hoisted(() => ({ recover: vi.fn(), pluginRetry: vi.fn() }));
const pluginFailure = vi.hoisted((): { authenticationRequired?: true } => ({}));
const auth = vi.hoisted(() => ({
    user: null,
    gnosiMode: 'personal',
    requireAuth: false,
    loading: false,
    sessionRecovery: null as AuthContextValue['sessionRecovery'],
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));
vi.mock('../shared/auth/auth-context', () => ({ useAuth: () => auth }));
vi.mock('../shared/plugins/usePlugins', () => ({
    usePlugins: () => ({ loaded: false, loadError: true, reload: mocks.pluginRetry, ...pluginFailure }),
}));
vi.mock('../shared/hooks/useTheme', () => ({ useTheme: () => ({ effectiveTheme: 'light' }) }));
vi.mock('../shared/hooks/useFocusModality', () => ({ useFocusModality: () => undefined }));
vi.mock('./integration/useFileLinkInterceptor', () => ({ useFileLinkInterceptor: () => undefined }));
vi.mock('./routes', () => ({
    ApplicationRoutes: () => <div data-app-route />,
    SharedRoutes: () => <div data-shared-route>Public shared page</div>,
}));
vi.mock('./navigation/AppSidebar', () => ({ AppSidebar: () => null }));
vi.mock('./navigation/CommandPalette', () => ({ default: () => null }));
vi.mock('./outline/PageOutline', () => ({ default: () => null }));
vi.mock('./desktop/DesktopUpdateNotice', () => ({ DesktopUpdateNotice: () => null }));
vi.mock('../features/notebooks', () => ({ NotebookCreateDialog: () => null }));
vi.mock('../features/meetings', () => ({ MeetingRecorder: () => null, MeetingReminderWatcher: () => null }));
vi.mock('../features/agent/AgentChatLauncher', () => ({ AgentChatLauncher: () => null }));
vi.mock('../features/agent-context/model/vaultAgentContext', () => ({ vaultAgentContextRefs: () => [] }));
vi.mock('../features/auth', () => ({ LoginPage: () => <div data-login>Login required</div> }));
vi.mock('../shared/notifications/toast', () => ({ Toaster: () => null }));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
    auth.requireAuth = false;
    auth.gnosiMode = 'personal';
    auth.sessionRecovery = null;
    delete pluginFailure.authenticationRequired;
    window.history.replaceState(null, '', '/');
});

afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    window.history.replaceState(null, '', '/');
    vi.resetAllMocks();
});

async function mount(): Promise<HTMLDivElement> {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
        root?.render(<MemoryRouter initialEntries={[window.location.pathname]}><App /></MemoryRouter>);
        await Promise.resolve();
    });
    return container;
}

it.each([false, true])('shows explicit session recovery with requireAuth=%s', async (requireAuth) => {
    auth.requireAuth = requireAuth;
    auth.sessionRecovery = { recover: mocks.recover };
    const view = await mount();

    expect(view.textContent).toContain('This session is no longer valid');
    expect(view.textContent).not.toContain('The configuration could not be loaded');
    expect(view.querySelector('[data-login]')).toBeNull();
    expect(mocks.recover).not.toHaveBeenCalled();
    expect(mocks.pluginRetry).not.toHaveBeenCalled();
    expect(auth.requireAuth).toBe(requireAuth);
});

it('keeps failed recovery visible and retries only through the explicit action', async () => {
    mocks.recover.mockRejectedValueOnce(new Error('Synthetic logout failure')).mockResolvedValueOnce(undefined);
    auth.sessionRecovery = { recover: mocks.recover };
    const view = await mount();
    const button = view.querySelector('button');
    if (!button) throw new Error('Expected recovery button');

    await act(async () => { button.click(); await Promise.resolve(); });
    expect(view.querySelector('[role="alert"]')?.textContent).toContain('The session could not be cleared');
    expect(button.disabled).toBe(false);
    expect(mocks.recover).toHaveBeenCalledOnce();
    expect(auth.requireAuth).toBe(false);

    await act(async () => { button.click(); await Promise.resolve(); });
    expect(mocks.recover).toHaveBeenCalledTimes(2);
    expect(view.querySelector('[role="alert"]')).toBeNull();
});

it('leaves public shared pages outside session recovery and the login gate', async () => {
    auth.requireAuth = true;
    pluginFailure.authenticationRequired = true;
    auth.sessionRecovery = { recover: mocks.recover };
    window.history.replaceState(null, '', '/s/synthetic-share');
    const view = await mount();

    expect(view.querySelector('[data-shared-route]')).not.toBeNull();
    expect(view.querySelector('[data-login]')).toBeNull();
    expect(view.textContent).not.toContain('This session is no longer valid');
    expect(mocks.recover).not.toHaveBeenCalled();
});

it('shows Login after an explicit server denial even when health allows anonymous access', async () => {
    pluginFailure.authenticationRequired = true;
    const view = await mount();

    expect(view.querySelector('[data-login]')).not.toBeNull();
    expect(view.textContent).not.toContain('The configuration could not be loaded');
    expect(auth.requireAuth).toBe(false);
    expect(mocks.recover).not.toHaveBeenCalled();
    expect(mocks.pluginRetry).not.toHaveBeenCalled();
});

it('keeps invalid-session recovery ahead of the server authentication hint', async () => {
    pluginFailure.authenticationRequired = true;
    auth.sessionRecovery = { recover: mocks.recover };
    const view = await mount();

    expect(view.textContent).toContain('This session is no longer valid');
    expect(view.querySelector('[data-login]')).toBeNull();
    expect(auth.requireAuth).toBe(false);
});

it.each([false, true])('keeps the existing anonymous gate with requireAuth=%s', async (requireAuth) => {
    auth.requireAuth = requireAuth;
    const view = await mount();

    expect(view.querySelector('[data-login]') !== null).toBe(requireAuth);
    expect(view.textContent.includes('The configuration could not be loaded')).toBe(!requireAuth);
    expect(view.textContent).not.toContain('This session is no longer valid');
    expect(mocks.recover).not.toHaveBeenCalled();
});
