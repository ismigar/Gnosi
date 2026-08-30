import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { subscribeWindowEvent } from '../../../shared/platform/browser-events';
import { emitAppEvent } from './events';
import { decodeNavApi } from './decode';
import type { NavApi } from './types';
import type { EmbedInputs } from './inputs';
import type { EmbedDerived } from './useEmbedDerived';
import type { EmbedRecordActions } from './useEmbedRecordActions';
export function useEmbedNavigation({ ctx, block, handleCreate, handleOpenConfig, tableId, viewType, toggleFeedDensity, setShowSearch }: EmbedInputs & EmbedDerived & EmbedRecordActions) {
    const { onOpenPageViewModal } = ctx;
    const tableNavApiRef = useRef<NavApi | null>(null);
    // Outer container of the embed. When the view is NOT table/list (feed,
    // gallery, kanban, timeline…) there are no navigable cells: we make the
    // whole shell focusable (tabIndex=-1) and act like a widget —
    // "entering it" with ↓ gives it a visible focus, and you exit with ↑/↓/Esc.
    const embedContainerRef = useRef<HTMLDivElement | null>(null);
    const isInEditor = typeof ctx.exitEmbedToEditor === 'function';

    // Focuses the SHELL of the embed (widget). Serves as an «entry point» for views
    // without navigable cells and as the Esc target from records (gallery).
    const focusShell = useCallback(() => {
        const el = embedContainerRef.current;
        if (!el) return false;
        try { el.focus({ preventScroll: false }); el.scrollIntoView({ block: 'nearest' }); } catch { /* noop */ }
        return true;
    }, []);

    // Keyboard handling when the SHELL has focus (not a child: card, search, cell…).
    // ↑/↓ return the cursor to the editor (adjacent block or upper zone); Esc exits.
    // Space/Enter "goes down" into it: enters the view's records (first cell or
    // card) if it has navigable ones (table/list/gallery). Feed/kanban/timeline
    // don't register the API → they do nothing and the key is left to pass through.
    const handleShellKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
        if (e.target !== embedContainerRef.current) return;
        if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            const dir = e.key === 'ArrowUp' ? 'up' : (e.key === 'ArrowDown' ? 'down' : 'escape');
            ctx.exitEmbedToEditor?.(block?.id, dir);
            return;
        }
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
            const r = tableNavApiRef.current?.focusFirstCell?.();
            if (r !== undefined && r !== false) {
                e.preventDefault();
                e.stopPropagation();
            }
        }
    }, [ctx, block?.id]);
    useEffect(() => {
        const handleShortcut = (event: KeyboardEvent) => {
            const target = event.target;
            const embed = embedContainerRef.current;
            const isInput = (target instanceof HTMLElement && target.isContentEditable)
                || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target instanceof Element ? target.tagName : '');

            if (isInput) return;
            if (isInEditor && !(document.activeElement && embed?.contains(document.activeElement))) return;
            if (!event.ctrlKey || event.metaKey || event.altKey) return;

            const key = event.key ? event.key.toLowerCase() : '';
            const code = event.code || '';

            if (key === '/' || code === 'Slash') {
                if (!event.shiftKey) {
                    event.preventDefault();
                    setShowSearch(true);
                } else {
                    event.preventDefault();
                    emitAppEvent('gnosi:open-view-tools');
                }
            } else if (key === 'f' || code === 'KeyF') {
                if (onOpenPageViewModal && tableId) {
                    event.preventDefault();
                    handleOpenConfig();
                }
            } else if (key === 'n' || code === 'KeyN') {
                if (tableId) {
                    event.preventDefault();
                    void handleCreate();
                }
            } else if (key === 'd' || code === 'KeyD') {
                if (viewType === 'feed') {
                    event.preventDefault();
                    toggleFeedDensity();
                }
            } else if (key === 'l' || code === 'KeyL') {
                event.preventDefault();
                emitAppEvent('gnosi:locate-active-page');
            } else if (key === '?') {
                event.preventDefault();
                emitAppEvent('gnosi:open-view-tools');
            }
        };
        return subscribeWindowEvent('keydown', handleShortcut);
    }, [
        handleCreate,
        handleOpenConfig,
        onOpenPageViewModal,
        tableId,
        toggleFeedDensity,
        viewType, isInEditor, setShowSearch,
    ]);
    useEffect(() => {
        if (!ctx.registerEmbedNav || !block?.id) return undefined;
        // Entry with ↓ from the editor:
        //  - Table/list → first/last CELL (VaultTable registers it).
        //  - Rest of the views (gallery, feed, kanban, timeline) → the SHELL of the
        //    the embed (widget), so the user can see it's there and can leave it
        //    with ↑/↓/Esc or drop down into the records with Space/Enter (gallery). Before,
        //    for non-tables, we returned `false` and the cursor fell into a void block
        //    without a visible caret or exit.
        const isCellNav = viewType === 'table' || viewType === 'list';
        ctx.registerEmbedNav(block.id, {
            focusFirstCell: () => {
                if (!isCellNav) return focusShell();
                const r = tableNavApiRef.current?.focusFirstCell?.();
                return (r !== undefined && r !== false) ? true : focusShell();
            },
            focusLastCell: () => {
                if (!isCellNav) return focusShell();
                const r = tableNavApiRef.current?.focusLastCell?.();
                return (r !== undefined && r !== false) ? true : focusShell();
            },
        });
        return () => { ctx.registerEmbedNav?.(block.id || '', null); };
    }, [ctx, block?.id, viewType, focusShell]);
    const registerNavApi = useCallback((api: unknown) => { tableNavApiRef.current = decodeNavApi(api); }, []);
    return { embedContainerRef, isInEditor, focusShell, handleShellKeyDown, registerNavApi };
}
export type EmbedNavigation = ReturnType<typeof useEmbedNavigation>;
