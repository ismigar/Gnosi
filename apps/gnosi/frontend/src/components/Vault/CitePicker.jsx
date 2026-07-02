import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { Search, X, Quote } from 'lucide-react';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';

/**
 * Modal-portal picker per inserir citacions al BlockEditor.
 *
 * UX inspirada en Mendeley Cite / Zotero quick-pick:
 *  - Cerca lliure (citation_key, títol, autor) amb debounce 200 ms
 *  - Llista d'opcions amb navegació via ↑/↓
 *  - Enter o click insereix `[@key]` a la posició actual del cursor
 *  - Esc tanca el picker
 *
 * Es renderitza fora del DOM tree del BlockEditor (portal) per evitar
 * que el ProseMirror robi el focus durant l'animació d'obrir. Quan es
 * tanca, retorna el focus a l'editor.
 */
const fetchCitations = async (query) => {
    const r = await axios.get('/api/vault/search-citations', {
        params: { q: query || '', limit: 30 },
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

    // Esc + focus-trap centralitzats al hook canònic. NO passem onConfirm:
    // l'Enter d'aquest modal selecciona la citació ressaltada (handler propi).
    useModalKeyboard({ isOpen, onClose, containerRef: panelRef, trapFocus: true });

    // Càrrega inicial + cerca amb debounce
    useEffect(() => {
        if (!isOpen) return;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (abortRef.current) abortRef.current.abort?.();
        debounceRef.current = setTimeout(async () => {
            setLoading(true);
            try {
                const data = await fetchCitations(query);
                setItems(data);
                setActiveIdx(0);
            } catch (err) {
                if (!String(err?.message || '').includes('aborted')) {
                    console.warn('CitePicker search failed:', err?.message);
                }
                setItems([]);
            } finally {
                setLoading(false);
            }
        }, 200);
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [query, isOpen]);

    // Reset i focus quan s'obre
    useEffect(() => {
        if (!isOpen) return;
        setQuery('');
        setActiveIdx(0);
        // El portal pot trigar un tick a muntar — focus en next frame
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

    // Auto-scroll element actiu a la vista
    useEffect(() => {
        if (!listRef.current) return;
        const active = listRef.current.querySelector(`[data-idx="${activeIdx}"]`);
        if (active) {
            try { active.scrollIntoView({ block: 'nearest' }); } catch { /* ignore */ }
        }
    }, [activeIdx]);

    // El portal s'ha de calcular abans de qualsevol early-return per
    // complir les regles dels hooks.
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
            className="fixed inset-0 z-[9999] flex items-start justify-center pt-24 bg-black/40"
            onMouseDown={(e) => {
                // Click fora del panel tanca
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
                            defaultValue: 'Cerca per citation key, títol o autor…',
                        })}
                        className="flex-1 bg-transparent outline-none text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
                        autoComplete="off"
                        spellCheck={false}
                    />
                    <button
                        type="button"
                        onClick={() => onClose?.()}
                        className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] shrink-0"
                        title={t('common.close', { defaultValue: 'Tanca' })}
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
                            {t('cite_picker.loading', { defaultValue: 'Cercant…' })}
                        </div>
                    )}
                    {!loading && items.length === 0 && (
                        <div className="px-4 py-6 text-sm text-[var(--text-tertiary)] text-center">
                            {t('cite_picker.no_results', {
                                defaultValue: 'Cap resultat. Prova un altre terme.',
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
                    <span>↑↓ {t('cite_picker.hint_navigate', { defaultValue: 'naveguer' })}</span>
                    <span>↵ {t('cite_picker.hint_insert', { defaultValue: 'inserir' })}</span>
                    <span>Esc {t('cite_picker.hint_close', { defaultValue: 'tancar' })}</span>
                </div>
            </div>
        </div>,
        portalEl,
    );
};

export default CitePicker;
