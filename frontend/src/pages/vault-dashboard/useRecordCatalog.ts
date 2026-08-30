import { text, stringValue } from './readers';
import { useCallback } from 'react';
import { buildSchemaFromTableProperties } from '../../components/Vault/schemaUtils';
import { isCalendarPage } from '../../components/Vault/schemaUtils';
import { applyDefaultFormulasToMetadata } from '../../components/Vault/defaultFormulaUtils';
import type { Page, Metadata } from './types';
import type { DashboardState } from './useDashboardState';
type Context = Pick<DashboardState, 'activeTableId' | 'pages' | 'pagesRef' | 'registry' | 'schema' | 'setGlobalIndex' | 'setPages' | 'setTableNotes' | 'setTableTemplates' | 't' | 'visibleTableRecordsById'>;
export function useRecordCatalog(context: Context) {
    const { activeTableId, pages, pagesRef, registry, setGlobalIndex, setPages, setTableNotes, setTableTemplates, t, visibleTableRecordsById } = context;
    const getSchemaFromTableId = useCallback((tableId: string | null) => {
        if (!tableId)
            return {};
        const table = registry.tables.find(t => t.id === tableId);
        if (!table || !table.properties)
            return {};
        return buildSchemaFromTableProperties(table.properties);
    }, [registry.tables]);
    const resolvePageTableId = useCallback(function resolvePageTableId(page: Partial<Page> | null | undefined, currentPages: readonly Page[] = pages): string | null {
        if (!page)
            return null;
        const directId = page.resolved_table_id || page.metadata?.table_id || page.metadata?.database_table_id;
        if (stringValue(directId || '').toLowerCase() === 'wiki')
            return null;
        if (directId)
            return text(directId) || null;
        // Recursive recursive search upwards for table context (for subfolders in BD/)
        if (page.parent_id && currentPages.length > 0) {
            const parent = currentPages.find(p => p.id === page.parent_id);
            if (parent && parent.id !== page.id)
                return resolvePageTableId(parent, currentPages);
        }
        return null;
    }, [pages]);
    const shouldIncludeTableRecord = useCallback((page: Page, tableId: string | null, currentPages: readonly Page[] = pages) => {
        if (resolvePageTableId(page, currentPages) !== tableId)
            return false;
        if (page.metadata?.is_template)
            return false;
        // Wiki (null tableId) should not include calendar entries
        if (!tableId && isCalendarPage(page))
            return false;
        // Resources also contains technical/imported annotations that are not primary records.
        if (tableId === 'resources') {
            const tipus = stringValue(page.metadata?.Tipus || '').trim().toLowerCase();
            const title = (page.title || '').trim().toLowerCase();
            const gnosiId = stringValue(page.metadata?.id || page.id || '').trim();
            if (tipus === 'annotation')
                return false;
            if (title === 'nou' || title === 'sense títol' || title === 'sense titol')
                return false;
            if (!gnosiId)
                return false;
        }
        return true;
    }, [resolvePageTableId, pages]);
    const getVisibleTableRecords = useCallback((records: readonly Page[], tableId: string | null, currentPages: readonly Page[] = pages) => {
        const filtered = records.filter(page => shouldIncludeTableRecord(page, tableId, currentPages));
        if (tableId !== 'resources')
            return filtered;
        // Some resources arrive duplicated with punctuation/accent variations in the title.
        const normalizeTitle = (value: string) => (value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
        const deduped = new Map<string, Page>();
        filtered.forEach((page) => {
            const key = normalizeTitle(page.title);
            if (!key) {
                deduped.set(`__${page.id}`, page);
                return;
            }
            const existing = deduped.get(key);
            if (!existing) {
                deduped.set(key, page);
                return;
            }
            const existingTs = new Date(existing.last_modified || 0).getTime();
            const nextTs = new Date(page.last_modified || 0).getTime();
            if (nextTs > existingTs) {
                deduped.set(key, page);
            }
        });
        return Array.from(deduped.values());
    }, [pages, shouldIncludeTableRecord]);
    const getTableVisibleRecords = useCallback((tableId: string | null) => {
        if (!tableId)
            return [];
        return visibleTableRecordsById[tableId] || getVisibleTableRecords(pages, tableId);
    }, [getVisibleTableRecords, pages, visibleTableRecordsById]);
    const syncPagesState = useCallback((nextPages: readonly Page[]) => {
        // Defensive deduplication to prevent React key collisions if backend serves duplicates
        const uniquePagesMap = new Map<string, Page>();
        nextPages.forEach(p => {
            if (!p.id)
                return;
            const existing = uniquePagesMap.get(p.id);
            if (!existing || (p.last_modified || '') > (existing.last_modified || '')) {
                uniquePagesMap.set(p.id, p);
            }
        });
        const dedupedPages = Array.from(uniquePagesMap.values());
        pagesRef.current = dedupedPages;
        setPages(dedupedPages);
        if (activeTableId) {
            const matchesActiveTable = (page: Page) => resolvePageTableId(page, dedupedPages) === activeTableId;
            const cachedVisible = visibleTableRecordsById[activeTableId];
            setTableNotes(cachedVisible || getVisibleTableRecords(dedupedPages, activeTableId, dedupedPages));
            setTableTemplates(dedupedPages.filter(page => matchesActiveTable(page) && page.metadata?.is_template));
        }
        setGlobalIndex(prev => ({
            ...prev,
            ...Object.fromEntries(dedupedPages.map(page => [page.id, page.title || t('common.untitled')]))
        }));
    }, [pagesRef, setPages, activeTableId, setGlobalIndex, visibleTableRecordsById, setTableNotes, getVisibleTableRecords, setTableTemplates, resolvePageTableId, t]);
    const updatePageMetadataLocal = useCallback((pageId: string, partialMetadata: Metadata) => {
        if (!pageId)
            return;
        setPages(prev => {
            const next = prev.map(p => {
                if (p.id !== pageId)
                    return p;
                return { ...p, metadata: { ...(p.metadata || {}), ...partialMetadata } };
            });
            pagesRef.current = next;
            return next;
        });
    }, [pagesRef, setPages]);
    const applySchemaDefaults = useCallback((tableId: string | null, metadata: Metadata = {}, title = 'Nou') => {
        if (!tableId)
            return metadata;
        const tableSchema = getSchemaFromTableId(tableId);
        return applyDefaultFormulasToMetadata({
            schema: tableSchema,
            metadata,
            title,
            notes: pages,
            currentTableId: tableId,
        });
    }, [getSchemaFromTableId, pages]);
    return { getSchemaFromTableId, resolvePageTableId, shouldIncludeTableRecord, getVisibleTableRecords, getTableVisibleRecords, syncPagesState, updatePageMetadataLocal, applySchemaDefaults };
}
