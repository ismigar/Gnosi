import { useCallback } from 'react';
import { transportFetch } from '../shared/api/transports';

export function useApi() {
    const getWorkspaceId = useCallback(() => {
        return localStorage.getItem('gnosi_workspace_id') || 'personal';
    }, []);

    const getUserEmail = useCallback(() => {
        return localStorage.getItem('gnosi_user_email') || '';
    }, []);

    const apiFetch = useCallback(async (url, options = {}) => {
        const workspaceId = getWorkspaceId();
        // User resolved at login (AuthContext stores it in localStorage). Fallback
        // to 'ismael-legacy' for personal mode without authentication, where the
        // backend already resolves the single user. If there's a JWT cookie, the backend
        // prioritizes it over this header (get_user_id_or_legacy).
        const userId = localStorage.getItem('gnosi_user_id') || 'ismael-legacy';
        const userEmail = getUserEmail();

        const headers = {
            ...options.headers,
            'X-Workspace-ID': workspaceId,
            'X-User-ID': userId,
            'X-User-Email': userEmail,
            'Content-Type': options.body instanceof FormData ? undefined : 'application/json',
        };

        // Remove Content-Type if it's FormData (the browser sets it automatically with the boundary)
        if (options.body instanceof FormData) {
            delete headers['Content-Type'];
        }

        const response = await transportFetch(url, {
            // Sends the `gnosi_session` session cookie. Same-origin would already do this
            // by default (Vite proxy in dev, reverse-proxy in prod); explicit
            // for robustness and to support cross-origin dev with CORS_ORIGINS.
            credentials: 'include',
            ...options,
            headers,
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
            throw new Error(error.detail || response.statusText);
        }

        return response.json();
    }, [getWorkspaceId, getUserEmail]);

    const apiGet = useCallback(async (url, options = {}) => {
        return apiFetch(url, { ...options, method: 'GET' });
    }, [apiFetch]);

    const apiPost = useCallback(async (url, body = {}, method = 'POST') => {
        return apiFetch(url, {
            ...(method === 'DELETE' ? {} : { body: JSON.stringify(body) }),
            method,
        });
    }, [apiFetch]);

    return { 
        apiFetch, 
        apiGet, 
        apiPost,
        workspaceId: getWorkspaceId(),
        // In personal mode (no login → gnosi_user_id null) the user is
        // the sole owner → admin. If there's a login but gnosi_role hasn't been
        // saved yet (timing edge case), we default to 'viewer' for safety.
        role: localStorage.getItem('gnosi_role') || (localStorage.getItem('gnosi_user_id') ? 'viewer' : 'admin'),
        userEmail: getUserEmail(),
    };
}
