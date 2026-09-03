import { act, useContext, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../../../shared/api/auth';
import {
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
}));

vi.mock('../../../shared/api/auth', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../../shared/api/auth')>();
    return {
        ...original,
        fetchCurrentAuthUser: mocks.fetchCurrentAuthUser,
        registerWithPassword: mocks.registerWithPassword,
    };
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

describe('AuthProvider bootstrap resilience', () => {
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
        mocks.initializeVaultRouting.mockImplementation(async () => {
            expect(readStorage(WORKSPACE_ID_STORAGE_KEY)).toBeUndefined();
            expect(readStorage(USER_ROLE_STORAGE_KEY)).toBeUndefined();
            return {
                active: { id: 'vault-1', name: 'Main Vault', slug: 'main-vault' },
                routeFound: true,
                vaults: [],
            };
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
