import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, FileText, Hash, FolderClosed, Star, X, Database } from 'lucide-react';
import { isCalendarPage } from './schemaUtils';
import { normalizeForSearch } from '../../utils/vaultFilters';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { IconRenderer } from './IconRenderer';

/**
 * Global search with Obsidian-style operators + saved searches.
 * Supported operators (combinable): `tag:a/b` (hierarchical, matches descendants),
 * `path:Folder`, `title:text`, `is:database`, and regex with `/pattern/flags`.
 * Free terms match the title. Searches are saved to localStorage.
 */

const SAVED_KEY = 'gnosi.savedSearches';
const loadSaved = () => {
    try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]'); } catch { return []; }
};
const persistSaved = (list) => {
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(list.slice(0, 20))); } catch { /* noop */ }
};

const splitTags = (raw) => {
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : String(raw).split(',');
    // normalizeForSearch (lowercase + accent-stripped) and not plain toLowerCase:
    // this way `tag:etica` finds "Ètica", consistent with the rest of the search.
    return arr.map((t) => normalizeForSearch(String(t).replace(/^#/, '').trim())).filter(Boolean);
};

// Semantic tags field of a table — mirrors option_catalogs.find_role_prop
// (backend): explicit role `config.role === 'tags'`, or, if there isn't one, a heuristic based on
// NAME (tags/tag/etiquetes/etiquetas/labels, normalized without accents) restricted
// on multi_select. It's the same source that feeds the Tags page
// (/api/vault/tags), so the search's `tag:` sees the same tags that it does.
const TAG_FIELD_NAMES = new Set(['tags', 'tag', 'etiquetes', 'etiquetas', 'labels']);
const findTagsField = (table) => {
    const props = table?.properties || [];
    const explicit = props.find((p) => String(p?.config?.role || '').trim().toLowerCase() === 'tags');
    if (explicit) return explicit;
    return props.find((p) => TAG_FIELD_NAMES.has(normalizeForSearch(p?.name)) && p?.type === 'multi_select') || null;
};

// Tags of a note: `tags` frontmatter (Obsidian style) + the value of the
// semantic tags field of its table (the two sources that the Tags page unifies
// ). Previously only `metadata.tags` (lowercase key) was read, so
// `tag:` NEVER matched tables imported from Notion (the "Tags" field).
const noteTags = (note, tagFieldsByTable) => {
    const meta = note?.metadata || {};
    const tags = splitTags(meta.tags);
    const tableId = note?.resolved_table_id || meta.table_id || meta.database_table_id;
    const field = tableId ? tagFieldsByTable?.get(String(tableId)) : null;
    if (field) {
        let raw = field.id != null ? meta[field.id] : undefined;
        if (raw === undefined || raw === null) raw = field.name ? meta[field.name] : undefined;
        tags.push(...splitTags(raw));
    }
    return tags;
};

// Parseja la consulta en operadors + termes lliures + regex opcional.
const parseQuery = (query) => {
    const tokens = String(query).trim().split(/\s+/).filter(Boolean);
    const ops = { tag: [], path: [], title: [], is: [] };
    const terms = [];
    let regex = null;
    for (const tok of tokens) {
        const reMatch = tok.match(/^\/(.+)\/([a-z]*)$/i);
        if (reMatch) { try { regex = new RegExp(reMatch[1], reMatch[2] || 'i'); } catch { /* invalid regex: ignore */ } continue; }
        const opMatch = tok.match(/^(tag|path|title|is):(.+)$/i);
        if (opMatch) { ops[opMatch[1].toLowerCase()].push(opMatch[2].toLowerCase()); continue; }
        terms.push(tok);
    }
    return { ops, terms, regex };
};

const matchNote = (note, parsed, tagFieldsByTable) => {
    const { ops, terms, regex } = parsed;
    const title = note.title || '';
    const titleNorm = normalizeForSearch(title);
    const folder = String(note.folder || note.path || '').toLowerCase();
    const tags = noteTags(note, tagFieldsByTable);

    // tag: (hierarchical — matches the exact tag or any descendant a/b/c).
    // The operator's value is also normalized (accents stripped), like the tags.
    for (const tg of ops.tag) {
        const tgn = normalizeForSearch(tg);
        if (!tags.some((t) => t === tgn || t.startsWith(tgn + '/'))) return false;
    }
    for (const p of ops.path) { if (!folder.includes(p)) return false; }
    for (const tt of ops.title) { if (!normalizeForSearch(title).includes(normalizeForSearch(tt))) return false; }
    for (const isv of ops.is) {
        if (isv === 'database' && !note.is_database) return false;
        if (isv === 'page' && note.is_database) return false;
    }
    if (regex && !(regex.test(title) || regex.test(folder))) return false;
    // Free terms: match the title (or tag; tags already come normalized).
    for (const term of terms) {
        const tn = normalizeForSearch(term);
        if (!titleNorm.includes(tn) && !tags.some((t) => t.includes(tn))) return false;
    }
    return true;
};

export function GlobalSearchModal({ isOpen, onClose, allNotes = [], onNoteSelect, tables = [] }) {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [saved, setSaved] = useState(loadSaved);
    const inputRef = useRef(null);
    const listRef = useRef(null);
    const panelRef = useRef(null);

    useModalKeyboard({ isOpen, onClose, containerRef: panelRef, trapFocus: true });

    // Tag field per table, resolved once (O(tables), not O(notes)).
    const tagFieldsByTable = React.useMemo(() => {
        const m = new Map();
        (tables || []).forEach((t) => {
            const f = findTagsField(t);
            if (f && t?.id != null) m.set(String(t.id), f);
        });
        return m;
    }, [tables]);

    const filteredNotes = React.useMemo(() => {
        if (!query.trim()) return [];
        const parsed = parseQuery(query);
        return allNotes.filter((note) => {
            if (isCalendarPage(note)) return false;
            return matchNote(note, parsed, tagFieldsByTable);
        }).slice(0, 30);
    }, [query, allNotes, tagFieldsByTable]);

    // Title of a row's source DB. Three paths, in order of reliability:
    // 1) resolved_table_id → name in the table registry; 2) ancestor with
    // is_database (wiki DB-pages); 3) last segment of the BD/… folder (the
    // DB rows have null parent_id and their table_id might not be in the registry).
    const getSourceDbTitle = React.useMemo(() => {
        const byId = new Map(allNotes.map((n) => [n.id, n]));
        const tableNameById = new Map((tables || []).map((t) => [t.id, t.name]));
        return (note) => {
            const rawTableId = note?.resolved_table_id || note?.metadata?.table_id || note?.metadata?.database_table_id;
            const tableId = String(rawTableId || '').toLowerCase() === 'wiki' ? null : rawTableId;
            if (tableId && tableNameById.has(tableId)) return tableNameById.get(tableId);

            let current = note;
            for (let hop = 0; hop < 8; hop += 1) {
                const parentId = current?.parent_id;
                if (!parentId) break;
                const parent = byId.get(parentId);
                if (!parent || parent.id === current.id) break;
                if (parent.is_database) return parent.title || null;
                current = parent;
            }

            const folder = String(note?.folder || '');
            if (/^BD\//i.test(folder)) {
                const segments = folder.split('/').filter(Boolean);
                if (segments.length > 1) return segments[1];
            }
            return null;
        };
    }, [allNotes, tables]);

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

    // Clicking outside must not discard an in-progress query: only close on a
    // backdrop click when the input is empty. With text present, Esc (or an
    // explicit close/selection) is required to dismiss the modal.
    const handleBackdropClick = () => {
        if (query.length > 0) return;
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[150] flex items-start justify-center pt-[15vh] px-4 sm:p-0">
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={handleBackdropClick}></div>

            <div ref={panelRef} className="relative bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col font-sans border border-[var(--border-primary)]">
                <div className="flex items-center px-4 py-3 border-b border-[var(--border-primary)]">
                    <Search size={20} className="text-[var(--text-tertiary)] shrink-0" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={t('globalsearch.search_placeholder', "Search…  tag:a/b  path:Folder  title:text  /regex/")}
                        className="w-full bg-transparent border-none focus:ring-0 text-lg px-3 py-1 outline-none text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
                    />
                    {query.trim() && (
                        <button
                            onClick={saveCurrent}
                            title={isSaved ? t('globalsearch.search_saved', "Search saved") : t('globalsearch.save_search', "Save this search")}
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
                                    <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">{t('globalsearch.saved_searches_heading', "Saved searches")}</div>
                                    <div className="flex flex-wrap gap-2">
                                        {saved.map((s) => (
                                            <span key={s.query} className="group inline-flex items-center gap-1.5 rounded-full border border-[var(--border-primary)] bg-[var(--bg-secondary)] py-1 pl-3 pr-1.5 text-sm">
                                                <button className="text-[var(--text-secondary)] hover:text-[var(--gnosi-primary)]" onClick={() => setQuery(s.query)}>{s.label}</button>
                                                <button className="rounded-full p-0.5 text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--gnosi-danger,#dc2626)]" onClick={() => removeSaved(s.query)} title={t('globalsearch.remove_saved', "Remove")}>
                                                    <X size={12} />
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                </>
                            ) : (
                                <div className="py-6 text-center text-[var(--text-secondary)] text-sm">
                                    {t('globalsearch.operators_hint', "Search by title or with operators:")} <code className="text-[var(--gnosi-primary)]">tag:</code> <code className="text-[var(--gnosi-primary)]">path:</code> <code className="text-[var(--gnosi-primary)]">title:</code> <code className="text-[var(--gnosi-primary)]">/regex/</code>
                                </div>
                            )}
                        </div>
                    ) : filteredNotes.length === 0 ? (
                        <div className="px-6 py-12 text-center text-[var(--text-secondary)] text-sm">{t('globalsearch.no_results', "No results found for \"{{query}}\"", { query })}</div>
                    ) : (
                        <div className="p-2 space-y-1">
                            {filteredNotes.map((note, index) => {
                                const isSelected = index === selectedIndex;
                                const sourceDb = getSourceDbTitle(note);
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
                                                    {note.title || note.id || t('common.untitled', "Untitled")}
                                                </h3>
                                                <div className="flex items-center gap-2 mt-0.5 opacity-70">
                                                    {sourceDb ? (
                                                        <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
                                                            <Database size={10} className="shrink-0" />
                                                            {sourceDb}
                                                        </span>
                                                    ) : (
                                                        <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">{note.folder}</span>
                                                    )}
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
