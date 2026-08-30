import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { subscribeWindowEvent, subscribeDocumentEvent, eventTargetIsWithin } from '../../../shared/platform/browser-events';
import type { RelationOption } from './types';

export function RelationValuePicker({ value, onChange, options, loading, thisLabel, placeholder }: { value: string; onChange: (value: string) => void; options?: RelationOption[]; loading?: boolean; thisLabel: string; placeholder?: string }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [highlighted, setHighlighted] = useState(0);
    // Fixed panel position: the dropdown is rendered in a PORTAL to
    // <body> so it isn't clipped by the modal body's `overflow-y-auto`
    // (previously only the search box was visible and the list stayed hidden).
    const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
    const boxRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    const allOptions = useMemo(
        () => [{ value: 'this', label: thisLabel }, ...(options || [])],
        [options, thisLabel],
    );
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return allOptions;
        return allOptions.filter(o => (o.label || '').toLowerCase().includes(q));
    }, [allOptions, query]);

    const current = allOptions.find(o => o.value === value);
    const display = current ? current.label : (value || '');

    const openPanel = () => {
        const r = boxRef.current?.getBoundingClientRect();
        if (r) setRect({ left: r.left, top: r.bottom + 4, width: r.width });
        setQuery('');
        setHighlighted(0);
        setOpen(true);
    };

    useEffect(() => {
        if (!open) return undefined;
        const onDoc = (e: MouseEvent) => {
            if (boxRef.current && eventTargetIsWithin(boxRef.current, e.target)) return;
            if (panelRef.current && eventTargetIsWithin(panelRef.current, e.target)) return;
            setOpen(false);
        };
        // The panel has a fixed position calculated on open; if the user scrolls
        // (e.g. inside the modal) or resizes, we close it to avoid misalignment.
        const onMove = () => { setOpen(false); };
        const stopDoc = subscribeDocumentEvent('mousedown', onDoc);
        const stopResize = subscribeWindowEvent('resize', onMove);
        const stopScroll = subscribeWindowEvent('scroll', onMove, true);
        return () => {
            stopDoc();
            stopResize();
            stopScroll();
        };
    }, [open]);

    const pick = (opt: RelationOption) => { onChange(opt.value); setOpen(false); setQuery(''); };

    return (
        <div ref={boxRef} className="relative w-40">
            <button
                type="button"
                onClick={() => { if (open) setOpen(false); else openPanel(); }}
                className="w-full text-left truncate text-xs border border-[var(--border-primary)] rounded px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] hover:border-[var(--gnosi-primary)]"
                title={display}
            >
                {display || <span className="text-[var(--text-tertiary)]">{placeholder || t('view.filter_pick', "Pick…")}</span>}
            </button>
            {open && rect && createPortal(
                <div
                    ref={panelRef}
                    style={{ position: 'fixed', top: rect.top, left: rect.left, width: Math.max(rect.width, 220), zIndex: 'var(--z-modal-dropdown)' }}
                    className="max-h-60 overflow-auto rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-2xl"
                >
                    <input
                        autoFocus
                        value={query}
                        onChange={e => { setQuery(e.target.value); setHighlighted(0); }}
                        onKeyDown={e => {
                            if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)); }
                            else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
                            else if (e.key === 'Enter') { e.preventDefault(); if (filtered[highlighted]) pick(filtered[highlighted]); }
                            else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
                        }}
                        placeholder={t('view.search_placeholder', "Search…")}
                        className="w-full text-xs border-b border-[var(--border-primary)] px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] sticky top-0"
                    />
                    {loading && <div className="px-2 py-1.5 text-xs text-[var(--text-tertiary)] italic">{t('common.loading', "Loading...")}</div>}
                    {!loading && filtered.map((o, i) => (
                        <div
                            key={o.value}
                            onMouseEnter={() => { setHighlighted(i); }}
                            onMouseDown={e => { e.preventDefault(); pick(o); }}
                            className={`px-2 py-1.5 text-xs cursor-pointer truncate ${i === highlighted ? 'bg-[var(--gnosi-primary)]/15 text-[var(--gnosi-primary)]' : 'text-[var(--text-primary)]'} ${o.value === value ? 'font-semibold' : ''}`}
                            title={o.label}
                        >
                            {o.value === 'this' ? `📍 ${o.label}` : o.label}
                        </div>
                    ))}
                    {!loading && filtered.length === 0 && (
                        <div className="px-2 py-1.5 text-xs text-[var(--text-tertiary)] italic">{t('view.no_results', "No results")}</div>
                    )}
                </div>,
                document.body
            )}
        </div>
    );
}
