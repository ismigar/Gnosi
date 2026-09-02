import {
    useCallback,
    useEffect,
    useState,
    type PropsWithChildren,
} from 'react';

import { initializeVaultRouting } from '../../../shared/routing/vaultRouting';
import { logError } from '../../../shared/notifications/notifyError';
import {
    changeCurrentPassword,
    fetchCurrentAuthUser,
    loginWithPassword,
    logoutCurrentUser,
    registerWithPassword,
    updateCurrentAuthUser,
    type AuthProfileUpdateInput,
    type AuthUser,
} from '../../../shared/api/auth';
import { GnosiApiError } from '../../../shared/api/errors';
import {
    USER_EMAIL_STORAGE_KEY,
    USER_ID_STORAGE_KEY,
    USER_ROLE_STORAGE_KEY,
    WORKSPACE_ID_STORAGE_KEY,
} from '../../../shared/api/request-context';
import { fetchSystemHealth } from '../../../shared/api/system';
import { emitAppEvent } from '../../../shared/platform/app-events';
import {
    readStorage,
    removeStorage,
    writeStorage,
} from '../../../shared/platform/browser-storage';
import { AuthContext, type AuthContextValue } from '../../../shared/auth/auth-context';

export const AUTH_BOOTSTRAP_TIMEOUT_MS = 10_000;

interface TimedRequest<T> {
    readonly cancel: () => void;
    readonly promise: Promise<T>;
}

function startTimedRequest<T>(
    request: (signal: AbortSignal) => Promise<T>,
): TimedRequest<T> {
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
            controller.abort();
            reject(new DOMException('Bootstrap request timed out', 'TimeoutError'));
        }, AUTH_BOOTSTRAP_TIMEOUT_MS);
    });
    const promise = Promise.race([
        request(controller.signal),
        timeout,
    ]).finally(() => {
        if (timeoutId !== null) clearTimeout(timeoutId);
    });
    return {
        cancel: () => {
            controller.abort();
            if (timeoutId !== null) clearTimeout(timeoutId);
        },
        promise,
    };
}

function persistUser(user: AuthUser): void {
    writeStorage(USER_ID_STORAGE_KEY, user.id);
    writeStorage(USER_EMAIL_STORAGE_KEY, user.email);

    const currentWorkspaceId = readStorage(WORKSPACE_ID_STORAGE_KEY);
    const chosen = user.workspaces.find(
        (workspace) => workspace.id === currentWorkspaceId,
    ) ?? user.workspaces[0];
    if (!chosen) return;
    writeStorage(WORKSPACE_ID_STORAGE_KEY, chosen.id);
    if (chosen.role) writeStorage(USER_ROLE_STORAGE_KEY, chosen.role);
}

function clearPersistedUser(): void {
    removeStorage(USER_ID_STORAGE_KEY);
    removeStorage(USER_EMAIL_STORAGE_KEY);
}

async function refreshVaultRouting(): Promise<void> {
    const { active } = await initializeVaultRouting({ force: true });
    emitAppEvent('gnosi:vault-changed', {
        id: active?.id ?? '',
        name: active?.name ?? '',
        slug: active?.slug ?? '',
    });
}

export function AuthProvider({ children }: PropsWithChildren) {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [gnosiMode, setGnosiMode] = useState<string | null>(null);
    const [requireAuth, setRequireAuth] = useState(false);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async (): Promise<AuthUser | null> => {
        try {
            const currentUser = await fetchCurrentAuthUser();
            setUser(currentUser);
            persistUser(currentUser);
            return currentUser;
        } catch (error: unknown) {
            if (!(error instanceof GnosiApiError) || error.status !== 401) {
                logError('auth-current-user', error);
            }
            setUser(null);
            return null;
        }
    }, []);

    useEffect(() => {
        let alive = true;
        const healthRequest = startTimedRequest(fetchSystemHealth);
        const authRequest = startTimedRequest(fetchCurrentAuthUser);
        const initialize = async (): Promise<void> => {
            const healthResult = healthRequest.promise
                .then((health) => {
                    if (!alive) return;
                    setGnosiMode(health.gnosi_mode || 'personal');
                    setRequireAuth(health.require_auth);
                })
                .catch(() => {
                    if (!alive) return;
                    setGnosiMode('personal');
                    setRequireAuth(false);
                });
            const authResult = authRequest.promise
                .then((currentUser) => {
                    if (!alive) return;
                    setUser(currentUser);
                    persistUser(currentUser);
                })
                .catch((error: unknown) => {
                    if (!alive) return;
                    if (!(error instanceof GnosiApiError) || error.status !== 401) {
                        if (!(error instanceof DOMException)) {
                            logError('auth-current-user', error);
                        }
                    }
                    setUser(null);
                });
            await Promise.all([healthResult, authResult]);
            if (alive) setLoading(false);
        };
        void initialize();
        return () => {
            alive = false;
            healthRequest.cancel();
            authRequest.cancel();
        };
    }, []);

    const login = useCallback(async (
        email: string,
        password: string,
    ): Promise<AuthUser> => {
        const currentUser = await loginWithPassword({ email, password });
        setUser(currentUser);
        persistUser(currentUser);
        await refreshVaultRouting();
        return currentUser;
    }, []);

    const register = useCallback(async (
        email: string,
        password: string,
        name?: string,
    ): Promise<AuthUser> => {
        const currentUser = await registerWithPassword({
            email,
            password,
            name: name || undefined,
        });
        setUser(currentUser);
        persistUser(currentUser);
        await refreshVaultRouting();
        return currentUser;
    }, []);

    const changePassword = useCallback(async (
        currentPassword: string,
        newPassword: string,
    ): Promise<void> => {
        await changeCurrentPassword({
            current_password: currentPassword,
            new_password: newPassword,
        });
    }, []);

    const updateProfile = useCallback(async (
        fields: AuthProfileUpdateInput,
    ): Promise<AuthUser> => {
        const currentUser = await updateCurrentAuthUser(fields);
        setUser(currentUser);
        persistUser(currentUser);
        return currentUser;
    }, []);

    const logout = useCallback(async (): Promise<void> => {
        try {
            await logoutCurrentUser();
        } catch (error: unknown) {
            logError('auth-logout', error);
        }
        clearPersistedUser();
        setUser(null);
    }, []);

    const value: AuthContextValue = {
        user,
        gnosiMode,
        requireAuth,
        loading,
        login,
        register,
        logout,
        refresh,
        changePassword,
        updateProfile,
    };
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
