import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ListTree, X } from 'lucide-react';

// Contenidor de scroll principal definit a App.jsx. Hi cerquem els encapçalaments.
const CONTENT_SELECTOR = '#page-content-scroll';
const STORAGE_KEY = 'page_outline_open_v1';
// Marge superior perquè l'encapçalament no quedi enganxat a dalt en saltar-hi.
const SCROLL_MARGIN = 16;
// Offset (px des de dalt del viewport) per decidir quina secció és l'activa.
const ACTIVE_OFFSET = 120;

// El navegador de títols només té sentit a pàgines de contingut llarg: Vault
// (notes/documents), Correu i Lector de notícies. A la resta (Control Center,
// Configuració, Graf, etc.) no s'hi mostra.
const ALLOWED_PREFIXES = ['/vault', '/mail', '/reader'];
const isOutlineRoute = (path) =>
    ALLOWED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));

// Id intern estable; el prefix `i` ja en garanteix la unicitat.
const slugify = (text, i) =>
    `pout-${i}-${text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)}`;

// Text "net" del títol: agafa els nodes de text propis del heading, que exclouen
// els chips d'acció renderitzats com a fills (p. ex. un "Detalls →" dins del h3).
// Si el títol va embolcallat i no hi ha text directe, cau al text complet sense a/button.
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

    // Només actiu a Vault, Correu i Lector.
    const enabled = isOutlineRoute(location.pathname);

    // Escaneja el contingut visible i recull h1-h3 reals (no els de targetes-enllaç).
    const scan = useCallback(() => {
        const container = document.querySelector(CONTENT_SELECTOR);
        if (!enabled || !container) { setHeadings([]); nodesRef.current = []; return; }
        const collected = [];
        const nodes = [];
        container.querySelectorAll('h1, h2, h3').forEach((el, i) => {
            if (el.closest('a, button')) return;     // títols de targetes/botons no són seccions
            if (el.offsetParent === null) return;     // amagat (modals tancades, display:none)
            const text = headingText(el);
            if (!text) return;
            if (!el.id) el.id = slugify(text, i);
            el.style.scrollMarginTop = `${SCROLL_MARGIN}px`;
            collected.push({ id: el.id, text, level: Number(el.tagName[1]) });
            nodes.push(el);
        });
        nodesRef.current = nodes;
        setHeadings(collected);
    }, [enabled]);

    // Re-escaneja en canviar de ruta (amb reintents pel contingut que carrega async)
    // i quan el DOM del contingut canvia (dashboards dinàmics).
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

    // Scroll-spy: marca com a activa l'última secció que ha passat per dalt.
    useEffect(() => {
        if (headings.length === 0) return;
        let raf = 0;
        const compute = () => {
            raf = 0;
            const nodes = nodesRef.current;
            if (nodes.length === 0) return;
            let current = nodes[0].id;
            for (const el of nodes) {
                if (el.getBoundingClientRect().top - ACTIVE_OFFSET <= 1) current = el.id;
                else break;
            }
            setActiveId(current);
        };
        const onScroll = () => {
            if (!raf) raf = requestAnimationFrame(compute);
        };
        compute();
        // capture:true per capturar també l'scroll de contenidors interns.
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onScroll);
        return () => {
            if (raf) cancelAnimationFrame(raf);
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onScroll);
        };
    }, [headings]);

    // Manté l'element actiu visible dins la llista del panell.
    useEffect(() => {
        if (!isOpen || !activeId || !navRef.current) return;
        const item = navRef.current.querySelector(`[data-target="${activeId}"]`);
        if (item) item.scrollIntoView({ block: 'nearest' });
    }, [activeId, isOpen]);

    const setOpen = useCallback((val) => {
        setIsOpen(val);
        try { localStorage.setItem(STORAGE_KEY, val ? '1' : '0'); } catch { /* ignore */ }
    }, []);

    // Esc tanca el panell.
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, setOpen]);

    const goTo = (id) => {
        const el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setActiveId(id);
    };

    // Només a rutes permeses i amb almenys 2 títols.
    if (!enabled || headings.length < 2) return null;

    const minLevel = Math.min(...headings.map((h) => h.level));

    if (!isOpen) {
        return (
            <button
                type="button"
                data-testid="page-outline-toggle"
                onClick={() => setOpen(true)}
                title={t('outline.open', 'Índex de la pàgina')}
                aria-label={t('outline.open', 'Índex de la pàgina')}
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
                        {t('outline.title', 'En aquesta pàgina')}
                    </span>
                </div>
                <button
                    type="button"
                    onClick={() => setOpen(false)}
                    title={t('common.close', 'Tancar')}
                    aria-label={t('common.close', 'Tancar')}
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
