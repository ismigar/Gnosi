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

// Editor estructurat: afegir/treure/reordenar autors + autocompletar.
// `onSave(authors)` rep la llista neta (sense files buides). No desa si l'editor
// s'obre buit i l'usuari no afegeix res (evita esborrar un valor legacy string),
// ni si el valor no ha canviat (important quan està sempre muntat al panell).
export const AutoriaEditor = ({ value = [], suggestions = [], onSave }) => {
    const [authors, setAuthors] = useState(
        Array.isArray(value)
            ? value.map(a => ({ nom: a?.nom || '', cognom1: a?.cognom1 || '', cognom2: a?.cognom2 || '' }))
            : []
    );
    const [search, setSearch] = useState('');
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

    const filtered = suggestions.filter(s =>
        authorSortLabel(s).toLowerCase().includes(search.toLowerCase()) && !authors.some(a => sameAuthor(a, s))
    );
    const inputCls = 'flex-1 min-w-[56px] px-1.5 py-0.5 text-xs border border-[var(--border-primary)] rounded bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]';

    return (
        <div ref={containerRef} className="w-full min-w-[280px] py-1" onClick={e => e.stopPropagation()}>
            <div className="flex flex-col gap-1 mb-1">
                {authors.map((a, idx) => (
                    <div key={idx} className="flex items-center gap-1">
                        <div className="flex flex-col -space-y-1 text-[var(--text-tertiary)] shrink-0">
                            <ArrowUp size={11} className={`cursor-pointer hover:text-[var(--gnosi-primary)] ${idx === 0 ? 'opacity-20 pointer-events-none' : ''}`} onMouseDown={e => { e.preventDefault(); move(idx, -1); }} />
                            <ArrowDown size={11} className={`cursor-pointer hover:text-[var(--gnosi-primary)] ${idx === authors.length - 1 ? 'opacity-20 pointer-events-none' : ''}`} onMouseDown={e => { e.preventDefault(); move(idx, 1); }} />
                        </div>
                        <input className={inputCls} placeholder="Nom" value={a.nom} onChange={e => update(idx, 'nom', e.target.value)} />
                        <input className={inputCls} placeholder="Cognom 1" value={a.cognom1} onChange={e => update(idx, 'cognom1', e.target.value)} />
                        <input className={inputCls} placeholder="Cognom 2" value={a.cognom2} onChange={e => update(idx, 'cognom2', e.target.value)} />
                        <X size={12} className="cursor-pointer text-[var(--text-tertiary)] hover:text-red-500 shrink-0" onMouseDown={e => { e.preventDefault(); removeAt(idx); }} />
                    </div>
                ))}
            </div>
            <button
                type="button"
                className="flex items-center gap-1 text-[11px] font-medium text-[var(--gnosi-primary)] hover:underline"
                onMouseDown={e => { e.preventDefault(); setAuthors(prev => [...prev, emptyAuthor()]); }}
            >
                <Plus size={11} /> Afegir autor
            </button>
            {suggestions.length > 0 && (
                <input
                    className="w-full mt-1 px-2 py-0.5 text-xs border border-[var(--border-primary)] rounded bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                    placeholder="Cercar autor existent…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Escape') commit(authors); }}
                />
            )}
            {search && filtered.length > 0 && (
                <div className="mt-1 max-h-28 overflow-y-auto custom-scrollbar border border-[var(--border-primary)] rounded bg-[var(--bg-primary)] shadow-md relative z-50">
                    {filtered.slice(0, 8).map((s, i) => (
                        <div
                            key={i}
                            className="px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--gnosi-primary)]/10 hover:text-[var(--gnosi-primary)] cursor-pointer"
                            onMouseDown={e => { e.preventDefault(); setAuthors(prev => [...prev, { nom: s.nom || '', cognom1: s.cognom1 || '', cognom2: s.cognom2 || '' }]); setSearch(''); }}
                        >
                            {authorSortLabel(s)}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
