import type { KeyboardEvent } from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { fetchVaultPage, fetchVaultPagePreview, type VaultPagePreview } from '../api/vaults';
import { IconRenderer } from '../ui/previews/IconRenderer';
import { VaultMarkdown } from './VaultMarkdown';
import {
    adaptiveHoverPreviewStyle,
    isHoverPreviewScrollable,
    positionHoverPreview,
    scrollHoverPreviewByKey,
} from '../ui/previews/hoverPreviewLayout';
import {
    pickHoverWebUrl,
    normalizeHoverPreview,
    readHoverPreviewCache,
    visibleHoverProperties,
    writeHoverPreviewCache,
    type HoverMetadata,
} from './page-hover-card/pageHoverCardModel';


const PADDING = 8;
const CARD_STYLE = adaptiveHoverPreviewStyle({
    margin: PADDING,
    maxHeight: 520,
    maxWidth: 520,
    minWidth: 300,
});


export interface PageHoverCardProps {
    readonly anchorRect: DOMRect | null;
    readonly onClose?: () => void;
    readonly onMouseEnter?: () => void;
    readonly onMouseLeave?: () => void;
    readonly onOpenPage?: (pageId: string) => void;
    readonly pageId: string;
    readonly viaKeyboard?: boolean;
}


export function PageHoverCard(props: PageHoverCardProps) {
    if (!props.anchorRect) return null;
    return <PageHoverCardContent key={props.pageId} {...props} />;
}


function PageHoverCardContent({
    anchorRect,
    onClose,
    onMouseEnter,
    onMouseLeave,
    onOpenPage,
    pageId,
    viaKeyboard = false,
}: PageHoverCardProps) {
    const { t } = useTranslation();
    const cached = readHoverPreviewCache(pageId);
    const [data, setData] = useState<VaultPagePreview | null>(cached);
    const [loading, setLoading] = useState(!cached);
    const [error, setError] = useState(false);
    const [position, setPosition] = useState<ReturnType<typeof positionHoverPreview> | null>(null);
    const [metadata, setMetadata] = useState<HoverMetadata | null>(null);
    const cardRef = useRef<HTMLDivElement | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        if (cached) return undefined;
        let cancelled = false;
        void fetchVaultPagePreview(pageId, { full: true })
            .then((preview) => {
                if (cancelled) return;
                writeHoverPreviewCache(pageId, preview);
                setData(preview);
                setLoading(false);
            })
            .catch(() => {
                if (cancelled) return;
                setError(true);
                setLoading(false);
            });
        return () => { cancelled = true; };
    }, [cached, pageId]);

    useEffect(() => {
        if (!data || normalizeHoverPreview(data).body.trim()) return undefined;
        let cancelled = false;
        void fetchVaultPage(pageId)
            .then((page) => {
                if (!cancelled) setMetadata(page.metadata);
            })
            .catch(() => {
                if (!cancelled) setMetadata({});
            });
        return () => { cancelled = true; };
    }, [data, pageId]);

    useLayoutEffect(() => {
        let cancelled = false;
        queueMicrotask(() => {
            if (cancelled || !anchorRect || !cardRef.current) return;
            setPosition(positionHoverPreview(
                anchorRect,
                cardRef.current.getBoundingClientRect(),
                { height: window.innerHeight, width: window.innerWidth },
                PADDING,
            ));
        });
        return () => { cancelled = true; };
    }, [anchorRect, data, error, loading, metadata]);

    useEffect(() => {
        if (viaKeyboard && position && scrollRef.current) {
            scrollRef.current.focus({ preventScroll: true });
        }
    }, [position, viaKeyboard]);

    useEffect(() => {
        const card = cardRef.current;
        const element = scrollRef.current;
        if (
            !viaKeyboard
            && card?.matches(':hover')
            && element
            && !element.contains(document.activeElement)
            && isHoverPreviewScrollable(element)
        ) {
            previousFocusRef.current = document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
            element.focus({ preventScroll: true });
        }
    }, [data, loading, metadata, position, viaKeyboard]);

    const properties = useMemo(() => visibleHoverProperties(metadata), [metadata]);
    const webUrl = useMemo(() => pickHoverWebUrl(metadata), [metadata]);
    const preview = useMemo(() => normalizeHoverPreview(data), [data]);
    const title = preview.title || t('common.untitled', 'Untitled');
    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        if (scrollHoverPreviewByKey(scrollRef.current, event.key)) {
            event.preventDefault();
            event.stopPropagation();
        } else if (
            event.key === 'Escape'
            || event.key === ' '
            || event.key === 'Spacebar'
        ) {
            event.preventDefault();
            event.stopPropagation();
            onClose?.();
        }
    };
    const handleMouseEnter = (): void => {
        onMouseEnter?.();
        const element = scrollRef.current;
        if (
            element
            && !element.contains(document.activeElement)
            && isHoverPreviewScrollable(element)
        ) {
            previousFocusRef.current = document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
            element.focus({ preventScroll: true });
        }
    };
    const handleMouseLeave = (): void => {
        onMouseLeave?.();
        const element = scrollRef.current;
        if (!element?.contains(document.activeElement)) return;
        const previous = previousFocusRef.current;
        previousFocusRef.current = null;
        if (previous && previous !== document.body && previous.isConnected) {
            previous.focus({ preventScroll: true });
        } else element.blur();
    };

    const card = <div
        aria-label={title}
        className="fixed z-[var(--z-popover)] flex animate-in flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl duration-150 fade-in zoom-in-95 dark:border-slate-700/60 dark:bg-slate-900"
        data-testid="page-hover-card"
        onKeyDown={handleKeyDown}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        ref={cardRef}
        role="dialog"
        style={position
            ? { ...CARD_STYLE, left: position.left, opacity: 1, pointerEvents: 'auto', top: position.top }
            : { ...CARD_STYLE, left: -9999, opacity: 0, pointerEvents: 'none', top: -9999 }}
    >
        {!loading && !error && preview.cover ? <div
            className="h-20 shrink-0 bg-cover bg-center"
            style={{ backgroundImage: `url("${preview.cover}")` }}
        /> : null}
        {!loading && !error && data ? <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 px-4 pb-2 pt-3 dark:border-slate-800">
            {preview.icon
                ? <IconRenderer className="flex-shrink-0" icon={preview.icon} size={18} />
                : <FileText className="flex-shrink-0 text-slate-400" size={15} />}
            <h4 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                {title}
            </h4>
        </div> : null}
        <div
            className="custom-scrollbar min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-3 outline-none"
            ref={scrollRef}
            tabIndex={-1}
        >
            {loading ? <div className="flex items-center gap-2 text-sm text-slate-500">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-[var(--gnosi-primary)]" />
                <span>{t('common.loading', 'Loading...')}</span>
            </div> : null}
            {error ? <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                <FileText size={14} />
                <span>{t('wikilink.preview_error', 'Could not load the page')}</span>
            </div> : null}
            {!loading && !error && data ? preview.body.trim() ? <div className="feed-md break-words text-sm leading-relaxed text-[var(--text-secondary)] [overflow-wrap:anywhere] [&_*]:max-w-full [&_code]:overflow-x-hidden [&_code]:whitespace-pre-wrap [&_table]:table [&_table]:w-full [&_table]:table-fixed [&_td]:break-words [&_th]:break-words">
                <VaultMarkdown
                    imageTitle={title}
                    md={preview.body}
                    onActivate={() => { onOpenPage?.(pageId); }}
                />
            </div> : <div className="space-y-2 text-xs">
                {metadata === null ? <span className="italic text-slate-400">
                    {t('common.loading', 'Loading...')}
                </span> : null}
                {properties.length > 0 ? <dl className="space-y-1.5">
                    {properties.map(([key, value]) => <div className="flex gap-2" key={key}>
                        <dt className="min-w-[84px] max-w-[40%] shrink-0 truncate text-slate-400 dark:text-slate-500">{key}</dt>
                        <dd className="flex-1 break-words text-slate-700 [overflow-wrap:anywhere] dark:text-slate-300">{value}</dd>
                    </div>)}
                </dl> : null}
                {metadata !== null && properties.length === 0 && !webUrl ? <p className="italic text-slate-400">
                    {t('hovercard.no_content', 'This record has no written content.')}
                </p> : null}
                {webUrl ? <a
                    className="inline-flex items-center gap-1 pt-1 text-[var(--gnosi-primary)] hover:underline"
                    href={webUrl}
                    onClick={(event) => { event.stopPropagation(); }}
                    rel="noopener noreferrer"
                    target="_blank"
                ><ExternalLink size={12} />{t('hovercard.view_on_web', 'View the original on the web')}</a> : null}
            </div> : null}
        </div>
    </div>;
    return createPortal(card, document.body);
}


export default PageHoverCard;
