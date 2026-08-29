import {
    useCallback,
    useEffect,
    useState,
    type PropsWithChildren,
} from 'react';

import { initializeVaultRouting } from '../lib/vaultRouting';
import { logError } from '../lib/notifyError';
import {
    changeCurrentPassword,
    fetchCurrentAuthUser,
    loginWithPassword,
    logoutCurrentUser,
    registerWithPassword,
    updateCurrentAuthUser,
    type AuthProfileUpdateInput,
    type AuthUser,
} from '../shared/api/auth';
import { GnosiApiError } from '../shared/api/errors';
import {
    USER_EMAIL_STORAGE_KEY,
    USER_ID_STORAGE_KEY,
    USER_ROLE_STORAGE_KEY,
    WORKSPACE_ID_STORAGE_KEY,
} from '../shared/api/request-context';
import { fetchSystemHealth } from '../shared/api/system';
import { emitAppEvent } from '../shared/platform/app-events';
import {
    readStorage,
    removeStorage,
    writeStorage,
} from '../shared/platform/browser-storage';
import { AuthContext, type AuthContextValue } from './auth-context';

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
        const initialize = async (): Promise<void> => {
            const healthRequest = fetchSystemHealth()
                .then((health) => {
                    if (!alive) return;
                    setGnosiMode(health.gnosi_mode || 'personal');
                    setRequireAuth(health.require_auth);
                })
                .catch(() => {
                    if (alive) setGnosiMode('personal');
                });
            await Promise.all([healthRequest, refresh()]);
            if (alive) setLoading(false);
        };
        void initialize();
        return () => {
            alive = false;
        };
    }, [refresh]);

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
