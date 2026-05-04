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
        const userId = 'ismael-legacy';
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
        role: localStorage.getItem('gnosi_role') || 'viewer',
        userEmail: getUserEmail(),
    };
}
