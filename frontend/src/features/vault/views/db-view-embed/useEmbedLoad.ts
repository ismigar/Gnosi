import { useEffect, useEffectEvent, useRef } from 'react';
import { fetchPageViews, fetchVaultViews, fetchVaultPagesByTable, apiErrorDetail } from './api';
import { byTableGet, byTableSet } from './cache';
import { applyClientJoins } from './joins';
import { decodeView, legacyText } from './decode';
import { readPinned, readText, writeText, selectedKey } from './preferences';
import { reportEmbedError } from './diagnostics';
import type { EmbedView } from './types';
import type { EmbedInputs } from './inputs';
export function useEmbedLoad({ block, pageId, viewId, headingProp, ctx, t, reloadKey, setError, setLoading, setView, setRawRecords, setTemplates, setQuickPresets, presetStorageKey, setPinnedViewIds, setTableViews, setActiveViewId, setLoadDuration }: EmbedInputs) {
    const lastSavedNonceRef = useRef<number | undefined>(0);
    const beginLoad = useEffectEvent(() => {
        const inlineSectionStr = block?.props?.section;
        if (!pageId || (!viewId && !inlineSectionStr)) return undefined;
        let cancelled = false;
        const isCancelled = () => cancelled;
        const load = async () => {
            const startedAt = window.performance.now();
            setError('');
            setLoading(true);
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
                    { setRawRecords([]); setTemplates([]); setLoading(false); }
                    return;
                }

                const cached = byTableGet(tableId);
                let all = cached;
                if (!all) {
                    all = await fetchVaultPagesByTable(tableId);
                    byTableSet(tableId, all);
                }

                // Separate templates (for the "New" button's dropdown) from the
                // records to display. Templates never appear in the body
                // of the view, even if they pass the filters.
                const tpls = all.filter(p => p.metadata.is_template === true);
                let records = all.filter(p => !p.metadata.is_template);

                // Multi-table: if the view (or the section) defines joins,
                // expand the base rows with the joined tables' columns. The
                // joined metadata is exposed both unqualified (so filters/sort
                // on the base view keep working) and under `_join:{tableId}` for
                // the joined columns.
                const viewJoins = Array.isArray(section.joins) ? section.joins : null;
                if (viewJoins && viewJoins.length > 0) {
                    const loadJoined = async (tid: string) => {
                        let rows = byTableGet(tid);
                        if (!rows) {
                            rows = await fetchVaultPagesByTable(tid);
                            byTableSet(tid, rows);
                        }
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
                let registryViews = ctx.registry.views;
                if (ctx.viewSectionNonce !== lastSavedNonceRef.current) {
                    lastSavedNonceRef.current = ctx.viewSectionNonce;
                    try {
                        const fresh = await fetchVaultViews();
                        registryViews = fresh;
                    } catch { /* fallback: ctx.registry */ }
                }

                if (!isCancelled()) {
                    setRawRecords(records);
                    setTemplates(tpls);
                    // Pinned tabs = anchor view's `tabs` in the registry
                    // (portable; written by the Notion importer or by its own
                    // pinned by the user) ∪ legacy local preferences.
                    let pinned = [...readPinned(pageId, viewId)];
                    const anchorReg = registryViews.find(v => String(v.id) === viewId);
                    if (Array.isArray(anchorReg?.quickPresets)) {
                        setQuickPresets(anchorReg.quickPresets);
                        try { writeText(presetStorageKey, JSON.stringify(anchorReg.quickPresets)); } catch { /* noop */ }
                    }
                    if (Array.isArray(anchorReg?.tabs)) pinned = [...pinned, ...anchorReg.tabs.map(String)];
                    setPinnedViewIds(new Set(pinned));
                    // We guarantee the section's view is always there. A view
                    // belongs to the table if it is its base OR if it joins it.
                    const involves = (v: EmbedView) => String(v.table_id) === tableId
                        || (Array.isArray(v.joins) && v.joins.some(j => String(j.tableId) === tableId));
                    const tv = registryViews.filter(involves);
                    const sectionAsView: EmbedView = {
                        id: section.view_id,
                        name: section.heading || t('views_header.default_view_name', "View"),
                        type: section.view_type || 'table',
                        table_id: tableId,
                        filters: section.filters || [],
                        sorts: section.sorts || (section.sort ? [section.sort] : []),
                        visibleProperties: section.visible_properties || section.columns || ['title'],
                        // Per-type options saved in the section (ViewSection accepts
                        // extra fields); we preserve them so embeddedView can read them.
                        cardSize: section.cardSize,
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
    useEffect(() => beginLoad(), [viewId, pageId, headingProp, reloadKey, ctx.viewSectionNonce, block?.props?.section]);
}
