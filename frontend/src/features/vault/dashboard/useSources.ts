import { stringValue } from './readers';
import { useCallback } from 'react';
import { openDailyNote } from '../../../shared/api/daily-notes';
import { createVaultPage } from '../../../shared/api/vaults';
import { fetchVaultPage, fetchVaultPagesByTable } from '../../../shared/api/vaults';
import { uploadVaultInsertFile } from '../../../shared/api/vault-content';
import { uploadVaultCover } from '../../../shared/api/vault-icons';
import { interpolateNamePattern } from '../../../shared/resources/fileResource';
import { getFieldConfig } from '../../../shared/records/model/schemaUtils';
import { toast } from '../../../shared/notifications/toast';
import { selectResourceTemplate } from '../../literature/records/resourceTemplateSelection';
import type { Metadata } from './types';
import type { DashboardState } from './useDashboardState';
import type { useDataLoading } from './useDataLoading';
import type { usePageLoading } from './usePageLoading';
import type { useRecordCatalog } from './useRecordCatalog';
type Context = Pick<DashboardState, 't'> & Pick<ReturnType<typeof useDataLoading>, 'fetchPages'> & Pick<ReturnType<typeof usePageLoading>, 'loadPage'> & Pick<ReturnType<typeof useRecordCatalog>, 'applySchemaDefaults' | 'getSchemaFromTableId'>;
export function useSources(context: Context) {
    const { applySchemaDefaults, fetchPages, getSchemaFromTableId, loadPage, t } = context;
    const handleCreateFromSource = useCallback(async (tableId: string | null, suggested: Metadata, sourceFile?: File) => {
        if (!tableId)
            return;
        try {
            const sug = suggested;
            const title = stringValue(sug.Title || sug.title || t('common.new'));
            // Embedded views and direct navigation may not have loaded this
            // table into the dashboard's page cache yet.
            const tablePages = await fetchVaultPagesByTable(tableId, { include_templates: true });
            const tableTemplates = tablePages.filter(page => page.metadata.is_template);
            const template = selectResourceTemplate(tableTemplates, sug);
            let initialContent = '';
            let initialMeta: Metadata = {
                ...sug,
                is_template: false,
                is_default_template: false,
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
                if (templateData.metadata.cover) initialMeta.cover = templateData.metadata.cover;
            }
            initialMeta = applySchemaDefaults(tableId, initialMeta, title);
            if (sourceFile) {
                const schema = getSchemaFromTableId(tableId);
                const fileFieldName = Object.entries(schema).find(([, type]) => type === 'files')?.[0];
                if (!fileFieldName) throw new Error('The target table has no file field configured');
                const fileConfig = getFieldConfig(schema, fileFieldName);
                const storageFolder = typeof fileConfig.storage_folder === 'string'
                    ? fileConfig.storage_folder
                    : 'assets';
                const targetName = typeof fileConfig.name_pattern === 'string'
                    ? interpolateNamePattern(fileConfig.name_pattern, initialMeta)
                    : '';
                const uploaded = await uploadVaultInsertFile(sourceFile, {
                    propertyName: fileFieldName,
                    storageFolder,
                    tableId,
                    targetName,
                });
                initialMeta[fileFieldName] = uploaded.url || uploaded.path;
                if (!initialMeta.cover) {
                    try {
                        const { createPdfCover } = await import('../../../shared/resources/pdfCover');
                        const cover = await uploadVaultCover(await createPdfCover(sourceFile));
                        initialMeta.cover = cover.path;
                    } catch (error) {
                        console.warn('Could not create the PDF cover:', error);
                    }
                }
            }
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
    }, [applySchemaDefaults, fetchPages, getSchemaFromTableId, loadPage, t]);
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
