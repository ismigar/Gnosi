import { useEffect, useEffectEvent } from 'react';
import { TABS } from './constants';
import { emptyFilterTree, treeFromSource } from './filter-tree';
import { decodeView } from './decode';
import { readPinnedViews } from './pinned-views';
import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';
import type { useViewSessionResult } from './useViewSession';
import type { useViewAppearanceResult } from './useViewAppearance';
import type { ViewConfig } from './types';

export function useViewInitialization({
    isOpen, initializedRef, createdViewIdRef, lastSavedViewRef,
    pendingSaveRef, skipNextAutosaveRef, setAutosaveStatus, setJoins,
    setDiscardConfirmOpen, setFormBaselineRevision, setFormBaselineSnapshot, isTableMode,
    initialTab, setActiveTab, setError, setSaveToTableViews,
    setEditScope, setViewUsage, setSelectedExistingViewId, setSourceTableId,
    editingView, preselectedTableId, setViewType, setViewName,
    setVisibleProperties, setFilterTree, setSorts, setResultSnapshot,
    setResultSnapshotLimit, applyTypeOptions, resetTypeOptions, editingBlock,
    setHeading, setHeadingLevel, setModalPinnedViewIds, pageId,
    api, setExistingViews, setExistingViewsStatus
}: Pick<
    ModalInput & useViewSessionResult & useViewStateResult & useViewAppearanceResult,
    'isOpen'
    | 'initializedRef'
    | 'createdViewIdRef'
    | 'lastSavedViewRef'
    | 'pendingSaveRef'
    | 'skipNextAutosaveRef'
    | 'setAutosaveStatus'
    | 'setJoins'
    | 'setDiscardConfirmOpen'
    | 'setFormBaselineRevision'
    | 'setFormBaselineSnapshot'
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
        if (!isOpen) {
            // Reset the autosave bookkeeping so a reopen starts clean.
            initializedRef.current = false;
            createdViewIdRef.current = null;
            lastSavedViewRef.current = null;
            pendingSaveRef.current = null;
            skipNextAutosaveRef.current = false;
            setAutosaveStatus('idle');
            setJoins([]);
            setDiscardConfirmOpen(false);
            setFormBaselineRevision(0);
            setFormBaselineSnapshot('');
            return;
        }
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
            // Initialization just wrote editing state: skip the first autosave
            // tick so it isn't treated as a user change.
            initializedRef.current = true;
            skipNextAutosaveRef.current = true;
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
            if (!vid && p.section) {
                try { inline = decodeView(JSON.parse(p.section)); } catch { /* malformat */ }
            }
            setViewName('');
            setSaveToTableViews(false);
            setViewUsage({ count: 0, pages: [] });
            setEditScope('shared');

            if (vid) {
                // Preload via a direct fetch so the chained useEffects don't
                // (sourceTableId → existingViews → selectedExistingViewId) no
                // end up clearing the selection before the view has been read.
                let cancelled = false;
                initializedRef.current = true; // async prefill below will re-arm skip
                api.fetchVaultView(vid)
                    .then(payload => {
                        const v = payload ? decodeView(payload) : null;
                        if (cancelled || !v) return;
                        setSourceTableId((v.table_id || ''));
                        setViewName((v.name || ''));
                        setViewType((v.type || 'table'));
                        setVisibleProperties(Array.isArray(v.visibleProperties) && v.visibleProperties.length ? v.visibleProperties : ['title']);
                        setJoins(Array.isArray(v.joins) ? v.joins : []);
                        setFilterTree(treeFromSource(v));
                        setResultSnapshot(v.resultSnapshot !== false);
                        setResultSnapshotLimit(Number.isFinite(Number(v.resultSnapshotLimit)) ? Number(v.resultSnapshotLimit) : 500);
                        applyTypeOptions(v);
                        if (Array.isArray(v.sorts) && v.sorts.length > 0) {
                            setSorts(v.sorts);
                        } else if (v.sort && v.sort.field) {
                            setSorts([{ field: v.sort.field, direction: v.sort.direction || 'asc' }]);
                        } else {
                            setSorts([]);
                        }
                        // We put the view directly into the existing list
                        // so the dropdown shows it selected.
                        setExistingViews(prev => {
                            if (prev.some(x => x.id === v.id)) return prev;
                            return [{ ...v, id: vid }, ...prev];
                        });
                        setSelectedExistingViewId(vid);
                        // Async prefill finished: the state writes above would
                        // otherwise look like a user edit and trigger autosave.
                        skipNextAutosaveRef.current = true;
                        setFormBaselineRevision(revision => revision + 1);
                    })
                    .catch(() => {
                        // If we fail, we leave the modal in create-new mode.
                        if (!cancelled) {
                            setSourceTableId(preselectedTableId || '');
                            setSelectedExistingViewId('');
                            skipNextAutosaveRef.current = true;
                            setFormBaselineRevision(revision => revision + 1);
                        }
                    });
                return () => { cancelled = true; };
            }

            // Local view (inline). We pre-fill from the serialized JSON.
            setSelectedExistingViewId('');
            setSourceTableId(inline?.source_table_id || preselectedTableId || '');
            setViewType(inline?.type || 'table');
            setFilterTree(treeFromSource(inline || {}));
            setSorts(Array.isArray(inline?.sorts) ? inline.sorts : []);
            setVisibleProperties(Array.isArray(inline?.visibleProperties) && inline.visibleProperties.length ? inline.visibleProperties : ['title']);
            setResultSnapshot(inline?.resultSnapshot !== false);
            setResultSnapshotLimit(Number.isFinite(Number(inline?.resultSnapshotLimit)) ? Number(inline?.resultSnapshotLimit) : 500);
            applyTypeOptions(inline);
            setExistingViews([]);
            initializedRef.current = true;
            skipNextAutosaveRef.current = true;
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
        initializedRef.current = true;
        skipNextAutosaveRef.current = true;
        setFormBaselineRevision(revision => revision + 1);
    });
    useEffect(() => {
        let active = true;
        let release: (() => void) | undefined;
        queueMicrotask(() => { if (active) release = hydrate1(); });
        return () => { active = false; release?.(); };
    }, [isOpen, preselectedTableId, editingBlock, isTableMode, editingView, initialTab]);
    return {};
}
export type useViewInitializationResult = ReturnType<typeof useViewInitialization>;
