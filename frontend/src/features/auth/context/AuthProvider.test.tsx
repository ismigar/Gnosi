import { act, useContext, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../../../shared/api/auth';
import { GnosiApiError } from '../../../shared/api/errors';
import {
    USER_EMAIL_STORAGE_KEY,
    USER_ID_STORAGE_KEY,
    USER_ROLE_STORAGE_KEY,
    WORKSPACE_ID_STORAGE_KEY,
} from '../../../shared/api/request-context';
import { AuthContext, type AuthContextValue } from '../../../shared/auth/auth-context';
import {
    readStorage,
    removeStorage,
    writeStorage,
} from '../../../shared/platform/browser-storage';
import { AUTH_BOOTSTRAP_TIMEOUT_MS, AuthProvider } from './AuthProvider';

const mocks = vi.hoisted(() => ({
    fetchCurrentAuthUser: vi.fn(),
    fetchSystemHealth: vi.fn(),
    initializeVaultRouting: vi.fn(),
    registerWithPassword: vi.fn(),
    logoutCurrentUser: vi.fn(),
    reloadBrowserPage: vi.fn(),
}));

vi.mock('../../../shared/api/auth', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../../shared/api/auth')>();
    return {
        ...original,
        fetchCurrentAuthUser: mocks.fetchCurrentAuthUser,
        registerWithPassword: mocks.registerWithPassword,
        logoutCurrentUser: mocks.logoutCurrentUser,
    };
});

vi.mock('../../../shared/platform/browser-events', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../../shared/platform/browser-events')>();
    return { ...original, reloadBrowserPage: mocks.reloadBrowserPage };
});

vi.mock('../../../shared/notifications/notifyError', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../../shared/notifications/notifyError')>();
    return { ...original, logError: vi.fn() };
});

vi.mock('../../../shared/routing/vaultRouting', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../../shared/routing/vaultRouting')>();
    return {
        ...original,
        initializeVaultRouting: mocks.initializeVaultRouting,
    };
});

vi.mock('../../../shared/api/system', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../../shared/api/system')>();
    return {
        ...original,
        fetchSystemHealth: mocks.fetchSystemHealth,
    };
});

const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
};
const mountedRoots: Array<{ readonly container: HTMLDivElement; readonly root: Root }> = [];
const observedSignals: AbortSignal[] = [];
let currentAuth: AuthContextValue | null = null;

beforeAll(() => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
    while (mountedRoots.length > 0) {
        const mounted = mountedRoots.pop();
        if (!mounted) break;
        act(() => {
            mounted.root.unmount();
        });
        mounted.container.remove();
    }
    currentAuth = null;
    observedSignals.length = 0;
    removeStorage(USER_ROLE_STORAGE_KEY);
    removeStorage(WORKSPACE_ID_STORAGE_KEY);
    removeStorage(USER_ID_STORAGE_KEY);
    removeStorage(USER_EMAIL_STORAGE_KEY);
    vi.useRealTimers();
    vi.resetAllMocks();
});

function indefinitelyPending<T>(signal?: AbortSignal): Promise<T> {
    if (!signal) throw new Error('Expected a bootstrap AbortSignal');
    observedSignals.push(signal);
    return new Promise<T>(() => undefined);
}

function AuthProbe(): null {
    const auth = useContext(AuthContext);
    useEffect(() => {
        currentAuth = auth;
    }, [auth]);
    return null;
}

async function mountProvider(): Promise<void> {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ container, root });
    await act(async () => {
        root.render(<AuthProvider><AuthProbe /></AuthProvider>);
        await Promise.resolve();
    });
}

function authValue(): AuthContextValue {
    if (!currentAuth) throw new Error('AuthProvider did not publish a value');
    return currentAuth;
}

const recoveredUser: AuthUser = {
    id: 'user-1',
    email: 'member@example.test',
    name: 'Member',
    avatar_url: null,
    workspaces: [],
};

function apiFailure(detail: string, status = 401): GnosiApiError {
    return new GnosiApiError(new Response(null, { status }), { detail });
}

const persistedIdentity = [
    [USER_ID_STORAGE_KEY, 'previous-user'],
    [USER_EMAIL_STORAGE_KEY, 'previous@example.test'],
    [USER_ROLE_STORAGE_KEY, 'owner'],
    [WORKSPACE_ID_STORAGE_KEY, 'previous-workspace'],
] as const;

describe('AuthProvider bootstrap resilience', () => {
    it.each([
        { requireAuth: false, status: 401, detail: 'Sessió expirada o invàlida', recoverable: true },
        { requireAuth: true, status: 401, detail: 'Sessió expirada o invàlida', recoverable: true },
        { requireAuth: false, status: 401, detail: 'Not authenticated', recoverable: false },
        { requireAuth: true, status: 401, detail: 'Not authenticated', recoverable: false },
        { requireAuth: false, status: 401, detail: 'Authentication required', recoverable: false },
        { requireAuth: false, status: 500, detail: 'Sessió expirada o invàlida', recoverable: false },
    ])('classifies $status/$detail while preserving requireAuth=$requireAuth', async ({
        requireAuth, status, detail, recoverable,
    }) => {
        mocks.fetchSystemHealth.mockResolvedValue({
            status: 'ok', gnosi_mode: 'personal', require_auth: requireAuth,
        });
        mocks.fetchCurrentAuthUser.mockRejectedValue(apiFailure(detail, status));
        await mountProvider();

        expect(authValue()).toMatchObject({ loading: false, user: null, requireAuth });
        expect(authValue().sessionRecovery !== null).toBe(recoverable);
        expect(mocks.logoutCurrentUser).not.toHaveBeenCalled();
        expect(mocks.reloadBrowserPage).not.toHaveBeenCalled();
    });

    it('keeps invalid-session recovery when anonymous health arrives last', async () => {
        let resolveHealth: (health: unknown) => void = () => { throw new Error('Health not started'); };
        mocks.fetchSystemHealth.mockImplementation(() => new Promise((resolve) => { resolveHealth = resolve; }));
        mocks.fetchCurrentAuthUser.mockRejectedValue(apiFailure('Sessió expirada o invàlida'));
        await mountProvider();
        expect(authValue().loading).toBe(true);

        await act(async () => {
            resolveHealth({ status: 'ok', gnosi_mode: 'personal', require_auth: false });
            await Promise.resolve();
        });
        expect(authValue()).toMatchObject({ loading: false, requireAuth: false });
        expect(authValue().sessionRecovery).not.toBeNull();
        expect(mocks.logoutCurrentUser).not.toHaveBeenCalled();
    });

    it('propagates failed explicit logout without clearing identity or reloading', async () => {
        mocks.fetchSystemHealth.mockResolvedValue({
            status: 'ok', gnosi_mode: 'personal', require_auth: false,
        });
        mocks.fetchCurrentAuthUser.mockRejectedValue(apiFailure('Sessió expirada o invàlida'));
        const failure = new TypeError('Synthetic unavailable logout');
        mocks.logoutCurrentUser.mockRejectedValue(failure);
        for (const [key, value] of persistedIdentity) writeStorage(key, value);
        await mountProvider();
        const recovery = authValue().sessionRecovery;
        if (!recovery) throw new Error('Expected session recovery');

        await act(async () => {
            await expect(recovery.recover()).rejects.toBe(failure);
        });
        for (const [key, value] of persistedIdentity) expect(readStorage(key)).toBe(value);
        expect(authValue()).toMatchObject({ requireAuth: false, user: null });
        expect(authValue().sessionRecovery).not.toBeNull();
        expect(mocks.logoutCurrentUser).toHaveBeenCalledOnce();
        expect(mocks.reloadBrowserPage).not.toHaveBeenCalled();
    });

    it('clears identity and reloads only after explicit logout succeeds', async () => {
        mocks.fetchSystemHealth.mockResolvedValue({
            status: 'ok', gnosi_mode: 'personal', require_auth: true,
        });
        mocks.fetchCurrentAuthUser.mockRejectedValue(apiFailure('Sessió expirada o invàlida'));
        let finishLogout: () => void = () => { throw new Error('Logout not started'); };
        mocks.logoutCurrentUser.mockImplementation(() => new Promise<void>((resolve) => { finishLogout = resolve; }));
        for (const [key, value] of persistedIdentity) writeStorage(key, value);
        mocks.reloadBrowserPage.mockImplementation(() => {
            for (const [key] of persistedIdentity) expect(readStorage(key)).toBeUndefined();
        });
        await mountProvider();
        const recovery = authValue().sessionRecovery;
        if (!recovery) throw new Error('Expected session recovery');
        let pending: Promise<void> | undefined;

        await act(async () => { pending = recovery.recover(); await Promise.resolve(); });
        for (const [key, value] of persistedIdentity) expect(readStorage(key)).toBe(value);
        expect(mocks.reloadBrowserPage).not.toHaveBeenCalled();
        await act(async () => { finishLogout(); await pending; });

        expect(mocks.logoutCurrentUser).toHaveBeenCalledOnce();
        expect(mocks.reloadBrowserPage).toHaveBeenCalledOnce();
        expect(authValue().requireAuth).toBe(true);
        expect(mocks.initializeVaultRouting).not.toHaveBeenCalled();
    });

    it('releases loading after aborting pending requests and recovers on remount', async () => {
        vi.useFakeTimers();
        mocks.fetchSystemHealth.mockImplementationOnce(indefinitelyPending);
        mocks.fetchCurrentAuthUser.mockImplementationOnce(indefinitelyPending);

        await mountProvider();
        expect(authValue().loading).toBe(true);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(AUTH_BOOTSTRAP_TIMEOUT_MS);
        });

        expect(authValue()).toMatchObject({
            gnosiMode: 'personal',
            loading: false,
            requireAuth: false,
            user: null,
        });
        const [healthSignal, authSignal] = observedSignals;
        expect(healthSignal).toBeInstanceOf(AbortSignal);
        expect(authSignal).toBeInstanceOf(AbortSignal);
        expect(healthSignal?.aborted).toBe(true);
        expect(authSignal?.aborted).toBe(true);

        const firstMount = mountedRoots.pop();
        if (!firstMount) throw new Error('Missing first AuthProvider mount');
        act(() => {
            firstMount.root.unmount();
        });
        firstMount.container.remove();

        mocks.fetchSystemHealth.mockResolvedValueOnce({
            status: 'ok',
            vault_configured: true,
            gnosi_mode: 'team',
            require_auth: true,
        });
        mocks.fetchCurrentAuthUser.mockResolvedValueOnce(recoveredUser);
        await mountProvider();
        await act(async () => {
            await Promise.resolve();
        });

        expect(authValue()).toMatchObject({
            gnosiMode: 'team',
            loading: false,
            requireAuth: true,
            user: recoveredUser,
        });
        expect(mocks.fetchSystemHealth).toHaveBeenCalledTimes(2);
        expect(mocks.fetchCurrentAuthUser).toHaveBeenCalledTimes(2);
    });

    it('hydrates the personal owner role before publishing a newly registered user', async () => {
        const registeredUser: AuthUser = {
            ...recoveredUser,
            email: 'new@example.com',
        };
        const hydratedUser: AuthUser = {
            ...registeredUser,
            workspaces: [{ id: 'personal', name: 'Personal', role: 'owner' }],
        };
        mocks.fetchSystemHealth.mockResolvedValue({
            status: 'ok',
            vault_configured: true,
            gnosi_mode: 'personal',
            require_auth: true,
        });
        mocks.fetchCurrentAuthUser
            .mockRejectedValueOnce(new DOMException('No session', 'AbortError'))
            .mockResolvedValueOnce(hydratedUser);
        mocks.registerWithPassword.mockResolvedValue(registeredUser);
        mocks.initializeVaultRouting.mockImplementation(() => {
            expect(readStorage(WORKSPACE_ID_STORAGE_KEY)).toBeUndefined();
            expect(readStorage(USER_ROLE_STORAGE_KEY)).toBeUndefined();
            return Promise.resolve({
                active: { id: 'vault-1', name: 'Main Vault', slug: 'main-vault' },
                routeFound: true,
                vaults: [],
            });
        });
        writeStorage(USER_ROLE_STORAGE_KEY, 'viewer');
        writeStorage(WORKSPACE_ID_STORAGE_KEY, 'stale-workspace');

        await mountProvider();
        let result: AuthUser | undefined;
        await act(async () => {
            result = await authValue().register(
                registeredUser.email,
                'password-1',
                registeredUser.name ?? undefined,
            );
        });

        expect(mocks.registerWithPassword).toHaveBeenCalledOnce();
        expect(mocks.initializeVaultRouting).toHaveBeenCalledWith({ force: true });
        expect(mocks.fetchCurrentAuthUser).toHaveBeenCalledTimes(2);
        expect(result).toEqual(hydratedUser);
        expect(authValue().user).toEqual(hydratedUser);
        expect(readStorage(WORKSPACE_ID_STORAGE_KEY)).toBe('personal');
        expect(readStorage(USER_ROLE_STORAGE_KEY)).toBe('owner');
    });
});
