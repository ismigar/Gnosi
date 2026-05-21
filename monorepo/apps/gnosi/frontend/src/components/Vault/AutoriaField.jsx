/**
 * AutoriaField.jsx — components del tipus de camp "autoria" (llista ordenada
 * d'autors `{nom, cognom1, cognom2}`). S'usen tant a la vista de taula
 * (VaultTable) com al panell de propietats de la pàgina (BlockEditor), perquè
 * el render i l'edició siguin consistents.
 *
 * Els helpers purs viuen a ./autoriaUtils (separats perquè React Fast Refresh
 * només funciona si un mòdul exporta NOMÉS components).
 *
 * CSL no té segon cognom: per citar, cognom1+cognom2 es fusionen a `family`
 * (vegeu cslEngine.js / docs/dev_memory/directives/autoria_field_type.md).
 */
import React, { useState, useRef, useEffect } from 'react';
import { ArrowUp, ArrowDown, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { emptyAuthor, authorFullName, authorSortLabel, sameAuthor } from './autoriaUtils';

// Render de només lectura: pills "Nom Cognom1 Cognom2".
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

// Editor estructurat: "Afegir autor" mostra una fila buida (nom/cognom1/cognom2).
// Mentre s'omple una fila, apareixen inline els autors existents que coincideixen
// (com els altres multiselects); si no en tries cap, el que escrius és un autor
// nou. No hi ha cercador separat.
//
// `onSave(authors)` rep la llista neta (sense files buides). No desa si l'editor
// s'obre buit i no s'hi afegeix res (no esborra un valor legacy string), ni si el
// valor no ha canviat (important quan està sempre muntat al panell).
export const AutoriaEditor = ({ value = [], suggestions = [], onSave }) => {
    const { t } = useTranslation();
    const [authors, setAuthors] = useState(
        Array.isArray(value)
            ? value.map(a => ({ nom: a?.nom || '', cognom1: a?.cognom1 || '', cognom2: a?.cognom2 || '' }))
            : []
    );
    // Fila amb el focus actual (per mostrar-hi els suggeriments).
    const [focusedIdx, setFocusedIdx] = useState(null);
    // Suggeriment ressaltat — compartit entre navegació amb teclat i hover.
    const [highlightedIdx, setHighlightedIdx] = useState(0);
    const containerRef = useRef(null);
    // Hi havia autors estructurats reals a l'inici? (per no esborrar dades)
    const hadInitial = useRef(Array.isArray(value) && value.some(a => a && (a.nom || a.cognom1 || a.cognom2)));
    // Valor ja desat (serialitzat). Evita re-desar quan no hi ha canvi —
    // imprescindible quan l'editor està sempre muntat (panell de propietats),
    // on cada clic fora dispararia un commit redundant.
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
        // `authors` al dep array → el handler tanca sempre sobre l'últim valor.
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

    // Autors existents que coincideixen amb el text de la fila `idx` i que encara
    // no estan a la llista. Buit si la fila és buida → cap suggeriment.
    const matchesFor = (idx) => {
        const q = authorFullName(authors[idx] || {}).trim().toLowerCase();
        if (!q) return [];
        return suggestions
            .filter(s => authorFullName(s).toLowerCase().includes(q) && !authors.some(a => sameAuthor(a, s)))
            .slice(0, 6);
    };
    const pick = (idx, s) => {
        setAuthors(prev => prev.map((a, i) => (i === idx ? { nom: s.nom || '', cognom1: s.cognom1 || '', cognom2: s.cognom2 || '' } : a)));
        setFocusedIdx(null);
    };
    // Navegació amb teclat de la llista de suggeriments de la fila `idx`:
    // ↓/↑ mou el ressaltat, Enter selecciona el ressaltat, Esc tanca.
    const handleKeyNav = (idx, e) => {
        const matches = matchesFor(idx);
        if (!matches.length) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightedIdx(i => Math.min(i + 1, matches.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightedIdx(i => Math.max(i - 1, 0)); }
        else if (e.key === 'Enter') { e.preventDefault(); pick(idx, matches[Math.min(highlightedIdx, matches.length - 1)]); }
        else if (e.key === 'Escape') { e.preventDefault(); setFocusedIdx(null); }
    };

    const inputCls = 'flex-1 min-w-[56px] px-1.5 py-0.5 text-xs border border-[var(--border-primary)] rounded bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]';
    const fieldHandlers = (idx, key) => ({
        value: authors[idx]?.[key] || '',
        onChange: (e) => { update(idx, key, e.target.value); setFocusedIdx(idx); setHighlightedIdx(0); },
        onFocus: () => { setFocusedIdx(idx); setHighlightedIdx(0); },
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
                                            className={`px-2 py-1 text-xs cursor-pointer ${i === highlightedIdx ? 'bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)]' : 'text-[var(--text-secondary)]'}`}
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
