import { useEffect, useEffectEvent } from 'react';
import { toast } from '../../../shared/notifications/toast';
import { documentTabId } from '../../../shared/resources/fileResource';
import { isGlobalSearchShortcut } from '../../../shared/page-search/globalSearchUtils';
import { subscribeAppEvent, subscribeAppSignal, type OpenDocumentEventDetail, type RelationUnlinkedEventDetail } from '../../../shared/platform/app-events';
import { subscribeWindowEvent } from '../../../shared/platform/browser-events';
import { record, text, readDocumentKind } from './readers';
import type { RelationOperation } from './types';
import type { DashboardActions } from './useDashboardActions';
// Dashboard owns this legacy event, using the same domain augmentation pattern
// as the sidebar and embedded views; no shared adapter change is needed.
declare module '../../../shared/platform/app-events' {
    interface AppEventMap { readonly 'vault-open-folder': { readonly folder?: string }; }
}
export function useDashboardEvents(context: DashboardActions) {
    const { pendingRelationUndoRef, setPendingRelationUndo } = context;
    const onImported = useEffectEvent((detail: unknown) => {
        const data = record(detail);
        const { t, fetchPages } = context;
        if (data.error) {
            const message = t('errors.import_notes', 'Error importing: {{error}}', { error: data.error });
            if (!toast.error(message))
                toast(message);
            return;
        }
        void fetchPages();
        toast(t('vault.notes_imported_to', { count: typeof data.imported === 'number' ? data.imported : 0, folder: data.folder || 'Importades' }));
    });
    const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
        if (isGlobalSearchShortcut(event)) {
            event.preventDefault();
            context.setIsGlobalSearchOpen(open => !open);
        }
        if (event.key === 'Escape') {
            context.setIsGlobalSearchOpen(false);
            context.setIsRecentOpen(false);
            context.closePromptModal();
        }
    });
    const onUndoRedo = useEffectEvent((event: KeyboardEvent) => {
        if (!(event.metaKey || event.ctrlKey))
            return;
        const active = document.activeElement;
        if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA' || (active instanceof HTMLElement && active.isContentEditable))
            return;
        const key = event.key.toLowerCase();
        if (key === 'z' && !event.shiftKey) {
            const pending = context.pendingRelationUndoRef.current;
            if (pending) {
                event.preventDefault();
                void pending();
                return;
            }
            if (context.undoStack.length === 0)
                return;
            event.preventDefault();
            void context.undoLastOperation();
        }
        else if ((key === 'z' && event.shiftKey) || key === 'y') {
            if (context.redoStack.length === 0)
                return;
            event.preventDefault();
            void context.redoLastOperation();
        }
    });
    const onOpenPdf = useEffectEvent((detail: OpenDocumentEventDetail, event: Event) => {
        const { src, title, kind, location } = detail;
        if (!src)
            return;
        event.preventDefault();
        const id = documentTabId(src);
        const origin = { tableId: context.activeTableId, tabId: context.activeTabId, viewId: context.activeViewId };
        context.setTabs(previous => previous.some(tab => tab.id === id)
            ? previous.map(tab => tab.id === id ? { ...tab, origin, location: location || null } : tab)
            : [...previous, { id, title: title || context.t('common.document', 'document'), isPdf: true, src, kind: readDocumentKind(kind), origin, location: location || null }]);
        context.setActiveTabId(id);
        context.setViewMode('editor');
        context.setActiveTableId(null);
    });
    const onRelationUnlinked = useEffectEvent((detail: RelationUnlinkedEventDetail) => {
        if (!detail.pageId || !detail.metadataKey || !Array.isArray(detail.previousValue) || !Array.isArray(detail.nextValue))
            return;
        const operation: RelationOperation = { type: 'relation_unlink', ...detail };
        const { setUndoStack, setRedoStack, applyRelationHistoryValue, t } = context;
        setUndoStack(previous => [...previous, operation]);
        setRedoStack([]);
        setPendingRelationUndo(async () => {
            if (!await applyRelationHistoryValue(operation, operation.previousValue))
                return;
            setPendingRelationUndo(null);
            setUndoStack(previous => {
                const index = previous.lastIndexOf(operation);
                return index < 0 ? previous : [...previous.slice(0, index), ...previous.slice(index + 1)];
            });
            setRedoStack(previous => [...previous, operation]);
            toast.success(t('relation_item.undo_success', 'Relation restored'));
        });
        toast(item => <span className="flex items-center gap-3">
            <span className="min-w-0">{t('relation_item.removed_toast', 'Relation removed: {{title}}', { title: detail.relationTitle || detail.relationId })}</span>
            <button type="button" onClick={() => {
                toast.dismiss(item.id);
                const pending = pendingRelationUndoRef.current;
                if (pending)
                    void pending();
                else
                    void context.undoLastOperation();
            }} className="shrink-0 rounded bg-[var(--gnosi-primary)] px-2 py-0.5 text-xs font-semibold text-white hover:opacity-90">{t('common.undo', 'Undo')}</button>
            <kbd className="shrink-0 text-[10px] text-[var(--text-tertiary)]">⌘/Ctrl+Z</kbd>
        </span>, { duration: 8000 });
    });
    const onOpenSearch = useEffectEvent(() => { context.setIsGlobalSearchOpen(true); });
    const onOpenTags = useEffectEvent(() => { if (context.isPluginEnabled('tags-page'))
        context.setIsTagsOpen(true); });
    const onPresent = useEffectEvent(() => { context.setIsPresentOpen(true); });
    const onWorkspaces = useEffectEvent(() => { context.setIsWorkspacesOpen(true); });
    const onFolder = useEffectEvent((detail: unknown) => {
        const folder = text(record(detail).folder);
        if (folder)
            void context.loadPage(folder);
    });
    const onRecordsDeleted = useEffectEvent((detail: unknown) => {
        const rawIds = record(detail).ids;
        const ids = Array.isArray(rawIds) ? rawIds.filter((id): id is string => typeof id === 'string' && Boolean(id)) : [];
        if (!ids.length)
            return;
        setPendingRelationUndo(null);
        context.setUndoStack(previous => [...previous, { type: 'delete', ids }]);
        context.setRedoStack([]);
    });
    useEffect(() => {
        const cleanup = [
            subscribeWindowEvent('keydown', event => { onKeyDown(event); }),
            subscribeWindowEvent('keydown', event => { onUndoRedo(event); }),
            subscribeAppSignal('gnosi:open-search', () => { onOpenSearch(); }),
            subscribeAppSignal('gnosi:open-tags', () => { onOpenTags(); }),
            subscribeAppSignal('gnosi:present', () => { onPresent(); }),
            subscribeAppSignal('gnosi:open-workspaces', () => { onWorkspaces(); }),
            subscribeAppEvent('gnosi:imported', detail => { onImported(detail); }),
            subscribeAppEvent('gnosi:open-pdf', (detail, event) => { onOpenPdf(detail, event); }),
            subscribeAppEvent('gnosi:relation-unlinked', detail => { onRelationUnlinked(detail); }),
            subscribeAppEvent('vault-open-folder', detail => { onFolder(detail); }),
            subscribeAppEvent('gnosi:records-deleted', detail => { onRecordsDeleted(detail); }),
        ];
        return () => { cleanup.forEach(unsubscribe => { unsubscribe(); }); };
    }, []);
}
