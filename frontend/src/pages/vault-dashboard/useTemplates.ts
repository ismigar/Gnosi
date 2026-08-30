import { readPage } from './readers';
import { useCallback } from 'react';
import { createVaultPage } from '../../shared/api/vaults';
import { fetchVaultPage } from '../../shared/api/vaults';
import { patchVaultPage } from '../../shared/api/vaults';
import { toast } from '../../lib/toast';
import type { Page, Metadata } from './types';
import type { DashboardState } from './useDashboardState';
import type { useDataLoading } from './useDataLoading';
import type { usePageLoading } from './usePageLoading';
import type { useRecordCatalog } from './useRecordCatalog';
type Context = Pick<DashboardState, 'isCreatingNoteRef' | 'pages' | 'setGlobalIndex' | 'setPages' | 't' | 'tableTemplates'> & Pick<ReturnType<typeof useDataLoading>, 'fetchPages' | 'fetchPagesByTable'> & Pick<ReturnType<typeof usePageLoading>, 'loadPage'> & Pick<ReturnType<typeof useRecordCatalog>, 'applySchemaDefaults' | 'resolvePageTableId'>;
export function useTemplates(context: Context) {
    const { applySchemaDefaults, fetchPages, fetchPagesByTable, isCreatingNoteRef, loadPage, pages, resolvePageTableId, setGlobalIndex, setPages, t, tableTemplates } = context;
    const handleAddNewNote = useCallback(async (tableId: string | null, templateId: string | null = null) => {
        if (isCreatingNoteRef.current)
            return;
        isCreatingNoteRef.current = true;
        try {
            const normalizedTemplateId = typeof templateId === 'string' ? templateId : null;
            let initialContent = "";
            let initialMeta: Metadata = { table_id: tableId, database_table_id: tableId };
            let title = "Nou";
            if (normalizedTemplateId) {
                const templateData = readPage(await fetchVaultPage(normalizedTemplateId));
                initialContent = templateData.content || "";
                title = templateData.title || "Nou";
                initialMeta = {
                    ...templateData.metadata,
                    is_template: false,
                    table_id: tableId,
                    database_table_id: tableId,
                    id: undefined
                };
            }
            else {
                // Use default template if available and no specific templateId is provided
                const defaultTemplate = tableTemplates.find(t => t.metadata?.is_default_template);
                if (defaultTemplate) {
                    const templateData = readPage(await fetchVaultPage(defaultTemplate.id));
                    initialContent = templateData.content || "";
                    title = templateData.title || t('common.new');
                    initialMeta = {
                        ...templateData.metadata,
                        is_template: false,
                        table_id: tableId,
                        database_table_id: tableId,
                        id: undefined
                    };
                }
            }
            initialMeta = applySchemaDefaults(tableId, initialMeta, title);
            const created = await createVaultPage({
                title: title,
                content: initialContent,
                is_database: false,
                metadata: initialMeta
            });
            const newId = created.id;
            if (newId) {
                const newPageObj = {
                    id: newId,
                    title: title,
                    content: initialContent,
                    metadata: initialMeta,
                    last_modified: new Date().toISOString()
                };
                setPages(prev => [newPageObj, ...prev.filter(p => p.id !== newId)]);
                setGlobalIndex(prev => ({ ...prev, [newId]: title }));
                void loadPage(newId);
            }
            await fetchPages();
            toast.success(t('success.record_created'));
        }
        catch (err) {
            console.error("Error creating the record:", err);
            toast.error(t('errors.record_create'));
        }
        finally {
            isCreatingNoteRef.current = false;
        }
    }, [isCreatingNoteRef, applySchemaDefaults, fetchPages, t, tableTemplates, setPages, setGlobalIndex, loadPage]);
    const handleDuplicateTemplate = async (template: Page) => {
        try {
            await createVaultPage({
                title: `${template.title} (${t('common.copy')})`,
                content: template.content || "",
                is_database: false,
                metadata: {
                    ...template.metadata,
                    id: undefined
                }
            });
            toast.success(t('success.template_duplicated'));
            const tableIdOfPage = resolvePageTableId(template);
            if (tableIdOfPage) {
                await fetchPagesByTable(tableIdOfPage);
            }
        }
        catch {
            toast.error(t('errors.template_duplicate'));
        }
    };
    const handleSetDefaultTemplate = async (template: Page) => {
        try {
            const targetTableId = resolvePageTableId(template);
            const otherTemplates = pages.filter(p => resolvePageTableId(p) === targetTableId && p.metadata?.is_template && p.id !== template.id && p.metadata.is_default_template);
            for (const t of otherTemplates) {
                await patchVaultPage(t.id, {
                    ...t,
                    metadata: { ...t.metadata, is_default_template: false }
                });
            }
            await patchVaultPage(template.id, {
                ...template,
                metadata: { ...template.metadata, is_default_template: true }
            });
            toast.success(t('success.template_default_set'));
            if (targetTableId) {
                await fetchPagesByTable(targetTableId);
            }
        }
        catch {
            toast.error(t('errors.template_default'));
        }
    };
    const handleCreateRecordForTable = async (targetTableId: string, templateId: string | null = null) => {
        try {
            let normalizedTemplateId = typeof templateId === 'string' ? templateId : null;
            if (!normalizedTemplateId) {
                const tableTemplates = pages.filter(p => resolvePageTableId(p) === targetTableId && p.metadata?.is_template);
                const defaultTemplate = tableTemplates.find(t => t.metadata?.is_default_template);
                if (defaultTemplate) {
                    normalizedTemplateId = defaultTemplate.id;
                }
            }
            let initialContent = "";
            let initialMeta: Metadata = { table_id: targetTableId, database_table_id: targetTableId };
            let title = "Nou";
            if (normalizedTemplateId) {
                const templateData = readPage(await fetchVaultPage(normalizedTemplateId));
                initialContent = templateData.content || "";
                title = templateData.title || "Nou";
                initialMeta = {
                    ...templateData.metadata,
                    is_template: false,
                    is_default_template: false,
                    table_id: targetTableId,
                    database_table_id: targetTableId,
                    id: undefined
                };
            }
            initialMeta = applySchemaDefaults(targetTableId, initialMeta, title);
            const created = await createVaultPage({
                title: title,
                content: initialContent,
                is_database: false,
                metadata: initialMeta
            });
            await fetchPagesByTable(targetTableId);
            void loadPage(created.id);
        }
        catch {
            toast.error(t('errors.record_create'));
        }
    };
    return { handleAddNewNote, handleDuplicateTemplate, handleSetDefaultTemplate, handleCreateRecordForTable };
}
