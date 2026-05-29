/**
 * AuthContext — estat global d'autenticació (JWT via cookie HttpOnly).
 *
 * El backend emet una cookie `gnosi_session` al login/register i la llegeix
 * a `get_current_user_id`. Com que el frontend i `/api` són el mateix origin
 * (Vite proxy en dev, reverse-proxy/static en prod), la cookie viatja sola;
 * només cal `credentials: 'include'` per ser explícits i suportar dev
 * cross-origin.
 *
 * Mode personal vs org:
 *   - personal: el backend resol l'usuari legacy sense token. L'app NO es
 *     bloqueja darrere del login (l'usuari únic entra directe). `me` retorna
 *     401 i `user` queda null, però App rendaritza igualment perquè el gate
 *     només aplica en mode org.
 *   - org: cada membre s'autentica. Sense `user`, App mostra <LoginPage>.
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
        // resposta sense cos (ex. logout) — ok
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
 * Manté `gnosi_user_id`, `gnosi_user_email`, `gnosi_workspace_id` i
 * `gnosi_role` a localStorage sincronitzats amb l'usuari autenticat, perquè
 * `use-api.js` (que llegeix de localStorage) enviï els headers correctes.
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
    // No esborrem gnosi_workspace_id: en mode personal és 'personal' i ha de
    // sobreviure; en org el proper login el reescriu.
}

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [gnosiMode, setGnosiMode] = useState(null); // null = encara desconegut
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        try {
            const me = await authFetch('/api/auth/me');
            setUser(me);
            persistUser(me);
            return me;
        } catch (err) {
            if (err.status !== 401) console.warn('auth/me ha fallat:', err);
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
                        if (alive) setGnosiMode(d?.gnosi_mode || 'personal');
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

    const logout = useCallback(async () => {
        try {
            await authFetch('/api/auth/logout', { method: 'POST' });
        } catch (err) {
            console.warn('logout ha fallat (esborrem estat local igualment):', err);
        }
        clearPersistedUser();
        setUser(null);
    }, []);

    const value = { user, gnosiMode, loading, login, register, logout, refresh };
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- hook co-locat amb el provider; comparteixen el mateix context privat
export function useAuth() {
    const ctx = useContext(AuthContext);
    if (ctx === null) {
        throw new Error('useAuth ha de fer-se servir dins un <AuthProvider>');
    }
    return ctx;
}
