import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ListTree, X } from 'lucide-react';

// Main scroll container defined in App.jsx. We look for headings inside it.
const CONTENT_SELECTOR = '#page-content-scroll';
const STORAGE_KEY = 'page_outline_open_v1';
// Top margin so the heading doesn't end up stuck at the top when jumping to it.
const SCROLL_MARGIN = 16;
// Offset (px from the top of the viewport) to decide which section is active.
const ACTIVE_OFFSET = 120;

// The heading navigator only makes sense on long-content pages: Vault
// (notes/documents), Mail and News Reader. On the rest (Control Center,
// Settings, Graph, etc.) it isn't shown.
const ALLOWED_PREFIXES = ['/vault', '/mail', '/reader'];
const isOutlineRoute = (path) =>
    ALLOWED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));

// Stable internal id; the `i` prefix already guarantees its uniqueness.
const slugify = (text, i) =>
    `pout-${i}-${text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)}`;

// Checks whether the element has an ancestor with effective scroll inside the container,
// that is, where jumping to it would make sense. If not, the heading lives in a
// fixed area (e.g. column headers in Reader/Mail) and the navigator adds nothing:
// `scrollIntoView` doesn't move because the element is already fully visible.
const hasScrollableAncestor = (el, container) => {
    const stop = container ? container.parentElement : null;
    let p = el.parentElement;
    while (p && p !== stop) {
        const s = getComputedStyle(p);
        if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && p.scrollHeight > p.clientHeight + 1) return true;
        p = p.parentElement;
    }
    return false;
};

// "Clean" text of the title: takes the heading's own text nodes, which exclude
// action chips rendered as children (e.g. a "Details →" inside the h3).
// If the title is wrapped and there's no direct text, it falls back to the full text without a/button.
const headingText = (el) => {
    const direct = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent)
        .join('')
        .trim();
    if (direct) return direct;
    const clone = el.cloneNode(true);
    clone.querySelectorAll('a, button').forEach((n) => n.remove());
    return (clone.textContent || '').trim();
};

export default function PageOutline() {
    const location = useLocation();
    const { t } = useTranslation();
    const [headings, setHeadings] = useState([]);
    const [activeId, setActiveId] = useState(null);
    const [isOpen, setIsOpen] = useState(() => {
        try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
    });
    const nodesRef = useRef([]);
    const navRef = useRef(null);

    // Only active in Vault, Mail and Reader.
    const enabled = isOutlineRoute(location.pathname);

    // Scans the visible content and collects real h1-h3 (not the ones from link-cards).
    const scan = useCallback(() => {
        const container = document.querySelector(CONTENT_SELECTOR);
        if (!enabled || !container) { setHeadings([]); nodesRef.current = []; return; }
        const collected = [];
        const nodes = [];
        container.querySelectorAll('h1, h2, h3').forEach((el, i) => {
            if (el.closest('a, button')) return;     // card/button titles are not sections
            if (el.offsetParent === null) return;     // amagat (modals tancades, display:none)
            if (!hasScrollableAncestor(el, container)) return; // lives in a fixed area: jumping to it does nothing
            const text = headingText(el);
            if (!text) return;
            // SYNTHETIC id: we do NOT write it to the DOM nor touch `style` on it. The
            // headings live inside the ProseMirror editor, which manages its
            // own DOM and REVERTS any `id`/`style` added from outside;
            // that reversion used to trigger the MutationObserver below → re-scan
            // → rewrite → infinite loop (headings and page flickering).
            // We keep the live reference in `nodesRef` and use the synthetic id
            // only in state. The `scroll-margin-top` is set via CSS (see
            // the style-injection effect).
            const id = slugify(text, i);
            collected.push({ id, text, level: Number(el.tagName[1]) });
            nodes.push({ id, el, text });
        });
        nodesRef.current = nodes;
        // Avoids useless re-renders (and the scroll-spy effect re-subscribing
        // in a loop) when the set of headings hasn't actually changed.
        setHeadings((prev) => (
            prev.length === collected.length
            && prev.every((h, i) => h.id === collected[i].id && h.level === collected[i].level && h.text === collected[i].text)
                ? prev
                : collected
        ));
    }, [enabled]);

    // `scroll-margin-top` for the content headings via global CSS (just
    // once), instead of writing `el.style` on every heading —which touches the DOM
    // of ProseMirror and causes the reversion/re-scan loop.
    useEffect(() => {
        const STYLE_ID = 'page-outline-scroll-margin';
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `${CONTENT_SELECTOR} h1, ${CONTENT_SELECTOR} h2, ${CONTENT_SELECTOR} h3 { scroll-margin-top: ${SCROLL_MARGIN}px; }`;
        document.head.appendChild(style);
    }, []);

    // Re-scans on route change (with retries for content that loads asynchronously)
    // and when the content DOM changes (dynamic dashboards).
    useEffect(() => {
        const timers = [0, 300, 1000].map((d) => setTimeout(scan, d));

        const container = document.querySelector(CONTENT_SELECTOR);
        let debounce;
        const observer = container
            ? new MutationObserver(() => {
                clearTimeout(debounce);
                debounce = setTimeout(scan, 250);
            })
            : null;
        if (observer && container) {
            observer.observe(container, { childList: true, subtree: true });
        }

        return () => {
            timers.forEach(clearTimeout);
            clearTimeout(debounce);
            if (observer) observer.disconnect();
        };
    }, [location.pathname, scan]);

    // Scroll-spy: marks as active the last section that has passed the top.
    useEffect(() => {
        if (headings.length === 0) return;
        let raf = 0;
        const compute = () => {
            raf = 0;
            const nodes = nodesRef.current;
            if (nodes.length === 0) return;
            let current = nodes[0].id;
            for (const n of nodes) {
                if (n.el.getBoundingClientRect().top - ACTIVE_OFFSET <= 1) current = n.id;
                else break;
            }
            setActiveId(current);
        };
        const onScroll = () => {
            if (!raf) raf = requestAnimationFrame(compute);
        };
        compute();
        // capture:true to also capture scrolling of inner containers.
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onScroll);
        return () => {
            if (raf) cancelAnimationFrame(raf);
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onScroll);
        };
    }, [headings]);

    // Keeps the active element visible within the panel's list.
    useEffect(() => {
        if (!isOpen || !activeId || !navRef.current) return;
        const item = navRef.current.querySelector(`[data-target="${activeId}"]`);
        if (item) item.scrollIntoView({ block: 'nearest' });
    }, [activeId, isOpen]);

    const setOpen = useCallback((val) => {
        setIsOpen(val);
        try { localStorage.setItem(STORAGE_KEY, val ? '1' : '0'); } catch { /* ignore */ }
    }, []);

    // Esc closes the panel.
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, setOpen]);

    const goTo = (id) => {
        // 1) Tries the live reference from the last scan (the most reliable).
        const entry = nodesRef.current.find((n) => n.id === id && n.el.isConnected);
        let el = entry?.el || null;
        // 2) If the original node has been replaced (e.g. a BlockNote/ProseMirror re-render),
        //    re-search by text in the current container and jump to it. (We no longer write
        //    `id` in the DOM, so there is no fallback via getElementById.)
        if (!el || !el.isConnected) {
            const item = headings.find((h) => h.id === id);
            const container = document.querySelector(CONTENT_SELECTOR);
            if (item && container) {
                el = Array.from(container.querySelectorAll('h1, h2, h3'))
                    .find((h) => h.isConnected && headingText(h) === item.text);
            }
        }
        // `behavior: 'smooth'` doesn't scroll within these scroll containers
        // that are nested (flex with overflow); the instant jump, however, is reliable.
        if (el && el.isConnected) el.scrollIntoView({ block: 'start' });
        setActiveId(id);
    };

    // Only on allowed routes and with at least 2 headings.
    if (!enabled || headings.length < 2) return null;

    const minLevel = Math.min(...headings.map((h) => h.level));

    if (!isOpen) {
        return (
            <button
                type="button"
                data-testid="page-outline-toggle"
                onClick={() => setOpen(true)}
                title={t('outline.open', "Page outline")}
                aria-label={t('outline.open', "Page outline")}
                className="fixed right-0 top-1/2 -translate-y-1/2 z-[60] flex items-center justify-center w-8 h-12 rounded-l-lg border border-r-0 border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:text-[var(--gnosi-blue)] shadow-md cursor-pointer transition-colors"
            >
                <ListTree size={18} />
            </button>
        );
    }

    return (
        <div data-testid="page-outline-panel" className="fixed right-3 top-1/2 -translate-y-1/2 z-[60] w-64 max-h-[70vh] flex flex-col rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-primary)]">
                <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                    <ListTree size={15} />
                    <span className="text-[11px] font-bold uppercase tracking-tight">
                        {t('outline.title', "On this page")}
                    </span>
                </div>
                <button
                    type="button"
                    onClick={() => setOpen(false)}
                    title={t('common.close', "Close")}
                    aria-label={t('common.close', "Close")}
                    className="flex items-center justify-center w-6 h-6 rounded-md border-none bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors"
                >
                    <X size={15} />
                </button>
            </div>
            <nav ref={navRef} className="flex-1 overflow-y-auto py-1.5">
                {headings.map((h) => {
                    const isActive = h.id === activeId;
                    return (
                        <button
                            key={h.id}
                            type="button"
                            data-target={h.id}
                            onClick={() => goTo(h.id)}
                            style={{ paddingLeft: `${10 + (h.level - minLevel) * 14}px` }}
                            className={`block w-full text-left pr-3 py-1.5 text-[13px] leading-snug truncate border-l-2 bg-transparent cursor-pointer transition-colors ${
                                isActive
                                    ? 'border-[var(--gnosi-blue)] text-[var(--gnosi-blue)] font-semibold'
                                    : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                            }`}
                            title={h.text}
                        >
                            {h.text}
                        </button>
                    );
                })}
            </nav>
        </div>
    );
}
