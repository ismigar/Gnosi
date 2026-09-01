import { useState, useEffect, useCallback } from 'react';
import {
    createMailView,
    deleteMailView,
    fetchMailViews,
    updateMailView,
} from '../shared/api/mail';
import { GnosiApiError } from '../shared/api/errors';

function legacyHttpError(error, message) {
    return error instanceof GnosiApiError ? new Error(message, { cause: error }) : error;
}

function rethrowLegacyHttpError(error, message) {
    throw legacyHttpError(error, message);
}

export function useMailViews() {
    const [views, setViews] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const fetchViews = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setViews(await fetchMailViews());
        } catch (e) {
            setError(legacyHttpError(e, 'Error loading views').message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchViews(); }, [fetchViews]);

    const createView = useCallback(async (data) => {
        let created;
        try {
            created = await createMailView(data);
        } catch (error) {
            rethrowLegacyHttpError(error, 'Error creant vista');
        }
        setViews(prev => [...prev, created]);
        return created;
    }, []);

    const updateView = useCallback(async (id, data) => {
        let updated;
        try {
            updated = await updateMailView(id, data);
        } catch (error) {
            rethrowLegacyHttpError(error, 'Error actualitzant vista');
        }
        setViews(prev => prev.map(v => v.id === id ? updated : v));
        return updated;
    }, []);

    const deleteView = useCallback(async (id) => {
        try {
            await deleteMailView(id);
        } catch (error) {
            rethrowLegacyHttpError(error, 'Error eliminant vista');
        }
        setViews(prev => prev.filter(v => v.id !== id));
    }, []);

    return { views, loading, error, fetchViews, createView, updateView, deleteView };
}
