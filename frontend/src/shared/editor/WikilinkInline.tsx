import {
    Fragment,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
    type MouseEvent,
    type ReactNode,
} from 'react';
import {
    WikilinkHoverPreview,
    type WikilinkHoverAnchorRect,
} from './WikilinkHoverPreview';
import { WikilinkContextMenu } from './WikilinkContextMenu';
import { VaultEditorContext } from './VaultEditorContext';
import type { ContextMenuPosition } from './wikilink-context-menu/wikilinkContextMenuModel';
import {
    isUuidTarget,
    resolveWikilinkTarget,
    resolveWikilinkTargetLocal,
    type WikilinkTitleIndex,
} from './wikilinkInlineModel';


const HOVER_OPEN_DELAY = 450;
const HOVER_CLOSE_DELAY = 180;

type WikilinkOpenMode = 'newTab' | 'parallel' | 'sameTab';
type WikilinkOpenHandler = (pageId: string) => unknown;


export interface WikilinkInlineProps {
    readonly idToTitle?: WikilinkTitleIndex;
    readonly onOpenInCurrentTab?: WikilinkOpenHandler | null;
    readonly onOpenInNewTab?: WikilinkOpenHandler | null;
    readonly onOpenParallel?: WikilinkOpenHandler | null;
    readonly target?: string;
    readonly title: ReactNode;
}


function stopImmediatePropagation(event: MouseEvent<HTMLSpanElement>): void {
    const legacyEvent = event as MouseEvent<HTMLSpanElement> & {
        readonly stopImmediatePropagation?: unknown;
    };
    const stopImmediate = legacyEvent.stopImmediatePropagation;
    if (typeof stopImmediate === 'function') {
        Reflect.apply(stopImmediate, event, []);
    }
}

/**
 * Renderer for an inline wikilink with:
 *  - Click → open in current tab (replaces)
 *  - Cmd/Ctrl+Click → open in new tab
 *  - Shift+Click → open in parallel pane
 *  - Hover → preview popup with excerpt (Wikipedia style)
 *  - Right-click → context menu with the 3 options
 *
 *  Fallback: if onOpenInCurrentTab/onOpenInNewTab is not passed, reuses
 *  onOpenParallel to maintain compatibility with older instances
 *  (PageViewModal, etc.) that only pass onOpenParallel.
 */
export const WikilinkInline = ({
    title,
    target,
    idToTitle: idToTitleProp,
    onOpenInCurrentTab: onOpenInCurrentTabProp,
    onOpenInNewTab: onOpenInNewTabProp,
    onOpenParallel: onOpenParallelProp,
}: WikilinkInlineProps) => {
    // CRITICAL: the BlockNote schema freezes when the editor is created (it is not
    // recreated every time globalIndex changes). If we read `idToTitle` from
    // contextValue via closure inside the spec, it goes stale (size 0). That's why
    // we read from the context LIVE (useContext) and only fall back to props if the
    // context isn't available (e.g. isolated tests).
    const context = useContext(VaultEditorContext);
    const idToTitle = idToTitleProp && Object.keys(idToTitleProp).length > 0
        ? idToTitleProp
        : context.idToTitle;
    const onOpenInCurrentTab = onOpenInCurrentTabProp
        ?? context.onOpenInCurrentTab
        ?? null;
    const onOpenInNewTab = onOpenInNewTabProp
        ?? context.onOpenInNewTab
        ?? context.onOpenPage
        ?? null;
    const onOpenParallel = onOpenParallelProp ?? context.onOpenParallel ?? null;

    const spanRef = useRef<HTMLSpanElement | null>(null);
    const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [hoverActive, setHoverActive] = useState(false);
    const [anchorRect, setAnchorRect] = useState<WikilinkHoverAnchorRect | null>(null);
    const [menuPos, setMenuPos] = useState<ContextMenuPosition | null>(null);

    // Local synchronous resolution (for the hover preview, which can't be async).
    const resolvedId = resolveWikilinkTargetLocal(target, idToTitle);

    const callOpen = useCallback(async (mode: WikilinkOpenMode): Promise<void> => {
        if (!target) return;
        // For clicks/menu: if the local resolution returned a title
        // (idToTitle doesn't recognize it) we do a quick fallback to the backend before
        // calling the handler. This way the wikilink isn't "dead" when globalIndex
        // is empty or stale (for example right after a move).
        let id = resolvedId || target;
        if (!isUuidTarget(id)) {
            const backendId = await resolveWikilinkTarget(target, idToTitle);
            if (!backendId) return;
            id = backendId;
        }
        if (mode === 'parallel' && onOpenParallel) {
            onOpenParallel(id);
            return;
        }
        if (mode === 'newTab' && onOpenInNewTab) {
            onOpenInNewTab(id);
            return;
        }
        if (mode === 'sameTab' && onOpenInCurrentTab) {
            onOpenInCurrentTab(id);
            return;
        }
        // Fallbacks: if the embedder doesn't provide the specific handler,
        // we fall back to the available ones so as not to leave a "dead" click.
        if (onOpenInCurrentTab) onOpenInCurrentTab(id);
        else if (onOpenInNewTab) onOpenInNewTab(id);
        else if (onOpenParallel) onOpenParallel(id);
    }, [resolvedId, target, idToTitle, onOpenInCurrentTab, onOpenInNewTab, onOpenParallel]);

    // Cancel·la timers pendents en desmuntatge.
    useEffect(() => () => {
        if (openTimerRef.current) clearTimeout(openTimerRef.current);
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    }, []);

    const cancelTimers = (): void => {
        if (openTimerRef.current) {
            clearTimeout(openTimerRef.current);
            openTimerRef.current = null;
        }
        if (closeTimerRef.current) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
    };

    const handleMouseEnter = (): void => {
        cancelTimers();
        if (menuPos) return; // menu open: don't show hover
        const rect = spanRef.current?.getBoundingClientRect() || null;
        openTimerRef.current = setTimeout(() => {
            setAnchorRect(rect);
            setHoverActive(true);
        }, HOVER_OPEN_DELAY);
    };

    const handleMouseLeave = (): void => {
        cancelTimers();
        closeTimerRef.current = setTimeout(() => {
            setHoverActive(false);
            setAnchorRect(null);
        }, HOVER_CLOSE_DELAY);
    };

    // When the cursor enters the popup, keeps it open.
    const handlePopupEnter = (): void => {
        cancelTimers();
    };
    const handlePopupLeave = (): void => {
        cancelTimers();
        closeTimerRef.current = setTimeout(() => {
            setHoverActive(false);
            setAnchorRect(null);
        }, HOVER_CLOSE_DELAY);
    };

    const handleClick = (event: MouseEvent<HTMLSpanElement>): void => {
        // Ignore the right button: `onAuxClick` also fires on right-click
        // and, without filtering, it would navigate to "sameTab", closing the context menu.
        // 0 = esquerre, 1 = mig, 2 = dret.
        if (event.button === 2) return;
        event.preventDefault();
        event.stopPropagation();
        stopImmediatePropagation(event);
        // Closes hover/menu before navigating
        cancelTimers();
        setHoverActive(false);
        setAnchorRect(null);
        setMenuPos(null);
        if (!target) return;
        // Middle-click → new tab (like browsers do).
        if (event.button === 1) {
            void callOpen('newTab');
            return;
        }
        if (event.shiftKey) {
            void callOpen('parallel');
        } else if (event.metaKey || event.ctrlKey) {
            void callOpen('newTab');
        } else {
            void callOpen('sameTab');
        }
    };

    const stopBubble = (event: MouseEvent<HTMLSpanElement>): void => {
        event.stopPropagation();
        stopImmediatePropagation(event);
    };

    const handleContextMenu = (event: MouseEvent<HTMLSpanElement>): void => {
        event.preventDefault();
        event.stopPropagation();
        cancelTimers();
        setHoverActive(false);
        setAnchorRect(null);
        setMenuPos({ x: event.clientX, y: event.clientY });
    };

    const closeMenu = (): void => {
        setMenuPos(null);
    };

    return (
        <Fragment>
            <span
                ref={spanRef}
                className="wikilink-inline text-[var(--gnosi-primary)] hover:text-[var(--gnosi-primary-hover)] underline decoration-[var(--gnosi-primary)]/30 underline-offset-4 cursor-pointer transition-all font-semibold"
                data-wikilink-target={target}
                onMouseDown={stopBubble}
                onMouseUp={stopBubble}
                onClick={handleClick}
                onAuxClick={handleClick}
                onContextMenu={handleContextMenu}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                style={{ pointerEvents: 'auto' }}
            >
                {title}
            </span>
            {hoverActive && resolvedId && !menuPos && (
                <WikilinkHoverPreview
                    pageId={resolvedId}
                    anchorRect={anchorRect}
                    onMouseEnter={handlePopupEnter}
                    onMouseLeave={handlePopupLeave}
                />
            )}
            <WikilinkContextMenu
                isOpen={Boolean(menuPos)}
                position={menuPos}
                onClose={closeMenu}
                onOpenSameTab={() => {
                    void callOpen('sameTab');
                }}
                onOpenNewTab={() => {
                    void callOpen('newTab');
                }}
                onOpenParallel={() => {
                    void callOpen('parallel');
                }}
            />
        </Fragment>
    );
};

export default WikilinkInline;
