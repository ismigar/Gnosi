import { useCallback } from 'react';

export function useApi() {
    const getWorkspaceId = useCallback(() => {
        return localStorage.getItem('gnosi_workspace_id') || 'personal';
    }, []);

    const getUserEmail = useCallback(() => {
        return localStorage.getItem('gnosi_user_email') || '';
    }, []);

    const apiFetch = useCallback(async (url, options = {}) => {
        const workspaceId = getWorkspaceId();
        // Usuari resolt al login (AuthContext el desa a localStorage). Fallback
        // a 'ismael-legacy' per al mode personal sense autenticació, on el
        // backend ja resol l'usuari únic. Si hi ha cookie JWT, el backend la
        // prioritza per sobre d'aquest header (get_user_id_or_legacy).
        const userId = localStorage.getItem('gnosi_user_id') || 'ismael-legacy';
        const userEmail = getUserEmail();

        const headers = {
            ...options.headers,
            'X-Workspace-ID': workspaceId,
            'X-User-ID': userId,
            'X-User-Email': userEmail,
            'Content-Type': options.body instanceof FormData ? undefined : 'application/json',
        };

        // Eliminar Content-Type si és FormData (el navegador ho posa automàticament amb el boundary)
        if (options.body instanceof FormData) {
            delete headers['Content-Type'];
        }

        const response = await fetch(url, {
            // Envia la cookie de sessió `gnosi_session`. Same-origin ja ho faria
            // per defecte (Vite proxy en dev, reverse-proxy en prod); explícit
            // per robustesa i per suportar dev cross-origin amb CORS_ORIGINS.
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
        // En mode personal (sense login → gnosi_user_id null) l'usuari és
        // l'únic propietari → admin. Si hi ha login però gnosi_role no s'ha
        // guardat encara (edge-case de timing), anem a 'viewer' per seguretat.
        role: localStorage.getItem('gnosi_role') || (localStorage.getItem('gnosi_user_id') ? 'viewer' : 'admin'),
        userEmail: getUserEmail(),
    };
}
