import { useState, useEffect, useCallback } from 'react';

const API = '/api/mail/views';

export function useMailViews() {
    const [views, setViews] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const fetchViews = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(API);
            if (!res.ok) throw new Error('Error carregant vistes');
            setViews(await res.json());
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchViews(); }, [fetchViews]);

    const createView = useCallback(async (data) => {
        const res = await fetch(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('Error creant vista');
        const created = await res.json();
        setViews(prev => [...prev, created]);
        return created;
    }, []);

    const updateView = useCallback(async (id, data) => {
        const res = await fetch(`${API}/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('Error actualitzant vista');
        const updated = await res.json();
        setViews(prev => prev.map(v => v.id === id ? updated : v));
        return updated;
    }, []);

    const deleteView = useCallback(async (id) => {
        const res = await fetch(`${API}/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Error eliminant vista');
        setViews(prev => prev.filter(v => v.id !== id));
    }, []);

    return { views, loading, error, fetchViews, createView, updateView, deleteView };
}
