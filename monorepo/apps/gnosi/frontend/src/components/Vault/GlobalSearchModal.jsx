import React, { useState, useEffect, useRef } from 'react';
import { Search, FileText, Hash, FolderClosed, Star, X } from 'lucide-react';
import { isCalendarPage } from './schemaUtils';
import { normalizeForSearch } from '../../utils/vaultFilters';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { IconRenderer } from './IconRenderer';

/**
 * Cerca global amb operadors estil Obsidian + cerques desades.
 * Operadors suportats (combinables): `tag:a/b` (jeràrquic, casa descendents),
 * `path:Carpeta`, `title:text`, `is:database`, i regex amb `/patró/flags`.
 * Els termes lliures casen amb el títol. Les cerques es desen a localStorage.
 */

const SAVED_KEY = 'gnosi.savedSearches';
const loadSaved = () => {
    try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]'); } catch { return []; }
};
const persistSaved = (list) => {
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(list.slice(0, 20))); } catch { /* noop */ }
};

const noteTags = (note) => {
    const raw = note?.metadata?.tags;
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : String(raw).split(',');
    return arr.map((t) => String(t).replace(/^#/, '').trim().toLowerCase()).filter(Boolean);
};

// Parseja la consulta en operadors + termes lliures + regex opcional.
const parseQuery = (query) => {
    const tokens = String(query).trim().split(/\s+/).filter(Boolean);
    const ops = { tag: [], path: [], title: [], is: [] };
    const terms = [];
    let regex = null;
    for (const tok of tokens) {
        const reMatch = tok.match(/^\/(.+)\/([a-z]*)$/i);
        if (reMatch) { try { regex = new RegExp(reMatch[1], reMatch[2] || 'i'); } catch { /* regex invàlid: ignora */ } continue; }
        const opMatch = tok.match(/^(tag|path|title|is):(.+)$/i);
        if (opMatch) { ops[opMatch[1].toLowerCase()].push(opMatch[2].toLowerCase()); continue; }
        terms.push(tok);
    }
    return { ops, terms, regex };
};

const matchNote = (note, parsed) => {
    const { ops, terms, regex } = parsed;
    const title = note.title || '';
    const titleNorm = normalizeForSearch(title);
    const folder = String(note.folder || note.path || '').toLowerCase();
    const tags = noteTags(note);

    // tag: (jeràrquic — casa el tag exacte o qualsevol descendent a/b/c)
    for (const tg of ops.tag) {
        if (!tags.some((t) => t === tg || t.startsWith(tg + '/'))) return false;
    }
    for (const p of ops.path) { if (!folder.includes(p)) return false; }
    for (const tt of ops.title) { if (!normalizeForSearch(title).includes(normalizeForSearch(tt))) return false; }
    for (const isv of ops.is) {
        if (isv === 'database' && !note.is_database) return false;
        if (isv === 'page' && note.is_database) return false;
    }
    if (regex && !(regex.test(title) || regex.test(folder))) return false;
    // Termes lliures: casen amb títol (o tag).
    for (const term of terms) {
        const tn = normalizeForSearch(term);
        if (!titleNorm.includes(tn) && !tags.some((t) => t.includes(term.toLowerCase()))) return false;
    }
    return true;
};

export function GlobalSearchModal({ isOpen, onClose, allNotes = [], onNoteSelect }) {
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [saved, setSaved] = useState(loadSaved);
    const inputRef = useRef(null);
    const listRef = useRef(null);
    const panelRef = useRef(null);

    useModalKeyboard({ isOpen, onClose, containerRef: panelRef, trapFocus: true });

    const filteredNotes = React.useMemo(() => {
        if (!query.trim()) return [];
        const parsed = parseQuery(query);
        return allNotes.filter((note) => {
            if (isCalendarPage(note)) return false;
            return matchNote(note, parsed);
        }).slice(0, 30);
    }, [query, allNotes]);

    useEffect(() => {
        if (isOpen) {
            setQuery('');
            setSelectedIndex(0);
            setSaved(loadSaved());
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen]);

    useEffect(() => { setSelectedIndex(0); }, [query]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (!isOpen) return;
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex((prev) => (prev < filteredNotes.length - 1 ? prev + 1 : prev));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (filteredNotes.length > 0 && filteredNotes[selectedIndex]) {
                    const selected = filteredNotes[selectedIndex];
                    onNoteSelect(selected.id, selected.folder);
                    onClose();
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, filteredNotes, selectedIndex, onNoteSelect, onClose]);

    useEffect(() => {
        if (listRef.current && listRef.current.children[selectedIndex]) {
            listRef.current.children[selectedIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }, [selectedIndex]);

    if (!isOpen) return null;

    const saveCurrent = () => {
        const q = query.trim();
        if (!q || saved.some((s) => s.query === q)) return;
        const next = [{ query: q, label: q }, ...saved].slice(0, 20);
        setSaved(next);
        persistSaved(next);
    };
    const removeSaved = (q) => {
        const next = saved.filter((s) => s.query !== q);
        setSaved(next);
        persistSaved(next);
    };

    const getIcon = (folder) => {
        if (folder === 'Tasques') return <Hash size={16} className="text-[var(--text-tertiary)]" />;
        if (folder === 'Notes') return <FileText size={16} className="text-[var(--text-tertiary)]" />;
        return <FolderClosed size={16} className="text-[var(--text-tertiary)]" />;
    };

    const isSaved = saved.some((s) => s.query === query.trim());

    return (
        <div className="fixed inset-0 z-[150] flex items-start justify-center pt-[15vh] px-4 sm:p-0">
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={onClose}></div>

            <div ref={panelRef} className="relative bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col font-sans border border-[var(--border-primary)]">
                <div className="flex items-center px-4 py-3 border-b border-[var(--border-primary)]">
                    <Search size={20} className="text-[var(--text-tertiary)] shrink-0" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Cerca…  tag:a/b  path:Carpeta  title:text  /regex/"
                        className="w-full bg-transparent border-none focus:ring-0 text-lg px-3 py-1 outline-none text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
                    />
                    {query.trim() && (
                        <button
                            onClick={saveCurrent}
                            title={isSaved ? 'Cerca desada' : 'Desa aquesta cerca'}
                            className={`shrink-0 mr-2 p-1 rounded hover:bg-[var(--bg-secondary)] ${isSaved ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'}`}
                        >
                            <Star size={16} fill={isSaved ? 'currentColor' : 'none'} />
                        </button>
                    )}
                    <kbd className="hidden sm:inline-flex items-center gap-1 text-[10px] font-medium text-[var(--text-tertiary)] bg-[var(--bg-secondary)] px-2 py-1 rounded border border-[var(--border-primary)]">ESC</kbd>
                </div>

                <div className="overflow-y-auto max-h-[60vh] custom-scrollbar" ref={listRef}>
                    {query.trim() === '' ? (
                        <div className="px-4 py-6">
                            {saved.length > 0 ? (
                                <>
                                    <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">Cerques desades</div>
                                    <div className="flex flex-wrap gap-2">
                                        {saved.map((s) => (
                                            <span key={s.query} className="group inline-flex items-center gap-1.5 rounded-full border border-[var(--border-primary)] bg-[var(--bg-secondary)] py-1 pl-3 pr-1.5 text-sm">
                                                <button className="text-[var(--text-secondary)] hover:text-[var(--gnosi-primary)]" onClick={() => setQuery(s.query)}>{s.label}</button>
                                                <button className="rounded-full p-0.5 text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--gnosi-danger,#dc2626)]" onClick={() => removeSaved(s.query)} title="Treu">
                                                    <X size={12} />
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                </>
                            ) : (
                                <div className="py-6 text-center text-[var(--text-secondary)] text-sm">
                                    Cerca per títol o amb operadors: <code className="text-[var(--gnosi-primary)]">tag:</code> <code className="text-[var(--gnosi-primary)]">path:</code> <code className="text-[var(--gnosi-primary)]">title:</code> <code className="text-[var(--gnosi-primary)]">/regex/</code>
                                </div>
                            )}
                        </div>
                    ) : filteredNotes.length === 0 ? (
                        <div className="px-6 py-12 text-center text-[var(--text-secondary)] text-sm">No s'ha trobat cap resultat per "{query}"</div>
                    ) : (
                        <div className="p-2 space-y-1">
                            {filteredNotes.map((note, index) => {
                                const isSelected = index === selectedIndex;
                                return (
                                    <button
                                        key={note.id}
                                        onClick={() => { onNoteSelect(note.id, note.folder); onClose(); }}
                                        onMouseEnter={() => setSelectedIndex(index)}
                                        className={`w-full flex items-center justify-between p-3 rounded-lg text-left transition-colors ${isSelected ? 'bg-[var(--gnosi-primary)]/10' : 'hover:bg-[var(--bg-secondary)]'}`}
                                    >
                                        <div className="flex items-center gap-3">
                                            {note.metadata?.icon ? (
                                                <IconRenderer icon={note.metadata.icon} size={16} className="shrink-0" />
                                            ) : getIcon(note.folder)}
                                            <div>
                                                <h3 className={`text-sm font-medium ${isSelected ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-primary)]'}`}>
                                                    {note.title || note.id || 'Sense Títol'}
                                                </h3>
                                                <div className="flex items-center gap-2 mt-0.5 opacity-70">
                                                    <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">{note.folder}</span>
                                                    {noteTags(note).slice(0, 3).map((tg) => (
                                                        <span key={tg} className="text-[11px] text-[var(--text-tertiary)]">#{tg}</span>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
