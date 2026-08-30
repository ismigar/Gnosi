import { logError } from '../../../lib/notifyError';
import { inputValue } from './input-value';
import { isRecord } from './decode';
import { treeFromSource, collectLeafRules, sanitizeFilterTree, flatAndRules } from './filter-tree';
import { writePinnedViews } from './pinned-views';
import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';
import type { useViewSessionResult } from './useViewSession';
import type { useViewFieldsResult } from './useViewFields';
import type { useViewAppearanceResult } from './useViewAppearance';
import type { ViewConfig, PersistView } from './types';

export function useViewPersistence({
    sourceTableId, setError, t, setActiveTab,
    visibleProperties, filterTree, sorts, isTableMode,
    editingView, createdViewIdRef, selectedExistingViewId, isMultiTable,
    joins, sourceTableName, viewName, viewType,
    visiblePropertiesToPersist, resultSnapshot, resultSnapshotLimit, buildViewExtras,
    api, lastSavedViewRef, existingViews, editScope,
    saveToTableViews, heading, headingLevel, pageId,
    modalPinnedViewIds
}: Pick<
    useViewStateResult & ModalInput & useViewSessionResult & useViewFieldsResult & useViewAppearanceResult,
    'sourceTableId'
    | 'setError'
    | 't'
    | 'setActiveTab'
    | 'visibleProperties'
    | 'filterTree'
    | 'sorts'
    | 'isTableMode'
    | 'editingView'
    | 'createdViewIdRef'
    | 'selectedExistingViewId'
    | 'isMultiTable'
    | 'joins'
    | 'sourceTableName'
    | 'viewName'
    | 'viewType'
    | 'visiblePropertiesToPersist'
    | 'resultSnapshot'
    | 'resultSnapshotLimit'
    | 'buildViewExtras'
    | 'api'
    | 'lastSavedViewRef'
    | 'existingViews'
    | 'editScope'
    | 'saveToTableViews'
    | 'heading'
    | 'headingLevel'
    | 'pageId'
    | 'modalPinnedViewIds'
>) {
    const persistView: PersistView = async ({ closeAfter = false } = {}) => {
        if (!sourceTableId) {
            setError(t('view.error_no_table', "You must select a source table"));
            setActiveTab('general');
            return null;
        }
        if (visibleProperties.length === 0) {
            setError(t('view.error_no_fields', "At least one visible field is required"));
            setActiveTab('properties');
            return null;
        }

        setError('');
        try {
            // Sanitize the filter tree: drop rules without a field, null out the
            // value for is_empty/is_not_empty, prune empty sub-groups. `cleanTree`
            // is the source of truth (complex AND/OR groups); `cleanFilters` is a
            // flat AND mirror kept ONLY when the tree is a simple single-level AND
            // of leaf rules — otherwise `[]`, so old readers don't misinterpret a
            // complex filter as a flat one (they fall back to `filterTree`).
            const cleanTree = sanitizeFilterTree(filterTree);
            const flat = flatAndRules(cleanTree);
            const cleanFilters = flat ? flat.map(f => ({ ...f })) : [];
            const filterTreeBody = cleanTree.rules.length ? cleanTree : null;
            const leafRules = collectLeafRules(cleanTree);

            const cleanSorts = sorts
                .filter(s => s.field)
                .map(s => ({ field: s.field, direction: s.direction || 'asc' }));
            // We keep `sort` (singular) for compatibility with the renderer/UI that
            // still reads a single criterion.
            const sortConfig = cleanSorts[0] || null;

            // TABLE mode: saves the registry view directly (creates or
            // updates), without a section or block. Runs on every autosave AND
            // on close. The first POST's id is captured in createdViewIdRef so
            // subsequent saves PUT (no duplicate views).
            if (isTableMode) {
                const existingId = editingView?.id || createdViewIdRef.current;
                const isMainViewSelection = (
                    editingView?.is_main
                    || editingView?.is_default
                    || existingId === 'default'
                    || selectedExistingViewId === 'default'
                );
                // Persist joins only when present (absence = single-table view,
                // fully backward compatible). `visiblePropertiesToPersist`
                // switches between plain strings (single-table) and the
                // composite `{tableId, fieldKey}` form (multi-table).
                const joinsToPersist = isMultiTable ? joins : undefined;
                const viewBody: ViewConfig = {
                    ...(editingView || {}),
                    table_id: sourceTableId,
                    name: isMainViewSelection
                        ? sourceTableName
                        : (viewName || editingView?.name || 'Vista').trim(),
                    ...(isMainViewSelection ? { is_main: true } : {}),
                    type: viewType,
                    filters: cleanFilters,
                    filterTree: filterTreeBody,
                    sort: sortConfig,
                    sorts: cleanSorts,
                    visibleProperties: visiblePropertiesToPersist,
                    resultSnapshot,
                    resultSnapshotLimit,
                    ...buildViewExtras(),
                };
                if (existingId) {
                    viewBody.id = existingId;
                }
                if (joinsToPersist) {
                    viewBody.joins = joinsToPersist;
                } else {
                    // Explicitly clear joins when the view is single-table, so a
                    // view that was previously multi-table is cleaned up.
                    delete viewBody.joins;
                }
                let saved: { id?: string | null };
                if (existingId) {
                    await api.updateVaultView(existingId, viewBody);
                    saved = {};
                } else {
                    saved = await api.createVaultView(viewBody);
                    // Feed the new id back so the next autosave PUTs instead of
                    // creating a duplicate.
                    if (saved.id) createdViewIdRef.current = saved.id;
                }
                // `saved` can be the created view (with a new id) or a status; in
                // any case we return the body with the resulting id.
                const savedView = {
                    ...viewBody,
                    id: existingId || saved.id || viewBody.id,
                };
                lastSavedViewRef.current = savedView;
                return savedView;
            }

            // EMBED mode: only persists when closing (flush-on-close). We don't
            // write the section to the page on every autosave — that would insert
            // it while the user is still configuring.
            if (!closeAfter) return null;

            // 'default' is the virtual main view (not persisted): the
            // we treat it as if the user had chosen "Create new view" with
            // saveToTableViews=true (this was forced in the useEffect of
            // selection). Here we clear the viewId so 'default' isn't sent
            // to the backend.
            const isDefaultPick = selectedExistingViewId === 'default';
            let viewId = (selectedExistingViewId && !isDefaultPick) ? selectedExistingViewId : null;

            // We reuse the existing view if a real one was chosen. If
            // the user has modified it:
            //   - editScope === 'shared': we upsert to the registry → affects all
            //     the pages that embed it (this is the natural behavior
            //     of a shared view).
            //   - editScope === 'fork': we remove the `view_id` reference and the
            //     the section is saved with inline fields. This way this page
            //     ends up disconnected from the shared view.
            if (selectedExistingViewId && !isDefaultPick) {
                const original = existingViews.find(x => x.id === selectedExistingViewId);
                const nextViewName = (viewName || original?.name || 'Vista').trim();
                const newPropsJson = JSON.stringify({
                    name: nextViewName,
                    // `type` also counts as a modification: without it, changing
                    // ONLY the type (table→board/feed/graph, without extras) did not
                    // was never upserted to the registry and DbViewEmbed —which prefers the
                    // view from the registry to the section— it kept rendering the old type.
                    type: viewType,
                    filterTree: cleanTree,
                    sorts: cleanSorts,
                    visibleProperties: visiblePropertiesToPersist,
                    joins: isMultiTable ? joins : undefined,
                    resultSnapshot,
                    resultSnapshotLimit,
                    // Options by type (gallery: cardSize/galleryPreview; board:
                    // groupBy; etc.). Without including them here, changing ONLY the
                    // preview or card size was not detected as a
                    // modification and the shared view was never applied to the registry
                    // (from where the render reads galleryPreview) → the change was lost.
                    ...buildViewExtras(),
                });
                const oldPropsJson = JSON.stringify({
                    name: (original?.name || ''),
                    type: inputValue(original?.view_type || original?.type || 'table').toLowerCase(),
                    // Normalize the original's filters through the same tree pipeline
                    // so a simple flat filter doesn't read as "modified" just because
                    // the new shape is a tree.
                    filterTree: sanitizeFilterTree(treeFromSource(original || {})),
                    sorts: original?.sorts || (original?.sort ? [original.sort] : []),
                    visibleProperties: original?.visibleProperties || ['title'],
                    joins: original?.joins || undefined,
                    resultSnapshot: original?.resultSnapshot !== false,
                    resultSnapshotLimit: Number.isFinite(Number(original?.resultSnapshotLimit)) ? Number(original?.resultSnapshotLimit) : 500,
                    ...buildViewExtras(original || {}),
                });
                const modified = newPropsJson !== oldPropsJson;

                if (modified && editScope === 'fork') {
                    // Undo the link: the section will be inline.
                    viewId = null;
                } else if (modified && editScope === 'shared') {
                    const updated = {
                        ...(original || {}),
                        id: selectedExistingViewId,
                        table_id: sourceTableId,
                        name: nextViewName,
                        ...(isMultiTable ? { joins } : {}),
                        type: viewType,
                        filters: cleanFilters,
                        filterTree: filterTreeBody,
                        sort: sortConfig,
                        sorts: cleanSorts,
                        visibleProperties: visiblePropertiesToPersist,
                        resultSnapshot,
                        resultSnapshotLimit,
                        ...buildViewExtras(),
                    };
                    await api.createVaultView(updated);
                }
            } else if (saveToTableViews) {
                // Case "create new": we create it first in registry.views[] so that
                // the section can reference it by id.
                const viewBody = {
                    table_id: sourceTableId,
                    name: (viewName || heading || 'Vista').trim(),
                    type: viewType,
                    filters: cleanFilters,
                    filterTree: filterTreeBody,
                    sort: sortConfig,
                    sorts: cleanSorts,
                    visibleProperties: visiblePropertiesToPersist,
                    ...(isMultiTable ? { joins } : {}),
                    resultSnapshot,
                    resultSnapshotLimit,
                    ...buildViewExtras(),
                    // If it filters by the page context ("this"), as a
                    // dashboard tab it would resolve nothing: it is marked embedded
                    // and only lives inside embeds (isPageEmbedView). Without
                    // "this", the "also save to the views" checkbox is respected
                    // of the table" and remains as a normal tab.
                    ...(leafRules.some(f => f.value === 'this') ? { embedded: true } : {}),
                };
                const created = await api.createVaultView(viewBody);
                viewId = created.id || null;
            }

            // 2) Creates the embedded section in the page. If we have view_id,
            // we reference the saved view (single source of truth). Without
            // view_id, we write the fields inline ("local view" mode).
            const sectionBody = {
                heading: heading.trim(),
                heading_level: headingLevel,
                type: 'db_view',
                source_table_id: sourceTableId,
                view_id: viewId,
                filters: cleanFilters,
                filterTree: filterTreeBody,
                sort: sortConfig,
                sorts: cleanSorts,
                visible_properties: visiblePropertiesToPersist,
                view_type: viewType,
                ...(isMultiTable ? { joins } : {}),
                ...buildViewExtras(),
                // Legacy: kept for sync_sections which still reads `columns`
                columns: visiblePropertiesToPersist,
            };

            // The typed client returns parsed JSON and throws on non-2xx.
            await api.upsertPageView(pageId, sectionBody);

            if (viewId) {
                try {
                    writePinnedViews(pageId, viewId, modalPinnedViewIds);
                } catch (e) {
                    logError('PageViewModal.pinnedViews', e);
                }
            }

            // We return enough info so the caller (BlockEditor) can insert
            // a dbViewEmbed block at the cursor with the full config.
            return {
                view_id: viewId,
                heading: heading.trim(),
                heading_level: headingLevel,
                source_table_id: sourceTableId,
                view_type: viewType,
                filters: cleanFilters,
                filterTree: filterTreeBody,
                sorts: cleanSorts,
                visible_properties: visibleProperties,
                ...buildViewExtras(),
            };
        } catch (e) {
            const message = isRecord(e) && typeof e.message === 'string' ? e.message : '';
            setError(message || t('view.error_create', "Unknown error creating the view"));
            throw e;
        }
    };

    return { persistView };
}
export type useViewPersistenceResult = ReturnType<typeof useViewPersistence>;
