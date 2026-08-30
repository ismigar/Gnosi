import { stringValue } from './readers';
import { useCallback } from 'react';
import { openDailyNote } from '../../shared/api/daily-notes';
import { createVaultPage } from '../../shared/api/vaults';
import { fetchVaultPage } from '../../shared/api/vaults';
import { toast } from '../../lib/toast';
import { selectResourceTemplate } from '../../components/Vault/resourceTemplateSelection';
import type { Metadata } from './types';
import type { DashboardState } from './useDashboardState';
import type { useDataLoading } from './useDataLoading';
import type { usePageLoading } from './usePageLoading';
import type { useRecordCatalog } from './useRecordCatalog';
type Context = Pick<DashboardState, 'pages' | 't'> & Pick<ReturnType<typeof useDataLoading>, 'fetchPages'> & Pick<ReturnType<typeof usePageLoading>, 'loadPage'> & Pick<ReturnType<typeof useRecordCatalog>, 'applySchemaDefaults' | 'resolvePageTableId'>;
export function useSources(context: Context) {
    const { applySchemaDefaults, fetchPages, loadPage, pages, resolvePageTableId, t } = context;
    const handleCreateFromSource = useCallback(async (tableId: string | null, suggested: Metadata) => {
        if (!tableId)
            return;
        try {
            const sug = suggested;
            const title = stringValue(sug.Title || sug.title || t('common.new'));
            const tableTemplates = pages.filter((page) => (resolvePageTableId(page) === tableId && page.metadata?.is_template));
            const template = selectResourceTemplate(tableTemplates, sug);
            let initialContent = '';
            let initialMeta: Metadata = {
                ...sug,
                is_template: false,
                table_id: tableId,
                database_table_id: tableId,
                id: undefined,
            };
            if (template) {
                const templateData = await fetchVaultPage(template.id);
                initialContent = templateData.content || '';
                initialMeta = {
                    ...templateData.metadata,
                    ...initialMeta,
                    is_template: false,
                    table_id: tableId,
                    database_table_id: tableId,
                    id: undefined,
                };
            }
            initialMeta = applySchemaDefaults(tableId, initialMeta, title);
            const created = await createVaultPage({
                title,
                content: initialContent,
                is_database: false,
                metadata: initialMeta,
            });
            await fetchPages();
            toast.success(t('success.record_created'));
            void loadPage(created.id);
        }
        catch (err) {
            console.error("Error creating the record from a source:", err);
            toast.error(t('errors.record_create', { defaultValue: "Error creating the record" }));
        }
    }, [applySchemaDefaults, fetchPages, loadPage, pages, resolvePageTableId, t]);
    const handleOpenDailyNote = useCallback(async (dateStr?: string) => {
        try {
            let date = dateStr;
            if (!date) {
                const now = new Date();
                date = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            }
            const note = await openDailyNote({ date });
            await fetchPages();
            void loadPage(note.id);
        }
        catch (err) {
            console.error('Error opening the daily note:', err);
            toast.error(t('errors.daily_note', { defaultValue: "Error opening the daily note" }));
        }
    }, [fetchPages, loadPage, t]);
    return { handleCreateFromSource, handleOpenDailyNote };
}
