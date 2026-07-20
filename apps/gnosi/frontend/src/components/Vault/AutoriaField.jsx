/**
 * AutoriaField.jsx — components for the "authorship" field type (an ordered list
 * of authors `{nom, cognom1, cognom2}`). Used both in the table view
 * (VaultTable) and in the page's properties panel (BlockEditor), so that
 * rendering and editing stay consistent.
 *
 * The pure helpers live in ./autoriaUtils (kept separate because React Fast Refresh
 * only works if a module exports ONLY components).
 *
 * CSL has no second surname: for citations, cognom1+cognom2 are merged into `family`
 * (see cslEngine.js / docs/dev_memory/directives/autoria_field_type.md).
 */
import React, { useState, useRef, useEffect } from 'react';
import { ArrowUp, ArrowDown, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { emptyAuthor, authorFullName, authorSortLabel, sameAuthor } from './autoriaUtils';

// Read-only render: "Name Surname1 Surname2" pills.
export const AutoriaDisplay = ({ value, emptyText = '-' }) => {
    const list = Array.isArray(value) ? value : [];
    if (!list.length) return <span className="text-[var(--text-tertiary)]">{emptyText}</span>;
    return (
        <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto custom-scrollbar pr-1 py-0.5">
            {list.map((a, idx) => (
                <span key={idx} className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] whitespace-nowrap border border-[var(--gnosi-primary)]/20" title={authorSortLabel(a)}>
                    {authorFullName(a) || '—'}
                </span>
            ))}
        </div>
    );
};

// Structured editor: "Add author" shows an empty row (nom/cognom1/cognom2).
// While filling in a row, matching existing authors appear inline
// (like the other multiselects); if you don't pick any, what you type is an author
// new. There is no separate search box.
//
// `onSave(authors)` receives the clean list (without empty rows). It doesn't save if the editor
// opens empty and nothing is added to it (it doesn't erase a legacy string value), nor if the
// value hasn't changed (important when it's always mounted in the panel).
export const AutoriaEditor = ({ value = [], suggestions = [], onSave }) => {
    const { t } = useTranslation();
    const [authors, setAuthors] = useState(
        Array.isArray(value)
            ? value.map(a => ({ nom: a?.nom || '', cognom1: a?.cognom1 || '', cognom2: a?.cognom2 || '' }))
            : []
    );
    // Row with the current focus (to show the suggestions there).
    const [focusedIdx, setFocusedIdx] = useState(null);
    // Highlighted suggestion — shared between keyboard navigation and hover.
    // -1 = none selected (the user hasn't navigated); Enter without navigation
    // closes the dropdown instead of forcing the first match.
    const [highlightedIdx, setHighlightedIdx] = useState(-1);
    const containerRef = useRef(null);
    // Were there real structured authors at the start? (so as not to delete data)
    const hadInitial = useRef(Array.isArray(value) && value.some(a => a && (a.nom || a.cognom1 || a.cognom2)));
    // Value already saved (serialized). Avoids re-saving when there's no change —
    // essential when the editor is always mounted (properties panel),
    // where every outside click would trigger a redundant commit.
    const lastSavedRef = useRef(JSON.stringify(
        (Array.isArray(value) ? value : [])
            .map(a => ({ nom: a?.nom || '', cognom1: a?.cognom1 || '', cognom2: a?.cognom2 || '' }))
            .filter(a => a.nom || a.cognom1 || a.cognom2)
    ));

    const commit = (list) => {
        const cleaned = list.filter(a => a.nom || a.cognom1 || a.cognom2);
        if (cleaned.length === 0 && !hadInitial.current) return;
        const ser = JSON.stringify(cleaned);
        if (ser === lastSavedRef.current) return;
        lastSavedRef.current = ser;
        onSave(cleaned);
    };

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target)) commit(authors);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
        // `authors` in the dep array → the handler always closes over the last value.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authors, onSave]);

    const update = (idx, key, val) => setAuthors(prev => prev.map((a, i) => (i === idx ? { ...a, [key]: val } : a)));
    const removeAt = (idx) => setAuthors(prev => prev.filter((_, i) => i !== idx));
    const move = (idx, dir) => setAuthors(prev => {
        const j = idx + dir;
        if (j < 0 || j >= prev.length) return prev;
        const next = [...prev];
        [next[idx], next[j]] = [next[j], next[idx]];
        return next;
    });

    // Existing authors that match the text of row `idx` and that still
    // aren't in the list. Empty if the row is empty → no suggestion.
    // Filters out suggestions that would clear a field the user has already filled in
    // (e.g. old data with cognom1="García Fernández" when the user already has
    // cognom1="García" and cognom2="Fernández"): avoids silent overwrites.
    const matchesFor = (idx) => {
        const current = authors[idx] || {};
        const q = authorFullName(current).trim().toLowerCase();
        if (!q) return [];
        return suggestions
            .filter(s => {
                if (!authorFullName(s).toLowerCase().includes(q)) return false;
                if (authors.some(a => sameAuthor(a, s))) return false;
                // Don't show suggestions that would erase fields already filled in.
                if (current.nom && !s.nom) return false;
                if (current.cognom1 && !s.cognom1) return false;
                if (current.cognom2 && !s.cognom2) return false;
                return true;
            })
            .slice(0, 6);
    };
    const pick = (idx, s) => {
        setAuthors(prev => prev.map((a, i) => (i === idx ? { nom: s.nom || '', cognom1: s.cognom1 || '', cognom2: s.cognom2 || '' } : a)));
        setFocusedIdx(null);
    };
    // Keyboard navigation of the suggestion list for row `idx`:
    // ↓/↑ moves the highlight, Enter selects the highlighted item, Esc closes.
    const handleKeyNav = (idx, e) => {
        const matches = matchesFor(idx);
        if (!matches.length) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightedIdx(i => Math.min(i + 1, matches.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightedIdx(i => Math.max(i - 1, -1)); }
        else if (e.key === 'Enter') { e.preventDefault(); if (highlightedIdx >= 0) pick(idx, matches[Math.min(highlightedIdx, matches.length - 1)]); else setFocusedIdx(null); }
        else if (e.key === 'Escape') { e.preventDefault(); setFocusedIdx(null); }
    };

    const inputCls = 'flex-1 min-w-[56px] px-1.5 py-0.5 text-xs border border-[var(--border-primary)] rounded bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]';
    const fieldHandlers = (idx, key) => ({
        value: authors[idx]?.[key] || '',
        onChange: (e) => { update(idx, key, e.target.value); setFocusedIdx(idx); setHighlightedIdx(-1); },
        onFocus: () => { setFocusedIdx(idx); setHighlightedIdx(-1); },
        onBlur: () => setFocusedIdx(null),
        onKeyDown: (e) => handleKeyNav(idx, e),
    });

    return (
        <div ref={containerRef} className="w-full min-w-[280px] py-1" onClick={e => e.stopPropagation()}>
            <div className="flex flex-col gap-1 mb-1">
                {authors.map((a, idx) => {
                    const matches = focusedIdx === idx ? matchesFor(idx) : [];
                    return (
                        <div key={idx}>
                            <div className="flex items-center gap-1">
                                <div className="flex flex-col -space-y-1 text-[var(--text-tertiary)] shrink-0">
                                    <ArrowUp size={11} className={`cursor-pointer hover:text-[var(--gnosi-primary)] ${idx === 0 ? 'opacity-20 pointer-events-none' : ''}`} onMouseDown={e => { e.preventDefault(); move(idx, -1); }} />
                                    <ArrowDown size={11} className={`cursor-pointer hover:text-[var(--gnosi-primary)] ${idx === authors.length - 1 ? 'opacity-20 pointer-events-none' : ''}`} onMouseDown={e => { e.preventDefault(); move(idx, 1); }} />
                                </div>
                                <input className={inputCls} placeholder={t('autoria.first_name', 'Nom')} {...fieldHandlers(idx, 'nom')} />
                                <input className={inputCls} placeholder={t('autoria.surname1', 'Cognom 1')} {...fieldHandlers(idx, 'cognom1')} />
                                <input className={inputCls} placeholder={t('autoria.surname2', 'Cognom 2')} {...fieldHandlers(idx, 'cognom2')} />
                                <span title={t('common.delete', 'Elimina')} className="shrink-0 flex items-center cursor-pointer text-[var(--text-tertiary)] hover:text-red-500" onMouseDown={e => { e.preventDefault(); removeAt(idx); }}>
                                    <X size={12} />
                                </span>
                            </div>
                            {matches.length > 0 && (
                                <div className="ml-9 mt-0.5 max-h-28 overflow-y-auto custom-scrollbar border border-[var(--border-primary)] rounded bg-[var(--bg-primary)] shadow-md">
                                    {matches.map((s, i) => (
                                        <div
                                            key={i}
                                            className={`px-2 py-1 text-xs cursor-pointer ${highlightedIdx >= 0 && i === highlightedIdx ? 'bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)]' : 'text-[var(--text-secondary)]'}`}
                                            onMouseEnter={() => setHighlightedIdx(i)}
                                            onMouseDown={e => { e.preventDefault(); pick(idx, s); }}
                                        >
                                            {authorSortLabel(s)}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            <button
                type="button"
                className="flex items-center gap-1 text-[11px] font-medium text-[var(--gnosi-primary)] hover:underline"
                onMouseDown={e => { e.preventDefault(); setAuthors(prev => [...prev, emptyAuthor()]); }}
            >
                <Plus size={11} /> {t('autoria.add_author', 'Afegir autor')}
            </button>
        </div>
    );
};
