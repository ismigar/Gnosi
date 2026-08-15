import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { Search, X, Quote } from 'lucide-react';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';

/**
 * Modal-portal picker for inserting citations in the BlockEditor.
 *
 * UX inspired by Mendeley Cite / Zotero quick-pick:
 *  - Free-text search (citation_key, title, author) with 200 ms debounce
 *  - List of options with ↑/↓ navigation
 *  - Enter or click inserts `[@key]` at the current cursor position
 *  - Esc closes the picker
 *
 * Rendered outside the BlockEditor's DOM tree (portal) to prevent
 * ProseMirror from stealing focus during the opening animation. When it
 * closes, it returns focus to the editor.
 */
const fetchCitations = async (query, signal) => {
    const r = await axios.get('/api/vault/search-citations', {
        params: { q: query || '', limit: 30 },
        signal,
    });
    return Array.isArray(r?.data) ? r.data : [];
};

export const CitePicker = ({ isOpen, onClose, onSelect }) => {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [activeIdx, setActiveIdx] = useState(0);
    const inputRef = useRef(null);
    const listRef = useRef(null);
    const panelRef = useRef(null);
    const debounceRef = useRef(null);
    const abortRef = useRef(null);

    // Esc + focus-trap centralized in the canonical hook. We do NOT pass onConfirm:
    // this modal's Enter selects the highlighted citation (own handler).
    useModalKeyboard({ isOpen, onClose, containerRef: panelRef, trapFocus: true });

    // Initial load + debounced search
    useEffect(() => {
        if (!isOpen) return;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (abortRef.current) abortRef.current.abort?.();
        debounceRef.current = setTimeout(async () => {
            // The controller must be CREATED and stored here: abortRef was
            // aborted above but never assigned, and the request carried no
            // signal — the cancellation machinery was dead code, so a slow
            // stale response ("we") could land after a fast newer one
            // ("weber") and overwrite the list with old results.
            const controller = new AbortController();
            abortRef.current = controller;
            setLoading(true);
            try {
                const data = await fetchCitations(query, controller.signal);
                if (controller.signal.aborted) return;
                setItems(data);
                setActiveIdx(0);
            } catch (err) {
                if (controller.signal.aborted) return;
                if (!String(err?.message || '').includes('aborted')) {
                    console.warn('CitePicker search failed:', err?.message);
                }
                setItems([]);
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }, 200);
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [query, isOpen]);

    // Reset and focus when it opens
    useEffect(() => {
        if (!isOpen) return;
        setQuery('');
        setActiveIdx(0);
        // The portal may take a tick to mount — focus on next frame
        const id = requestAnimationFrame(() => {
            try { inputRef.current?.focus(); } catch { /* ignore */ }
        });
        return () => cancelAnimationFrame(id);
    }, [isOpen]);

    const handleSelect = useCallback((item) => {
        if (!item || !item.citation_key) return;
        try { onSelect?.(item); } catch (err) {
            console.warn('CitePicker onSelect failed:', err?.message);
        }
        onClose?.();
    }, [onSelect, onClose]);

    const handleKeyDown = useCallback((e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIdx((i) => Math.min(i + 1, Math.max(items.length - 1, 0)));
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIdx((i) => Math.max(i - 1, 0));
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            const item = items[activeIdx];
            if (item) handleSelect(item);
            return;
        }
    }, [items, activeIdx, handleSelect]);

    // Auto-scroll active element into view
    useEffect(() => {
        if (!listRef.current) return;
        const active = listRef.current.querySelector(`[data-idx="${activeIdx}"]`);
        if (active) {
            try { active.scrollIntoView({ block: 'nearest' }); } catch { /* ignore */ }
        }
    }, [activeIdx]);

    // The portal must be calculated before any early return in order to
    // comply with the rules of hooks.
    const portalEl = useMemo(() => {
        if (typeof document === 'undefined') return null;
        let el = document.getElementById('cite-picker-root');
        if (!el) {
            el = document.createElement('div');
            el.id = 'cite-picker-root';
            document.body.appendChild(el);
        }
        return el;
    }, []);

    if (!isOpen) return null;
    if (!portalEl) return null;

    return ReactDOM.createPortal(
        <div
            className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center pt-24 bg-black/40"
            onMouseDown={(e) => {
                // Click outside the panel closes it
                if (e.target === e.currentTarget) onClose?.();
            }}
        >
            <div
                ref={panelRef}
                className="w-full max-w-2xl rounded-xl shadow-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)] overflow-hidden"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-secondary)]">
                    <Search size={18} className="text-[var(--text-tertiary)] shrink-0" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={t('cite_picker.placeholder', {
                            defaultValue: "Search by citation key, title or author…",
                        })}
                        className="flex-1 bg-transparent outline-none text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
                        autoComplete="off"
                        spellCheck={false}
                    />
                    <button
                        type="button"
                        onClick={() => onClose?.()}
                        className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] shrink-0"
                        title={t('common.close', { defaultValue: "Close" })}
                    >
                        <X size={18} />
                    </button>
                </div>
                <div
                    ref={listRef}
                    className="max-h-[60vh] overflow-y-auto"
                >
                    {loading && items.length === 0 && (
                        <div className="px-4 py-6 text-sm text-[var(--text-tertiary)] text-center">
                            {t('cite_picker.loading', { defaultValue: "Searching…" })}
                        </div>
                    )}
                    {!loading && items.length === 0 && (
                        <div className="px-4 py-6 text-sm text-[var(--text-tertiary)] text-center">
                            {t('cite_picker.no_results', {
                                defaultValue: "No results. Try another term.",
                            })}
                        </div>
                    )}
                    {items.map((item, idx) => {
                        const isActive = idx === activeIdx;
                        const meta = [item.author, item.year].filter(Boolean).join(', ');
                        return (
                            <button
                                key={`${item.id || item.citation_key}-${idx}`}
                                type="button"
                                data-idx={idx}
                                onMouseEnter={() => setActiveIdx(idx)}
                                onClick={() => handleSelect(item)}
                                className={
                                    'w-full text-left px-4 py-3 flex items-start gap-3 border-b border-[var(--border-secondary)] last:border-b-0 transition-colors ' +
                                    (isActive
                                        ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]'
                                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]')
                                }
                            >
                                <Quote size={16} className="mt-0.5 shrink-0 text-[var(--gnosi-primary)]" />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)] truncate">
                                        <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--gnosi-primary)] shrink-0">
                                            @{item.citation_key}
                                        </span>
                                        <span className="truncate">{item.title || '—'}</span>
                                    </div>
                                    {meta && (
                                        <div className="text-xs text-[var(--text-tertiary)] mt-0.5 truncate">
                                            {meta}
                                        </div>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>
                <div className="px-4 py-2 text-xs text-[var(--text-tertiary)] border-t border-[var(--border-secondary)] bg-[var(--bg-secondary)] flex gap-4">
                    <span>↑↓ {t('cite_picker.hint_navigate', { defaultValue: "navigate" })}</span>
                    <span>↵ {t('cite_picker.hint_insert', { defaultValue: "insert" })}</span>
                    <span>Esc {t('cite_picker.hint_close', { defaultValue: "close" })}</span>
                </div>
            </div>
        </div>,
        portalEl,
    );
};

export default CitePicker;
