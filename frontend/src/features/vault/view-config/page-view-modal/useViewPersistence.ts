import { useRef } from 'react';
import { v4 as uuid } from 'uuid';
import { logError } from '../../../../shared/notifications/notifyError';
import { isProtectedMainView } from '../../views/viewConstants';
import { treeFromSource, collectLeafRules, sanitizeFilterTree, flatAndRules } from './filter-tree';
import { decodeView } from './decode';
import { writePinnedViews } from './pinned-views';
import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';
import { viewSelectionKey, type useViewSessionResult } from './useViewSession';
import type { useViewFieldsResult } from './useViewFields';
import type { useViewAppearanceResult } from './useViewAppearance';
import type { ViewConfig, SavedView } from './types';

export function useViewPersistence({
    sourceTableId, filterTree, sorts, isTableMode, editingView, editingBlock, createdViewsRef, sectionId,
    selectedExistingViewId, setSavedSelections, isMultiTable, joins, sourceTableName, viewName, viewType,
    visiblePropertiesToPersist, resultSnapshot, resultSnapshotLimit, buildViewExtras,
    api, existingViews, updatedViewsRef, registryViewsRef, inlineSourceRef, editScope, saveToTableViews, heading, headingLevel,
    pageId, modalPinnedViewIds, setError, t,
}: Pick<
    useViewStateResult & ModalInput & useViewSessionResult & useViewFieldsResult & useViewAppearanceResult,
    'sourceTableId' | 'filterTree' | 'sorts' | 'isTableMode' | 'editingView' | 'editingBlock' | 'createdViewsRef' | 'sectionId'
    | 'selectedExistingViewId' | 'setSavedSelections' | 'isMultiTable' | 'joins' | 'sourceTableName' | 'viewName' | 'viewType'
    | 'visiblePropertiesToPersist' | 'resultSnapshot' | 'resultSnapshotLimit' | 'buildViewExtras'
    | 'api' | 'existingViews' | 'updatedViewsRef' | 'registryViewsRef' | 'inlineSourceRef' | 'editScope' | 'saveToTableViews' | 'heading' | 'headingLevel'
    | 'pageId' | 'modalPinnedViewIds' | 'setError' | 't'
>) {
    const unconfirmedUpdates = useRef(new Set<string>());
    const persistView = async (): Promise<SavedView> => {
        setError('');
        const tree = sanitizeFilterTree(filterTree);
        const cleanSorts = sorts.filter(s => s.field).map(s => ({ field: s.field, direction: s.direction || 'asc' }));
        const settings = {
            filters: flatAndRules(tree) || [],
            filterTree: tree.rules.length ? tree : null,
            sort: cleanSorts[0] || null,
            sorts: cleanSorts,
            resultSnapshot,
            resultSnapshotLimit,
            ...buildViewExtras(),
        };
        const config = {
            ...settings,
            table_id: sourceTableId,
            type: viewType,
            visibleProperties: visiblePropertiesToPersist,
            joins: isMultiTable ? joins : [],
        };
        const creationKey = isTableMode ? 'table' : viewSelectionKey(sourceTableId, selectedExistingViewId);
        const createdId = createdViewsRef.current.get(creationKey);
        // Remember the registry write even when the subsequent page write fails.
        // A retry updates that id instead of creating another view.
        const saveRegistryView = async (body: ViewConfig, id?: string | null) => {
            if (id) {
                // The server may commit a PUT even if the response is lost.
                unconfirmedUpdates.current.add(id);
                await api.updateVaultView(id, { ...body, id });
                unconfirmedUpdates.current.delete(id);
                return id;
            }
            // POST accepts a client id and PUT can upsert it. A lost response
            // can therefore be retried without inserting a second catalog view.
            const requestedId = uuid();
            createdViewsRef.current.set(creationKey, requestedId);
            const created = await api.createVaultView({ ...body, id: requestedId });
            const savedId = created.id || requestedId;
            createdViewsRef.current.set(creationKey, savedId);
            return savedId;
        };
        if (isTableMode) {
            const id = editingView?.id || createdId;
            const main = editingView?.is_main || editingView?.is_default || id === 'default';
            const body = { ...editingView, ...config, name: main ? sourceTableName : (viewName || editingView?.name || 'Vista').trim(),
                ...(main ? { is_main: true } : {}) };
            return { ...body, id: await saveRegistryView(body, id) };
        }

        const source = updatedViewsRef.current.get(selectedExistingViewId) || existingViews.find(v => v.id === selectedExistingViewId);
        const name = (viewName || source?.name || heading || 'Vista').trim();
        const hasPageFilter = collectLeafRules(tree).some(rule => rule.value === 'this');
        // Inline sections and new registry entries need the full view, including
        // settings owned by other controls (column widths, subitems, plugins).
        const localSource = selectedExistingViewId ? source : inlineSourceRef.current;
        const localOptions = localSource?.table_id === sourceTableId ? localSource : {};
        const { id, view_id, section_id, table_id, source_table_id, type, view_type, name: sourceName,
            heading: sourceHeading, heading_level, previous_section, visibleProperties, visible_properties,
            columns, joins: sourceJoins, filter, is_main, is_default, locked, is_locked, isLocked,
            embedded, hidden, order, ...extras } = localOptions;
        const savedAliases = new Set(Object.keys(settings).map(key => key.replace(/[A-Z]/g, c => '_' + c.toLowerCase())));
        const preserved = Object.fromEntries(Object.entries(extras).filter(([key]) => !savedAliases.has(key)));
        let viewId: string | null = null;
        if (selectedExistingViewId) {
            if (!source) throw new Error(t('view.load_settings_error', "Couldn't load this view's settings. Try again."));
            const virtual = selectedExistingViewId === 'default';
            viewId = createdId || (virtual ? null : selectedExistingViewId);
            // Heading and pinned tabs belong to the block. They need no registry
            // write or private copy unless the view configuration also changed.
            const comparable = (view: ViewConfig) => JSON.stringify({
                name: view.name || '',
                type: view.type || 'table',
                filterTree: sanitizeFilterTree(treeFromSource(view)),
                sorts: view.sorts || (view.sort ? [view.sort] : []),
                visibleProperties: view.visibleProperties || ['title'],
                joins: view.joins || [],
                resultSnapshot: view.resultSnapshot !== false,
                resultSnapshotLimit: Number.isFinite(Number(view.resultSnapshotLimit)) ? Number(view.resultSnapshotLimit) : 500,
                ...buildViewExtras(view),
            });
            const changed = comparable({ ...config, name }) !== comparable(source);
            if (editScope === 'fork') {
                viewId = null;
            } else if (changed || createdId || virtual || unconfirmedUpdates.current.has(selectedExistingViewId)) {
                // A section can supply all displayed options without carrying the
                // registry's protection flags. Resolve identity before mutating it.
                let registered = registryViewsRef.current.get(selectedExistingViewId);
                if (!registered && !isProtectedMainView(source)) {
                    registered = decodeView(await api.fetchVaultView(selectedExistingViewId));
                    if (registered.id !== selectedExistingViewId || !registered.table_id)
                        throw new Error(t('view.load_settings_error', "Couldn't load this view's settings. Try again."));
                    registryViewsRef.current.set(selectedExistingViewId, registered);
                }
                if (isProtectedMainView(source) || isProtectedMainView(registered)) {
                    const { id, is_main, is_default, locked, is_locked, isLocked, ...copy } = registered || source;
                    const copyName = name === source.name || isProtectedMainView({ name })
                        ? t('view.page_copy_name', { name, defaultValue: '{{name}} (page view)' }) : name;
                    const pageView = { ...copy, ...config, embedded: true, hidden: true, is_main: false, name: copyName };
                    viewId = await saveRegistryView(pageView, createdId);
                } else {
                    const embedded = registered?.embedded ?? source.embedded;
                    const body = { ...config, name, is_main: false, embedded: typeof embedded === 'boolean' ? embedded : hasPageFilter };
                    viewId = await saveRegistryView(body, viewId);
                    updatedViewsRef.current.set(viewId, { ...source, ...body });
                }
            }
        } else if (saveToTableViews || createdId) {
            const pageOnly = !saveToTableViews || hasPageFilter;
            viewId = await saveRegistryView({ ...preserved, ...config, name, embedded: pageOnly, hidden: pageOnly, is_main: false }, createdId);
        }

        const section = {
            ...(!selectedExistingViewId || !viewId ? preserved : {}),
            section_id: sectionId,
            ...settings,
            name,
            heading: heading.trim(),
            heading_level: headingLevel,
            source_table_id: sourceTableId,
            view_id: viewId,
            view_type: viewType,
            visible_properties: visiblePropertiesToPersist,
            ...(isMultiTable ? { joins } : {}),
        };
        await api.upsertPageView(pageId, {
            ...section, type: 'db_view',
            ...(editingBlock && !editingBlock.props?.section_id ? { previous_section: {
                view_id: editingBlock.anchorViewId ?? editingBlock.props?.view_id ?? '',
                heading: editingBlock.props?.heading || '',
            } } : {}),
            columns: visiblePropertiesToPersist.map(column => typeof column === 'string' ? column : column.fieldKey),
        });
        const selection = { view: { ...localOptions, ...config, name }, editScope, saveToTableViews, pins: new Set(modalPinnedViewIds) };
        setSavedSelections(previous => new Map(previous).set(creationKey, selection));
        if (viewId) {
            try {
                const pins = [...modalPinnedViewIds].map(id => id === selectedExistingViewId ? viewId : id);
                writePinnedViews(pageId, viewId, new Set(pins));
            } catch (error) {
                logError('PageViewModal.pinnedViews', error);
            }
        }
        return section;
    };
    return { persistView };
}
export type useViewPersistenceResult = ReturnType<typeof useViewPersistence>;
