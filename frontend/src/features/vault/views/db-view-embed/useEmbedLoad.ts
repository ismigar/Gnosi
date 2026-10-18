import { useCallback, useContext, useEffect, useEffectEvent, useMemo, useRef } from 'react';
import { VaultEditorContext } from '../../../../shared/editor/VaultEditorContext';
import { getActiveVaultId } from '../../../../shared/api/vault-context';
import { fetchPageViews, fetchVaultViews, fetchVaultPagesByTable, apiErrorDetail } from './api';
import { applyClientJoins } from './joins';
import { decodeView, legacyText } from './decode';
import { readPinned, readText, writeText, selectedKey, pinnedKey } from './preferences';
import { reportEmbedError } from './diagnostics';
import type { EmbedView } from './types';
import type { EmbedInputs } from './inputs';
export type EmbedRegistryPublisher = (update: EmbedView[] | ((views: EmbedView[]) => EmbedView[]), generation?: number) => boolean;
export type BeginEmbedRegistryRead = () => (views: EmbedView[] | null) => boolean;
export function useEmbedLoad({ block, pageId, viewId, view, headingProp, ctx, t, reloadKey, setError, setLoading, setView, setRawRecords, setTableRecords, setTemplates, setQuickPresets, presetStorageKey, setPinnedViewIds, setTableViews, setActiveViewId, setLoadDuration }: EmbedInputs) {
    // decodeContext recreates its arrays when unrelated editor context changes.
    // Scope cached server views to the original registry and the active embed.
    const sourceViews = useContext(VaultEditorContext).registry.views;
    const vaultId = getActiveVaultId();
    const registryCacheRef = useRef<{
        sourceViews: readonly unknown[];
        vaultId: string;
        pageId: string | null;
        viewId: string;
        views: EmbedView[];
        savedNonce: number | undefined;
    } | null>(null);
    const registryRevisionRef = useRef(0);
    const registryRequestRef = useRef(0);
    const registryNeedsRefreshRef = useRef(false);
    const registryPendingRef = useRef<number | null>(null);
    const publicationScope = useMemo(() => ({ sourceViews, vaultId, pageId, viewId, nonce: ctx.viewSectionNonce }),
        [sourceViews, vaultId, pageId, viewId, ctx.viewSectionNonce]);
    const activeScopeRef = useRef<typeof publicationScope | null>(null);
    useEffect(() => {
        activeScopeRef.current = publicationScope;
        registryNeedsRefreshRef.current = false;
        registryPendingRef.current = null;
        return () => { activeScopeRef.current = null; };
    }, [publicationScope]);
    const isRegistryScopeCurrent = useCallback(() => activeScopeRef.current === publicationScope
        && getActiveVaultId() === vaultId, [publicationScope, vaultId]);
    const publishRegistry: EmbedRegistryPublisher = useCallback((update, generation) => {
        if (!isRegistryScopeCurrent()) return false;
        if (generation !== undefined && generation !== registryRequestRef.current) return false;
        const cached = registryCacheRef.current;
        const sameScope = cached?.vaultId === vaultId && cached.pageId === pageId && cached.viewId === viewId
            && cached.sourceViews === sourceViews;
        const previous = sameScope ? cached.views : ctx.registry.views;
        const isFullRegistry = typeof update !== 'function';
        const views = isFullRegistry ? update : update(previous);
        const savedNonce = isFullRegistry ? ctx.viewSectionNonce : (sameScope ? cached.savedNonce : 0);
        registryCacheRef.current = { sourceViews, vaultId, pageId, viewId, views, savedNonce };
        registryRevisionRef.current += 1;
        registryRequestRef.current += 1;
        if (isFullRegistry) registryNeedsRefreshRef.current = false;
        else if (registryPendingRef.current !== null) registryNeedsRefreshRef.current = true;
        registryPendingRef.current = null;
        return true;
    }, [isRegistryScopeCurrent, vaultId, pageId, viewId, sourceViews, ctx.registry.views, ctx.viewSectionNonce]);
    // Allocate before network I/O so a delayed old response cannot claim freshness.
    const beginRegistryRead: BeginEmbedRegistryRead = useCallback(() => {
        if (!isRegistryScopeCurrent()) return () => false;
        const generation = ++registryRequestRef.current;
        registryPendingRef.current = generation;
        return views => {
            if (views !== null) return publishRegistry(views, generation);
            if (isRegistryScopeCurrent() && generation === registryRequestRef.current) {
                registryPendingRef.current = null;
                registryNeedsRefreshRef.current = true;
            }
            return false;
        };
    }, [publishRegistry, isRegistryScopeCurrent]);
    const beginLoad = useEffectEvent(() => {
        const inlineSectionStr = block?.props?.section;
        if (!pageId || (!viewId && !inlineSectionStr)) return undefined;
        let cancelled = false;
        const registryRevision = registryRevisionRef.current;
        const isCancelled = () => cancelled || getActiveVaultId() !== vaultId;
        const load = async () => {
            const startedAt = window.performance.now();
            setError('');
            // Keep the mounted search and renderer during background refreshes.
            if (!view) setLoading(true);
            try {
                let section: EmbedView | null | undefined = null;
                if (viewId) {
                    const viewsData = await fetchPageViews(pageId);
                    const sections = viewsData.sections;
                    section = sections.find(s => s.view_id === viewId)
                        || (headingProp ? sections.find(s => s.heading === headingProp) : null);
                    // Fallback: if this block has no registered section (e.g. because
                    // the PER HEADING section upsert has collided with another
                    // it's an embed without a heading on the same page), but the view DOES
                    // exist in the registry, we build the section from the view.
                    // The fence's `view_id` is the source of truth: this way the block
                    // renders even if the page section has been lost.
                    if (!section) {
                        let regView = ctx.registry.views.find(v => String(v.id) === viewId);
                        if (!regView) {
                            try {
                                const allViews = await fetchVaultViews();
                                regView = allViews.find(v => String(v.id) === viewId);
                            } catch { /* registry inaccessible: it will fall to the error below */ }
                        }
                        if (regView) {
                            section = {
                                view_id: regView.id || undefined,
                                heading: headingProp || '',
                                source_table_id: regView.table_id || undefined,
                                view_type: regView.type || 'table',
                                filters: regView.filters || [],
                                sorts: regView.sorts || (regView.sort ? [regView.sort] : []),
                                visible_properties: regView.visibleProperties || regView.visible_properties || ['title'],
                            };
                        }
                    }
                } else if (inlineSectionStr) {
                    try {
                        section = decodeView(JSON.parse(inlineSectionStr));
                    } catch {
                        section = null;
                    }
                }
                if (isCancelled()) return;
                if (!section) {
                    {
                        setView(null);
                        setRawRecords([]);
                        setTableRecords([]);
                        setTemplates([]);
                        if (viewId) {
                            setError(t('errors.view_not_found_registry', "View \"{{id}}...\" not found in the registry.", { id: viewId.slice(0, 8) }));
                        } else {
                            setError(t('errors.view_not_found_registry', "Invalid inline view configuration.", { id: '' }));
                        }
                        setLoading(false);
                    }
                    return;
                }
                setView(section);

                const tableId = section.source_table_id || section.table_id;
                if (!tableId) {
                    { setRawRecords([]); setTableRecords([]); setTemplates([]); setLoading(false); }
                    return;
                }

                // The shared API coalesces concurrent reads and scopes them to
                // the active vault. A second five-minute cache hid saved titles.
                const all = await fetchVaultPagesByTable(tableId);
                if (isCancelled()) return;

                // Separate templates (for the "New" button's dropdown) from the
                // records to display. Templates never appear in the body
                // of the view, even if they pass the filters.
                const tpls = all.filter(p => p.metadata.is_template === true);
                let records = all.filter(p => !p.metadata.is_template);
                const baseRecords = records;

                // Multi-table: if the view (or the section) defines joins,
                // expand the base rows with the joined tables' columns. The
                // joined metadata is exposed both unqualified (so filters/sort
                // on the base view keep working) and under `_join:{tableId}` for
                // the joined columns.
                const viewJoins = Array.isArray(section.joins) ? section.joins : null;
                if (viewJoins && viewJoins.length > 0) {
                    const loadJoined = async (tid: string) => {
                        const rows = await fetchVaultPagesByTable(tid);
                        return rows.filter(p => !p.metadata.is_template);
                    };
                    try {
                        records = await applyClientJoins(records, viewJoins, loadJoined);
                    } catch (e) {
                        reportEmbedError('applyClientJoins failed', e);
                    }
                }

                // The table's views (for the tabs and for the cardSize/
                // galleryPreview from which embeddedView derives). They usually come from
                // ctx.registry, but right after a view's config is saved to
                // (viewSectionNonce has changed) this one goes stale — saving touches
                // the backend, not to ctx.registry—, so we reread the views
                // fresh, so the change (size/preview…) is visible live.
                // Record writes reload the embed before the editor registry catches up.
                // Keep the registry fetched after configuration saves across those reloads.
                const cached = registryCacheRef.current;
                const sameEmbed = cached?.vaultId === vaultId && cached.pageId === pageId && cached.viewId === viewId;
                let registryViews = sameEmbed && cached.sourceViews === sourceViews ? cached.views : ctx.registry.views;
                let savedNonce = sameEmbed ? cached.savedNonce : 0;
                if (ctx.viewSectionNonce !== savedNonce || registryNeedsRefreshRef.current) {
                    const publish = beginRegistryRead();
                    try {
                        const fresh = await fetchVaultViews();
                        if (isCancelled()) return;
                        if (publish(fresh)) {
                            registryViews = fresh;
                            savedNonce = ctx.viewSectionNonce;
                        }
                    } catch { publish(null); /* retain the latest registry and retry on a later load */ }
                }
                if (isCancelled()) return;
                // A tab action may publish newer server views while this load awaits I/O.
                if (registryRevision !== registryRevisionRef.current && registryCacheRef.current) {
                    registryViews = registryCacheRef.current.views;
                    savedNonce = registryCacheRef.current.savedNonce;
                }
                registryCacheRef.current = { sourceViews, vaultId, pageId, viewId, views: registryViews, savedNonce };

                if (!isCancelled()) {
                    setRawRecords(records);
                    setTableRecords(baseRecords);
                    setTemplates(tpls);
                    // Explicit block preferences override registry defaults, including order and removals.
                    let pinned = [...readPinned(pageId, viewId)];
                    const anchorReg = registryViews.find(v => String(v.id) === viewId);
                    if (Array.isArray(anchorReg?.quickPresets)) {
                        setQuickPresets(anchorReg.quickPresets);
                        try { writeText(presetStorageKey, JSON.stringify(anchorReg.quickPresets)); } catch { /* noop */ }
                    }
                    if (readText(pinnedKey(pageId, viewId)) === undefined && Array.isArray(anchorReg?.tabs)) pinned = anchorReg.tabs.map(String);
                    setPinnedViewIds(new Set(pinned));
                    // We guarantee the section's view is always there. A view
                    // belongs to the table if it is its base OR if it joins it.
                    const involves = (v: EmbedView) => String(v.table_id) === tableId
                        || (Array.isArray(v.joins) && v.joins.some(j => String(j.tableId) === tableId));
                    const tv = registryViews.filter(involves);
                    const sectionAsView: EmbedView = {
                        id: section.view_id,
                        displayTitle: section.displayTitle,
                        filterTree: section.filterTree,
                        filter: section.filter,
                        name: section.heading || t('views_header.default_view_name', "View"),
                        type: section.view_type || 'table',
                        table_id: tableId,
                        filters: section.filters || [],
                        sorts: section.sorts || (section.sort ? [section.sort] : []),
                        visibleProperties: section.visible_properties || section.columns || ['title'],
                        // Per-type options saved in the section (ViewSection accepts
                        // extra fields); we preserve them so embeddedView can read them.
                        cardSize: section.cardSize,
                        heightMode: section.heightMode,
                        heightPercent: section.heightPercent,
                        galleryPreview: section.galleryPreview,
                        coverField: section.coverField || section.cover_field,
                        imageFit: section.imageFit || section.image_fit,
                        groupBy: section.groupBy || section.group_by,
                        groupSort: section.groupSort || section.group_sort,
                        groupSortDir: section.groupSortDir || section.group_sort_dir,
                        dateField: section.dateField || section.date_field,
                        endDateField: section.endDateField || section.end_date_field,
                        calendarView: section.calendarView || section.calendar_view,
                        colorField: section.colorField || section.color_field,
                        rowHeight: section.rowHeight || section.row_height,
                        enableSubitems: section.enableSubitems ?? section.enable_subitems,
                        columnWidths: section.columnWidths || section.column_widths,
                        // Chart options (the 'chart' view).
                        chartType: section.chartType || section.chart_type,
                        xField: section.xField || section.x_field,
                        yField: section.yField || section.y_field,
                        aggregation: section.aggregation,
                    };
                    const merged = tv.some(v => v.id === section.view_id) ? tv : [sectionAsView, ...tv];
                    setTableViews(merged);
                    // Remembers the last selected tab if it still exists;
                    // otherwise, it falls back to the block's section view. The key must
                    // be STABLE across reloads: `block.id` gets regenerated by
                    // BlockNote on every load, but the section's `pageId`+`view_id`
                    // are persisted in the markdown fence.
                    let saved = '';
                    try { saved = readText(selectedKey(pageId, viewId)) || ''; } catch { /* noop */ }
                    const def = (saved && merged.some(v => v.id === saved)) ? saved : section.view_id;
                    setActiveViewId(prev => prev || def);
                    const duration = (window.performance.now()) - startedAt;
                    setLoadDuration(duration);
                    try { writeText(`gnosi.view.lastLoad.${legacyText(pageId)}.${viewId}`, String(Math.round(duration))); } catch { /* noop */ }
                    setLoading(false);
                }
            } catch (e) {
                if (!isCancelled()) {
                    setError(apiErrorDetail(e, t('errors.load_view', "Error loading the view")));
                    setRawRecords([]);
                    setTableRecords([]);
                    setTemplates([]);
                    setLoading(false);
                }
            }
        };
        queueMicrotask(() => { if (!isCancelled()) void load(); });
        return () => { cancelled = true; };
        // `ctx.viewSectionNonce` increments when a view's config is saved
        // (BlockEditor): we re-trigger the load to read the updated section
        // (cardSize/galleryPreview/…), because editing only the size doesn't change
        // viewId/headingProp and the useEffect wouldn't re-trigger otherwise.
    });
    useEffect(() => beginLoad(), [viewId, pageId, headingProp, reloadKey, ctx.viewSectionNonce, block?.props?.section, sourceViews, vaultId]);
    return { publishRegistry, beginRegistryRead, isRegistryScopeCurrent };
}
