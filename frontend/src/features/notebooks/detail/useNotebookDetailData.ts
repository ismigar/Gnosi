import { useCallback, useEffect, useEffectEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { fetchNotebook, fetchNotebookSources, type NotebookDetail, type NotebookSourcesPage } from '../../../shared/api/notebooks';
import { GnosiApiError } from '../../../shared/api/errors';
import { toast } from '../../../lib/toast';
import { vaultPath } from '../../../lib/vaultRouting';
import { isIndexing } from './notebookModel';
import type { LoadOptions } from './notebookTypes';

export function useNotebookDetailData(notebookId: string) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [notebook, setNotebook] = useState<NotebookDetail | null>(null);
    const [sources, setSources] = useState<NotebookSourcesPage>({ items: [], total: 0, page: 1, page_size: 50, active_revision: null });
    const [loading, setLoading] = useState(true);

    const load = useCallback(async ({ refresh = false, page = sources.page }: LoadOptions = {}) => {
        try {
            const [notebookData, initialSourceData] = await Promise.all([
                fetchNotebook(notebookId, refresh),
                fetchNotebookSources(notebookId, { page, pageSize: 50 }),
            ]);
            let sourceData = initialSourceData;
            if (notebookData.active_revision !== null && notebookData.active_revision !== sourceData.active_revision) {
                sourceData = await fetchNotebookSources(notebookId, { page, pageSize: 50 });
            }
            setNotebook(notebookData);
            setSources(sourceData);
        } catch (error) {
            if (error instanceof GnosiApiError && error.status === 404) {
                void navigate(vaultPath('notebooks'), { replace: true });
                return;
            }
            toast.error(t('notebooks.detail_error', 'The notebook could not be loaded.'));
        } finally {
            setLoading(false);
        }
    }, [navigate, notebookId, sources.page, t]);

    const loadInitial = useEffectEvent(() => { void load({ refresh: true }); });
    useEffect(() => {
        let active = true;
        queueMicrotask(() => { if (active) loadInitial(); });
        return () => { active = false; };
    }, [notebookId]);
    useEffect(() => {
        if (!notebook || !isIndexing(notebook)) return undefined;
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'visible') void load({ refresh: false });
        }, 1500);
        return () => { window.clearInterval(timer); };
    }, [load, notebook]);

    return { notebook, setNotebook, sources, loading, load };
}
