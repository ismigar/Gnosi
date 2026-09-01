import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListTree, X } from 'lucide-react';
import { useLocation } from 'react-router-dom';

import {
    announceFloatingPanelOpen,
    useExclusiveFloatingPanel,
} from '../../shared/hooks/useExclusiveFloatingPanel';
import { useFloatingActionDock } from '../../shared/hooks/useFloatingActionDock';
import { subscribeWindowEvent } from '../../shared/platform/browser-events';
import {
    defineStorageKey,
    readStorage,
    stringStorageCodec,
    writeStorage,
} from '../../shared/platform/browser-storage';
import {
    collectOutlineHeadings,
    isOutlineRoute,
    outlineHeadingText,
    type OutlineHeading,
    type OutlineNode,
} from './pageOutlineModel';

const CONTENT_SELECTOR = '#page-content-scroll';
const SCROLL_MARGIN = 16;
const ACTIVE_OFFSET = 120;
const STYLE_ID = 'page-outline-scroll-margin';
const OUTLINE_OPEN_KEY = defineStorageKey(
    'page_outline_open_v1',
    stringStorageCodec,
);

function sameHeadings(
    previous: readonly OutlineHeading[],
    next: readonly OutlineHeading[],
): boolean {
    return previous.length === next.length && previous.every((heading, index) => {
        const candidate = next[index];
        return candidate !== undefined
            && heading.id === candidate.id
            && heading.level === candidate.level
            && heading.text === candidate.text;
    });
}

export default function PageOutline() {
    const location = useLocation();
    const { t } = useTranslation();
    const [headings, setHeadings] = useState<OutlineHeading[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [isOpen, setIsOpen] = useState(
        () => readStorage(OUTLINE_OPEN_KEY) === '1',
    );
    const nodesRef = useRef<OutlineNode[]>([]);
    const navRef = useRef<HTMLElement | null>(null);
    const enabled = isOutlineRoute(location.pathname);

    const scan = useCallback(() => {
        const container = document.querySelector<HTMLElement>(CONTENT_SELECTOR);
        if (!enabled || !container) {
            setHeadings([]);
            nodesRef.current = [];
            return;
        }
        const snapshot = collectOutlineHeadings(container);
        nodesRef.current = snapshot.nodes;
        setHeadings((previous) => (
            sameHeadings(previous, snapshot.headings) ? previous : snapshot.headings
        ));
    }, [enabled]);

    useEffect(() => {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `${CONTENT_SELECTOR} h1, ${CONTENT_SELECTOR} h2, ${CONTENT_SELECTOR} h3 { scroll-margin-top: ${String(SCROLL_MARGIN)}px; }`;
        document.head.appendChild(style);
    }, []);

    useEffect(() => {
        const timers = [0, 300, 1000].map((delay) => setTimeout(scan, delay));
        let debounce: ReturnType<typeof setTimeout> | undefined;
        let observer: MutationObserver | null = null;
        let bodyObserver: MutationObserver | null = null;

        const attachContentObserver = (): boolean => {
            if (observer) return true;
            const container = document.querySelector<HTMLElement>(CONTENT_SELECTOR);
            if (!container) return false;
            observer = new MutationObserver(() => {
                clearTimeout(debounce);
                debounce = setTimeout(scan, 250);
            });
            observer.observe(container, { childList: true, subtree: true });
            return true;
        };

        if (!attachContentObserver()) {
            const pendingBodyObserver = new MutationObserver(() => {
                if (attachContentObserver()) {
                    pendingBodyObserver.disconnect();
                    bodyObserver = null;
                    scan();
                }
            });
            bodyObserver = pendingBodyObserver;
            bodyObserver.observe(document.body, { childList: true, subtree: true });
        }

        return () => {
            timers.forEach((timer) => {
                clearTimeout(timer);
            });
            clearTimeout(debounce);
            observer?.disconnect();
            bodyObserver?.disconnect();
        };
    }, [location.pathname, scan]);

    useEffect(() => {
        if (headings.length === 0) return undefined;
        let animationFrame = 0;
        const compute = (): void => {
            animationFrame = 0;
            const nodes = nodesRef.current;
            const first = nodes[0];
            if (!first) return;
            let current = first.id;
            for (const node of nodes) {
                if (node.element.getBoundingClientRect().top - ACTIVE_OFFSET <= 1) {
                    current = node.id;
                } else {
                    break;
                }
            }
            setActiveId(current);
        };
        const scheduleCompute = (): void => {
            if (!animationFrame) animationFrame = requestAnimationFrame(compute);
        };
        compute();
        const unsubscribeScroll = subscribeWindowEvent('scroll', scheduleCompute, true);
        const unsubscribeResize = subscribeWindowEvent('resize', scheduleCompute);
        return () => {
            if (animationFrame) cancelAnimationFrame(animationFrame);
            unsubscribeScroll();
            unsubscribeResize();
        };
    }, [headings]);

    useEffect(() => {
        if (!isOpen || !activeId || !navRef.current) return;
        navRef.current
            .querySelector<HTMLElement>(`[data-target="${activeId}"]`)
            ?.scrollIntoView({ block: 'nearest' });
    }, [activeId, isOpen]);

    const setOpen = useCallback((value: boolean) => {
        setIsOpen(value);
        writeStorage(OUTLINE_OPEN_KEY, value ? '1' : '0');
    }, []);
    useExclusiveFloatingPanel('outline', isOpen, setOpen);

    useEffect(() => {
        if (!isOpen) return undefined;
        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') setOpen(false);
        };
        return subscribeWindowEvent('keydown', handleKeyDown);
    }, [isOpen, setOpen]);

    const goTo = (id: string): void => {
        const entry = nodesRef.current.find(
            (node) => node.id === id && node.element.isConnected,
        );
        let element = entry?.element ?? null;
        if (!element || !element.isConnected) {
            const item = headings.find((heading) => heading.id === id);
            const container = document.querySelector<HTMLElement>(CONTENT_SELECTOR);
            if (item && container) {
                element = Array.from(
                    container.querySelectorAll<HTMLElement>('h1, h2, h3'),
                ).find((heading) => (
                    heading.isConnected && outlineHeadingText(heading) === item.text
                )) ?? null;
            }
        }
        if (element?.isConnected) element.scrollIntoView({ block: 'start' });
        setActiveId(id);
    };

    const [, setIsDockOpen] = useFloatingActionDock();
    if (!enabled || headings.length < 2) return null;
    const minLevel = Math.min(...headings.map((heading) => heading.level));

    if (!isOpen) {
        return (
            <button
                type="button"
                data-testid="page-outline-toggle"
                onClick={() => {
                    announceFloatingPanelOpen('outline');
                    setIsDockOpen(false);
                    setOpen(true);
                }}
                title={t('outline.open', 'Page outline')}
                aria-label={t('outline.open', 'Page outline')}
                className="gnosi-floating-action gnosi-floating-action--outline flex items-center justify-center rounded-full border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:text-[var(--gnosi-blue)] shadow-sm cursor-pointer transition-colors"
            >
                <ListTree size={18} />
            </button>
        );
    }

    return (
        <div
            data-testid="page-outline-panel"
            className="gnosi-floating-panel gnosi-floating-panel--outline w-64 flex flex-col rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-xl overflow-hidden"
        >
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-primary)]">
                <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                    <ListTree size={15} />
                    <span className="text-[11px] font-bold uppercase tracking-tight">
                        {t('outline.title', 'On this page')}
                    </span>
                </div>
                <button
                    type="button"
                    onClick={() => {
                        setOpen(false);
                    }}
                    title={t('common.close', 'Close')}
                    aria-label={t('common.close', 'Close')}
                    className="flex items-center justify-center w-6 h-6 rounded-md border-none bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors"
                >
                    <X size={15} />
                </button>
            </div>
            <nav ref={navRef} className="flex-1 overflow-y-auto py-1.5">
                {headings.map((heading) => {
                    const isActive = heading.id === activeId;
                    return (
                        <button
                            key={heading.id}
                            type="button"
                            data-target={heading.id}
                            onClick={() => {
                                goTo(heading.id);
                            }}
                            style={{
                                paddingLeft: `${String(10 + (heading.level - minLevel) * 14)}px`,
                            }}
                            className={`block w-full text-left pr-3 py-1.5 text-[13px] leading-snug truncate border-l-2 bg-transparent cursor-pointer transition-colors ${
                                isActive
                                    ? 'border-[var(--gnosi-blue)] text-[var(--gnosi-blue)] font-semibold'
                                    : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                            }`}
                            title={heading.text}
                        >
                            {heading.text}
                        </button>
                    );
                })}
            </nav>
        </div>
    );
}
