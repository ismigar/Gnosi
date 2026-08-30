import {
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
    type MouseEvent,
} from 'react';

import { logError } from '../../../shared/notifications/notifyError';
import { WikilinkHoverPreview } from '../../../shared/editor/WikilinkHoverPreview';
import { VaultEditorContext, type VaultEditorCallback } from '../../../shared/editor/VaultEditorContext';
import { renderInlineCitation, type CslItemMap } from '../../../shared/citations/cslEngine';
import {
    resolveCitationKey,
    type ResolvedCitation,
} from './cite-inline/citationResolver';


interface CiteInlineProps {
    readonly citationKey: string;
}


type OpenMode = 'newTab' | 'parallel' | 'sameTab';


const HOVER_OPEN_DELAY = 450;
const HOVER_CLOSE_DELAY = 180;


function isVaultEditorCallback(value: unknown): value is VaultEditorCallback {
    return typeof value === 'function';
}


function contextCallback(value: unknown): VaultEditorCallback | null {
    return isVaultEditorCallback(value) ? value : null;
}


function isAborted(controller: AbortController): boolean {
    return controller.signal.aborted;
}


function ResolvedCiteInline({ citationKey }: CiteInlineProps) {
    const context = useContext(VaultEditorContext);
    const onOpenInCurrentTab = contextCallback(
        context.onOpenInCurrentTab ?? context.onOpenPage,
    );
    const onOpenInNewTab = contextCallback(
        context.onOpenInNewTab ?? context.onOpenPage,
    );
    const onOpenParallel = contextCallback(context.onOpenParallel);
    const cslStyle = typeof context.cslStyle === 'string' ? context.cslStyle : 'apa';
    const cslLocale = typeof context.cslLocale === 'string' ? context.cslLocale : 'en-US';

    const spanRef = useRef<HTMLSpanElement>(null);
    const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [resolved, setResolved] = useState<ResolvedCitation | null | undefined>(undefined);
    const [formatted, setFormatted] = useState<string | null>(null);
    const [hoverActive, setHoverActive] = useState(false);
    const [anchorRectangle, setAnchorRectangle] = useState<DOMRect | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        void resolveCitationKey(citationKey, controller.signal)
            .then(async (value) => {
                if (isAborted(controller)) return;
                setResolved(value);
                if (!value?.cslItem) return;
                const items: CslItemMap = { [value.cslItem.id]: value.cslItem };
                const html = await renderInlineCitation(
                    value.cslItem.id,
                    items,
                    cslStyle,
                    cslLocale,
                );
                if (!isAborted(controller)) setFormatted(html);
            })
            .catch((error: unknown) => {
                if (!isAborted(controller)) {
                    logError('cite-inline.resolve', error);
                    setResolved(null);
                }
            });
        return () => {
            controller.abort();
        };
    }, [citationKey, cslLocale, cslStyle]);

    const cancelTimers = useCallback((): void => {
        if (openTimerRef.current !== null) {
            clearTimeout(openTimerRef.current);
            openTimerRef.current = null;
        }
        if (closeTimerRef.current !== null) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
    }, []);
    useEffect(() => () => {
        cancelTimers();
    }, [cancelTimers]);

    const resolvedId = resolved?.id;
    const callOpen = useCallback((mode: OpenMode): void => {
        if (!resolvedId) return;
        if (mode === 'parallel' && onOpenParallel) {
            onOpenParallel(resolvedId);
        } else if (mode === 'newTab' && onOpenInNewTab) {
            onOpenInNewTab(resolvedId);
        } else if (onOpenInCurrentTab) {
            onOpenInCurrentTab(resolvedId);
        } else if (onOpenInNewTab) {
            onOpenInNewTab(resolvedId);
        } else {
            onOpenParallel?.(resolvedId);
        }
    }, [onOpenInCurrentTab, onOpenInNewTab, onOpenParallel, resolvedId]);
    const handleClick = (event: MouseEvent<HTMLSpanElement>): void => {
        if (event.button === 2) return;
        event.preventDefault();
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation();
        cancelTimers();
        setHoverActive(false);
        setAnchorRectangle(null);
        if (!resolvedId) return;
        if (event.button === 1 || event.metaKey || event.ctrlKey) callOpen('newTab');
        else if (event.shiftKey) callOpen('parallel');
        else callOpen('sameTab');
    };
    const handleMouseEnter = (): void => {
        cancelTimers();
        if (!resolvedId) return;
        const rectangle = spanRef.current?.getBoundingClientRect() ?? null;
        openTimerRef.current = setTimeout(() => {
            setAnchorRectangle(rectangle);
            setHoverActive(true);
        }, HOVER_OPEN_DELAY);
    };
    const closeHoverLater = (): void => {
        cancelTimers();
        closeTimerRef.current = setTimeout(() => {
            setHoverActive(false);
            setAnchorRectangle(null);
        }, HOVER_CLOSE_DELAY);
    };
    const stopBubble = (event: MouseEvent<HTMLSpanElement>): void => {
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation();
    };

    const isLoading = resolved === undefined;
    const isMissing = resolved === null;
    const className = [
        'cite-inline cursor-pointer rounded-sm px-1 transition-all',
        formatted ? 'text-[0.95em]' : 'font-mono text-[0.9em]',
        isLoading
            ? 'bg-[var(--bg-secondary)]/50 text-[var(--text-tertiary)]'
            : isMissing
                ? 'bg-red-50 text-red-500 line-through dark:bg-red-900/20'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400 dark:hover:bg-emerald-900/30',
    ].join(' ');
    const title = isMissing
        ? `Citació no trobada: @${citationKey}`
        : isLoading
            ? `Resolent @${citationKey}…`
            : `@${citationKey} — Obre la referència`;

    return (
        <>
            <span
                className={className}
                contentEditable={false}
                data-citation-key={citationKey}
                onAuxClick={handleClick}
                onClick={handleClick}
                onMouseDown={stopBubble}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={closeHoverLater}
                onMouseUp={stopBubble}
                ref={spanRef}
                style={{ pointerEvents: 'auto' }}
                title={title}
            >
                {formatted
                    ? <span dangerouslySetInnerHTML={{ __html: formatted }} />
                    : `@${citationKey}`}
            </span>
            {hoverActive && resolvedId ? (
                <WikilinkHoverPreview
                    anchorRect={anchorRectangle}
                    onMouseEnter={cancelTimers}
                    onMouseLeave={closeHoverLater}
                    pageId={resolvedId}
                />
            ) : null}
        </>
    );
}


export function CiteInline({ citationKey }: CiteInlineProps) {
    return <ResolvedCiteInline citationKey={citationKey} key={citationKey} />;
}


export default CiteInline;
