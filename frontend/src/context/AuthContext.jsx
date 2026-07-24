/**
 * AuthContext — global authentication state (JWT via HttpOnly cookie).
 *
 * The backend issues a `gnosi_session` cookie on login/register and reads it
 * in `get_current_user_id`. Since the frontend and `/api` are the same origin
 * (Vite proxy in dev, reverse-proxy/static in prod), the cookie travels on its own;
 * `credentials: 'include'` is only needed to be explicit and to support dev
 * cross-origin.
 *
 * Personal mode vs org:
 *   - personal: the backend resolves the legacy user without a token. The app is NOT
 *     gated behind login (the single user goes straight in). `me` returns
 *     401 and `user` stays null, but App renders anyway because the gate
 *     only applies in org mode.
 *   - org: each member authenticates. Without `user`, App shows <LoginPage>.
 *   - `requireAuth` (GNOSI_REQUIRE_AUTH on the backend, surfaced by /api/health):
 *     the legacy fallback is off, so even personal mode needs a session and
 *     App gates behind <LoginPage> too.
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

async function authFetch(url, options = {}) {
    const res = await fetch(url, {
        credentials: 'include',
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    let data = null;
    try {
        data = await res.json();
    } catch {
        // response without a body (e.g. logout) — ok
    }
    if (!res.ok) {
        const detail = (data && data.detail) || res.statusText || 'Error';
        const err = new Error(detail);
        err.status = res.status;
        throw err;
    }
    return data;
}

/**
 * Keeps `gnosi_user_id`, `gnosi_user_email`, `gnosi_workspace_id`, and
 * `gnosi_role` in localStorage in sync with the authenticated user, so that
 * `use-api.js` (which reads from localStorage) sends the correct headers.
 */
function persistUser(user) {
    if (!user) return;
    localStorage.setItem('gnosi_user_id', user.id);
    if (user.email) localStorage.setItem('gnosi_user_email', user.email);

    const workspaces = Array.isArray(user.workspaces) ? user.workspaces : [];
    if (workspaces.length > 0) {
        const current = localStorage.getItem('gnosi_workspace_id');
        const match = workspaces.find((w) => w.id === current);
        const chosen = match || workspaces[0];
        localStorage.setItem('gnosi_workspace_id', chosen.id);
        if (chosen.role) localStorage.setItem('gnosi_role', chosen.role);
    }
}

function clearPersistedUser() {
    localStorage.removeItem('gnosi_user_id');
    localStorage.removeItem('gnosi_user_email');
    // We don't clear gnosi_workspace_id: in personal mode it's 'personal' and it must
    // survive; in org, the next login overwrites it.
}

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [gnosiMode, setGnosiMode] = useState(null); // null = still unknown
    const [requireAuth, setRequireAuth] = useState(false);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        try {
            const me = await authFetch('/api/auth/me');
            setUser(me);
            persistUser(me);
            return me;
        } catch (err) {
            if (err.status !== 401) console.warn('auth/me failed:', err);
            setUser(null);
            return null;
        }
    }, []);

    useEffect(() => {
        let alive = true;
        (async () => {
            await Promise.all([
                fetch('/api/health')
                    .then((r) => (r.ok ? r.json() : null))
                    .then((d) => {
                        if (!alive) return;
                        setGnosiMode(d?.gnosi_mode || 'personal');
                        setRequireAuth(d?.require_auth === true);
                    })
                    .catch(() => {
                        if (alive) setGnosiMode('personal');
                    }),
                refresh(),
            ]);
            if (alive) setLoading(false);
        })();
        return () => {
            alive = false;
        };
    }, [refresh]);

    const login = useCallback(async (email, password) => {
        const me = await authFetch('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password }),
        });
        setUser(me);
        persistUser(me);
        return me;
    }, []);

    const register = useCallback(async (email, password, name) => {
        const me = await authFetch('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify({ email, password, name: name || undefined }),
        });
        setUser(me);
        persistUser(me);
        return me;
    }, []);

    const changePassword = useCallback(async (currentPassword, newPassword) => {
        return authFetch('/api/auth/change-password', {
            method: 'POST',
            body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
        });
    }, []);

    // fields: { name?, email?, current_password? } — the backend requires
    // current_password when email changes (see auth_routes.update_me).
    const updateProfile = useCallback(async (fields) => {
        const me = await authFetch('/api/auth/me', {
            method: 'PATCH',
            body: JSON.stringify(fields),
        });
        setUser(me);
        persistUser(me);
        return me;
    }, []);

    const logout = useCallback(async () => {
        try {
            await authFetch('/api/auth/logout', { method: 'POST' });
        } catch (err) {
            console.warn('logout failed (clearing local state anyway):', err);
        }
        clearPersistedUser();
        setUser(null);
    }, []);

    const value = {
        user, gnosiMode, requireAuth, loading,
        login, register, logout, refresh, changePassword, updateProfile,
    };
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- hook co-located with the provider; they share the same private context
export function useAuth() {
    const ctx = useContext(AuthContext);
    if (ctx === null) {
        throw new Error('useAuth must be used inside an <AuthProvider>');
    }
    return ctx;
}
