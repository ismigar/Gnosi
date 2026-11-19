import { useEffect, useEffectEvent } from 'react';
import { GnosiApiError } from '../../../../shared/api/errors';
import { TABS } from './constants';
import { emptyFilterTree, treeFromSource } from './filter-tree';
import { decodeView } from './decode';
import { readPinnedViews } from './pinned-views';
import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';
import { viewSelectionKey, type useViewSessionResult } from './useViewSession';
import type { useViewAppearanceResult } from './useViewAppearance';
import type { ViewConfig } from './types';

export function useViewInitialization({
    appliedSelectionRef, registryViewsRef, inlineSourceRef, readCatalog, setJoins,
    setFormBaselineRevision, isTableMode,
    initialTab, setActiveTab, setError, setSaveToTableViews,
    setEditScope, setViewUsage, setSelectedExistingViewId, setSourceTableId,
    editingView, preselectedTableId, setViewType, setViewName,
    setVisibleProperties, setFilterTree, setSorts, setResultSnapshot,
    setResultSnapshotLimit, applyTypeOptions, resetTypeOptions, editingBlock,
    setHeading, setHeadingLevel, setModalPinnedViewIds, pageId,
    viewLoadRetryKey, setViewLoadStatus,
    api, setExistingViews, setExistingViewsStatus
}: Pick<
    ModalInput & useViewSessionResult & useViewStateResult & useViewAppearanceResult,
    'appliedSelectionRef' | 'registryViewsRef' | 'inlineSourceRef' | 'readCatalog'
    | 'viewLoadRetryKey'
    | 'setViewLoadStatus'
    | 'setJoins'
    | 'setFormBaselineRevision'
    | 'isTableMode'
    | 't'
    | 'initialTab'
    | 'setActiveTab'
    | 'setError'
    | 'setSaveToTableViews'
    | 'setEditScope'
    | 'setViewUsage'
    | 'setSelectedExistingViewId'
    | 'setSourceTableId'
    | 'editingView'
    | 'preselectedTableId'
    | 'setViewType'
    | 'setViewName'
    | 'setVisibleProperties'
    | 'setFilterTree'
    | 'setSorts'
    | 'setResultSnapshot'
    | 'setResultSnapshotLimit'
    | 'applyTypeOptions'
    | 'resetTypeOptions'
    | 'editingBlock'
    | 'setHeading'
    | 'setHeadingLevel'
    | 'setModalPinnedViewIds'
    | 'pageId'
    | 'api'
    | 'setExistingViews'
    | 'setExistingViewsStatus'
>) {
    const hydrate1 = useEffectEvent(() => {
        setViewLoadStatus('ready');
        // TABLE mode: we configure a registry view directly (not an
        // embed). We pre-fill from `editingView` (or defaults if we're creating one).
        if (isTableMode) {
            // 'appearance' from the old modal = 'general' tab here. Only known ids.
            const validIds = new Set(TABS.map(t => t.id));
            const norm = initialTab === 'appearance' ? 'general' : initialTab;
            setActiveTab(norm && validIds.has(norm) ? norm : 'general');
            setError('');
            setSaveToTableViews(false);
            setEditScope('shared');
            setViewUsage({ count: 0, pages: [] });
            setSelectedExistingViewId('');
            setSourceTableId((editingView?.table_id || preselectedTableId || ''));
            if (editingView) {
                setViewType((editingView.type || 'table'));
                setViewName((editingView.name || ''));
                setVisibleProperties(
                    Array.isArray(editingView.visibleProperties) && editingView.visibleProperties.length
                        ? editingView.visibleProperties
                        : ['title']
                );
                setJoins(Array.isArray(editingView.joins) ? editingView.joins : []);
                setFilterTree(treeFromSource(editingView));
                if (Array.isArray(editingView.sorts) && editingView.sorts.length) {
                    setSorts(editingView.sorts);
                } else if (editingView.sort && editingView.sort.field) {
                    setSorts([{ field: editingView.sort.field, direction: editingView.sort.direction || 'asc' }]);
                } else {
                    setSorts([]);
                }
                setResultSnapshot(editingView.resultSnapshot !== false);
                setResultSnapshotLimit(
                    Number.isFinite(Number(editingView.resultSnapshotLimit)) ? Number(editingView.resultSnapshotLimit) : 500
                );
                applyTypeOptions(editingView);
            } else {
                setViewType('table');
                setViewName('');
                setVisibleProperties(['title']);
                setJoins([]);
                setFilterTree(emptyFilterTree());
                setSorts([]);
                setResultSnapshot(true);
                setResultSnapshotLimit(500);
                resetTypeOptions();
            }
            setFormBaselineRevision(revision => revision + 1);
            return;
        }
        // EDIT mode: we prefill from the existing block's props.
        // If the section has a view_id, we'll load it in the existing
        // views useEffect (automatic selection). If not, we parse `section` (config
        // inline) to fill filters/sorts/visible_properties.
        if (editingBlock) {
            const p = editingBlock.props || {};
            setActiveTab('general');
            setHeading((p.heading || ''));
            setHeadingLevel(Number(p.heading_level) || 1);
            setError('');

            const vid = (p.view_id || '');
            // Restore pinned views through the shared storage adapter.
            setModalPinnedViewIds(readPinnedViews(pageId, vid));

            // Inline fallback (disconnected local view)
            let inline: ViewConfig | null = null;
            if (p.section) {
                try { inline = decodeView(JSON.parse(p.section)); } catch { /* malformat */ }
            }
            setViewName('');
            setSaveToTableViews(false);
            setViewUsage({ count: 0, pages: [] });
            setEditScope('shared');

            if (vid) {
                let cancelled = false;
                setViewLoadStatus('loading');
                setSelectedExistingViewId(vid);
                const applyView = (v: ViewConfig, selectedId = vid) => {
                    inlineSourceRef.current = selectedId ? null : v;
                    appliedSelectionRef.current = viewSelectionKey(v.table_id || preselectedTableId || '', selectedId);
                    setSelectedExistingViewId(selectedId);
                    setSaveToTableViews(Boolean(selectedId) && (selectedId === 'default' || v.is_main === true));
                    setModalPinnedViewIds(readPinnedViews(pageId, selectedId, Array.isArray(v.tabs) ? v.tabs.map(String) : []));
                    setSourceTableId(v.table_id || preselectedTableId || '');
                    setViewName(v.name || '');
                    setViewType(v.type || 'table');
                    setVisibleProperties(v.visibleProperties?.length ? v.visibleProperties : ['title']);
                    setJoins(v.joins || []);
                    setFilterTree(treeFromSource(v));
                    setResultSnapshot(v.resultSnapshot !== false);
                    setResultSnapshotLimit(Number.isFinite(Number(v.resultSnapshotLimit)) ? Number(v.resultSnapshotLimit) : 500);
                    applyTypeOptions(v);
                    setSorts(v.sorts?.length ? v.sorts : v.sort?.field ? [v.sort] : []);
                    if (selectedId) setExistingViews(prev => [{ ...v, id: selectedId }, ...prev.filter(x => x.id !== selectedId)]);
                    setViewLoadStatus('ready');
                    setFormBaselineRevision(revision => revision + 1);
                };
                // The embed already knows the complete effective view. Reuse it so
                // opening its settings does not depend on a second network request.
                const loaded = editingBlock.view ? decodeView(editingBlock.view) : null;
                // A registered block can initially render its page section while
                // the registry is loading. That fallback carries view_id and
                // can lack the catalog name, protection flags and other options.
                if (loaded?.table_id && loaded.view_id !== vid && (!loaded.id || loaded.id === vid)) {
                    applyView(loaded);
                    return;
                }
                let missing = false;
                const byId = api.fetchVaultView(vid).then(payload => {
                    const v = decodeView(payload);
                    missing = !payload;
                    if (!v.table_id || (v.id && v.id !== vid)) throw new Error('Missing saved view');
                    return v;
                }).catch((error: unknown) => {
                    missing ||= error instanceof GnosiApiError && error.status === 404;
                    throw error;
                });
                const sources = [byId];
                if (loaded?.view_id === vid && loaded.table_id) {
                    sources.push(readCatalog(loaded.table_id).then(views => {
                        const registered = views.find(v => v.id === vid);
                        if (!registered) throw new Error('View is absent from the catalog');
                        return registered;
                    }));
                }
                void Promise.any(sources).then(v => {
                    if (cancelled) return;
                    registryViewsRef.current.set(vid, v);
                    applyView(v);
                }, () => {
                    if (cancelled) return;
                    // A deleted registry entry can still have a complete page
                    // section. Keep that draft editable as a local view.
                    if (missing && loaded?.view_id === vid && loaded.table_id) applyView(loaded, '');
                    else setViewLoadStatus('error');
                });
                return () => { cancelled = true; };
            }

            // Local view (inline). We pre-fill from the serialized JSON.
            setSelectedExistingViewId('');
            const local = editingBlock.view ? decodeView(editingBlock.view) : inline;
            inlineSourceRef.current = local;
            setSourceTableId(local?.table_id || local?.source_table_id || preselectedTableId || '');
            setViewName(local?.name || '');
            setJoins(local?.joins || []);
            setViewType(local?.type || 'table');
            setFilterTree(treeFromSource(local || {}));
            setSorts(local?.sorts?.length ? local.sorts : local?.sort?.field ? [local.sort] : []);
            setVisibleProperties(Array.isArray(local?.visibleProperties) && local.visibleProperties.length ? local.visibleProperties : ['title']);
            setResultSnapshot(local?.resultSnapshot !== false);
            setResultSnapshotLimit(Number.isFinite(Number(local?.resultSnapshotLimit)) ? Number(local?.resultSnapshotLimit) : 500);
            applyTypeOptions(local);
            setExistingViews([]);
            setFormBaselineRevision(revision => revision + 1);
            return;
        }
        // CREATE mode: everything clean.
        setActiveTab('general');
        setHeading('');
        setHeadingLevel(1);
        setSourceTableId(preselectedTableId || '');
        setViewName('');
        setVisibleProperties(['title']);
        setViewType('table');
        setFilterTree(emptyFilterTree());
        setSorts([]);
        setResultSnapshot(true);
        setResultSnapshotLimit(500);
        setSaveToTableViews(true);
        setSelectedExistingViewId('');
        setExistingViews([]);
        setExistingViewsStatus('loading');
        setViewUsage({ count: 0, pages: [] });
        setEditScope('shared');
        setModalPinnedViewIds(new Set());
        resetTypeOptions();
        setError('');
        setFormBaselineRevision(revision => revision + 1);
    });
    useEffect(() => {
        let active = true;
        let release: (() => void) | undefined;
        queueMicrotask(() => { if (active) release = hydrate1(); });
        return () => { active = false; release?.(); };
    }, [preselectedTableId, editingBlock, isTableMode, editingView, initialTab, viewLoadRetryKey]);
    return {};
}
export type useViewInitializationResult = ReturnType<typeof useViewInitialization>;
