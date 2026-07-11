import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { X, Folder, ChevronRight, ArrowLeft, Home, Search, File as FileIcon } from 'lucide-react';
import { useModalKeyboard } from '../hooks/useModalKeyboard';
import { useTranslation } from 'react-i18next';

const joinPath = (...parts) => parts.filter(Boolean).join('/').replace(/\/+/g, '/');

/**
 * File system browser modal (folders + files).
 *
 * Props:
 *   - isOpen, onClose: visibility control.
 *   - mode: 'folder' (default), 'file', or 'any'.
 *       * 'folder': shows only folders; the "Select" button at the bottom returns
 *         the current folder.
 *       * 'file': shows folders and files; clicking a file returns its
 *         path.
 *       * 'any': shows folders and files; clicking a file returns it and the
 *         bottom button returns the current folder. Used to link both
 *         files and folders.
 *   - onSelect(absoluteHostPath, { isDir }): the returned path is always the
 *     HOST one (the one Finder sees), not the path mapped inside Docker. The
 *     second argument indicates whether it's a folder (always false in 'file' mode,
 *     always true in 'folder' mode).
 *   - initialPath: path to start at (internal or host).
 *   - initialQuery: text to pre-fill the search with on open. Useful when
 *     the file name is already known (e.g. the user has dragged a file and
 *     now needs to locate it on disk because the browser doesn't provide its path).
 */
export function FilesystemPickerModal({ isOpen, onClose, onSelect, initialPath = '', mode = 'folder', initialQuery = '' }) {
    const { t } = useTranslation();
    const tn = useCallback((k, opts) => t('fs_picker.' + k, opts), [t]);
    const [currentPath, setCurrentPath] = useState(initialPath || '');
    const [displayPath, setDisplayPath] = useState('');
    const [directories, setDirectories] = useState([]);
    const [files, setFiles] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    // Global search results. `null` = not currently searching (browse mode).
    const [searchResults, setSearchResults] = useState(null);
    const [searchTruncated, setSearchTruncated] = useState(false);
    // Index of the highlighted element in the list (folders/files or search
    // results). Shared by keyboard (↑↓) and mouse (hover), same as the
    // canonical MultiSelectPills pattern: a single `highlightedIndex` for both.
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const modalRef = useRef(null);
    // Scrollable container for the list (role="listbox"): receives focus and the
    // arrows; keeps focus when entering/leaving folders, so navigation
    // with the keyboard isn't interrupted. aria-activedescendant pattern.
    const listRef = useRef(null);
    // Refs to each rendered option, to scrollIntoView the highlighted one.
    const itemRefs = useRef([]);

    useEffect(() => {
        if (!isOpen) return;
        void browse(initialPath || currentPath || '');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, initialPath]);

    // On opening, pre-fills the search with `initialQuery` (if present). The
    // debounced search useEffect already takes care of firing the query.
    useEffect(() => {
        if (isOpen) setSearchQuery(initialQuery || '');
    }, [isOpen, initialQuery]);

    // Navigation picker with no single primary action (in 'file' mode it's
    // selected by clicking a file in the list; in 'folder'/'any' mode the bottom
    // button). That's why it's ONLY Esc + focus-trap, without onConfirm. The hook listens in
    // CAPTURE on window (overrides BlockNote/ProseMirror's stopPropagation).
    useModalKeyboard({
        isOpen,
        onClose,
        containerRef: modalRef,
        trapFocus: true,
    });

    // Global search across the whole disk with debounce. If the query is short (<2 chars)
    // we go back to browse mode and show the current directory.
    useEffect(() => {
        if (!isOpen) return;
        const q = searchQuery.trim();
        if (q.length < 2) {
            setSearchResults(null);
            setSearchTruncated(false);
            return;
        }
        const handle = setTimeout(async () => {
            setLoading(true);
            try {
                const res = await fetch('/api/system/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: q, limit: 200 }),
                });
                const data = await res.json();
                if (data.error) {
                    setError(data.error);
                }
                setSearchResults(Array.isArray(data.results) ? data.results : []);
                setSearchTruncated(!!data.truncated);
            } catch {
                setError(tn('connection_error'));
                setSearchResults([]);
            } finally {
                setLoading(false);
            }
        }, 300);
        return () => clearTimeout(handle);
    }, [isOpen, searchQuery, tn]);

    // When changing folder or search results, re-highlights the
    // first element (or none, if the list is empty). This way ↑↓ and Enter always
    // have a consistent starting point.
    useEffect(() => {
        const showFilesNow = mode === 'file' || mode === 'any';
        const count = searchResults !== null
            ? searchResults.filter((it) => showFilesNow || it.is_dir).length
            : directories.length + (showFilesNow ? files.length : 0);
        setHighlightedIndex(count > 0 ? 0 : -1);
    }, [currentPath, searchResults, directories, files, mode]);

    // Keeps the highlighted element visible when navigating with the keyboard.
    useEffect(() => {
        if (highlightedIndex < 0) return;
        const el = itemRefs.current[highlightedIndex];
        if (el && typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ block: 'nearest' });
        }
    }, [highlightedIndex]);

    const browse = async (path) => {
        setLoading(true);
        setError('');
        try {
            const res = await fetch('/api/system/browse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path }),
            });
            const data = await res.json();
            if (data.error) {
                setError(data.error);
                if (data.display_path) setDisplayPath(data.display_path);
                if (data.current_path) setCurrentPath(data.current_path);
            } else {
                setCurrentPath(data.current_path);
                setDisplayPath(data.display_path || data.current_path);
                setDirectories(data.directories || []);
                setFiles(data.files || []);
            }
        } catch {
            setError(tn('connection_error'));
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    // 'file' and 'any' show files; 'folder' and 'any' allow returning the
    // current folder with the bottom button.
    const showFiles = mode === 'file' || mode === 'any';
    const canPickFolder = mode === 'folder' || mode === 'any';

    const isSearching = searchResults !== null;
    const visibleDirectories = isSearching ? [] : directories;
    const visibleFiles = isSearching ? [] : (showFiles ? files : []);

    const titleText = mode === 'any'
        ? tn('title_any')
        : (mode === 'file' ? tn('title_file') : tn('title_folder'));
    const searchPlaceholder = mode === 'folder'
        ? tn('search_folders_placeholder')
        : tn('search_placeholder');

    const handleSelectFile = (filename) => {
        const hostPath = joinPath(displayPath || currentPath, filename);
        onSelect(hostPath, { isDir: false });
    };

    const handleSelectCurrentFolder = () => {
        onSelect(displayPath || currentPath, { isDir: true });
    };

    // Search result: if it's a folder, navigate into it (you need to enter it to
    // select it with the bottom button); if it's a file and the mode shows
    // files, select it.
    const handleSearchResultClick = (item) => {
        if (item.is_dir) {
            setSearchQuery('');
            void browse(item.path);
        } else if (showFiles) {
            onSelect(item.path, { isDir: false });
        }
    };

    // ── Keyboard navigation ──
    // Flat, sorted list of everything that can be selected right now. A
    // single array so that the highlighted index (↑↓) and the refs match what is
    // renders, both in search mode and browse mode.
    const visibleSearchResults = isSearching
        ? searchResults.filter((it) => showFiles || it.is_dir)
        : [];
    const items = isSearching
        ? visibleSearchResults.map((data) => ({ kind: 'search', data }))
        : [
            ...visibleDirectories.map((name) => ({ kind: 'dir', name })),
            ...visibleFiles.map((name) => ({ kind: 'file', name })),
        ];
    const itemCount = items.length;
    const optionId = (i) => `fp-opt-${i}`;

    const goUp = () => void browse(joinPath(currentPath, '..'));

    // Opens/selects the item at `index`: folder → enters it; file → the
    // returned; search result → delegates to its handler (which already distinguishes).
    const activate = (index) => {
        const it = items[index];
        if (!it) return;
        if (it.kind === 'search') handleSearchResultClick(it.data);
        else if (it.kind === 'dir') void browse(joinPath(currentPath, it.name));
        else handleSelectFile(it.name);
    };

    const moveHighlight = (delta) => {
        if (itemCount === 0) return;
        setHighlightedIndex((i) => {
            const base = i < 0 ? (delta > 0 ? -1 : 0) : i;
            return Math.max(0, Math.min(itemCount - 1, base + delta));
        });
    };

    // Keys inside the list (role="listbox" container). Focus lives there, so
    // ↑↓ aren't lost when entering/leaving folders.
    const handleListKeyDown = (e) => {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                moveHighlight(1);
                break;
            case 'ArrowUp':
                e.preventDefault();
                moveHighlight(-1);
                break;
            case 'Home':
                e.preventDefault();
                setHighlightedIndex(itemCount > 0 ? 0 : -1);
                break;
            case 'End':
                e.preventDefault();
                setHighlightedIndex(itemCount - 1);
                break;
            case 'Enter':
                if (highlightedIndex >= 0) {
                    e.preventDefault();
                    activate(highlightedIndex);
                }
                break;
            // → only enters folders (doesn't select files, which would be unexpected).
            case 'ArrowRight': {
                const it = items[highlightedIndex];
                if (it && (it.kind === 'dir' || (it.kind === 'search' && it.data.is_dir))) {
                    e.preventDefault();
                    activate(highlightedIndex);
                }
                break;
            }
            // "Go back": goes up one level. Inside the list, no text is typed,
            // so ⌫ and ← are safe for this shortcut (Finder style).
            case 'Backspace':
            case 'ArrowLeft':
                e.preventDefault();
                goUp();
                break;
            default:
                break;
        }
    };

    // Keys inside the search box. ↓ moves down into the list; Enter opens the highlighted item;
    // ⌫ with an empty field goes up one level (never interferes while typing).
    const handleSearchKeyDown = (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (itemCount > 0) {
                setHighlightedIndex((i) => (i < 0 ? 0 : i));
                listRef.current?.focus();
            }
        } else if (e.key === 'Enter') {
            if (itemCount > 0) {
                e.preventDefault();
                activate(highlightedIndex >= 0 ? highlightedIndex : 0);
            }
        } else if (e.key === 'Backspace' && searchQuery === '') {
            e.preventDefault();
            goUp();
        }
    };

    const modalContent = (
        <div
            className="fixed inset-0 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            style={{ zIndex: 10010 }}
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                ref={modalRef}
                className="bg-[var(--bg-primary)] text-[var(--text-primary)] border border-[var(--border-primary)]"
                style={{
                    maxWidth: '560px', width: '100%', height: '660px',
                    display: 'flex', flexDirection: 'column', overflow: 'hidden',
                    borderRadius: '10px',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
                }}
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div
                    className="bg-[var(--bg-secondary)] border-b border-[var(--border-primary)]"
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px' }}
                >
                    <h2 className="text-[var(--text-primary)]" style={{ margin: 0, fontSize: '1.05em', fontWeight: 700 }}>
                        {mode === 'any' ? '🗂️' : (mode === 'file' ? '📄' : '📁')} {titleText}
                    </h2>
                    <button
                        onClick={onClose}
                        aria-label={tn('close')}
                        className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex' }}
                    >
                        <X size={18} />
                    </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                    {/* Path Bar */}
                    <div
                        className="bg-[var(--bg-secondary)] border-b border-[var(--border-primary)]"
                        style={{ padding: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                            <div className="text-[var(--text-tertiary)]" style={{ fontSize: '0.7rem', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{tn('real_path')}</div>
                            <div
                                className="bg-[var(--bg-primary)] border border-[var(--border-primary)] text-[var(--gnosi-primary)]"
                                style={{ fontSize: '0.85em', wordBreak: 'break-all', padding: '8px 10px', borderRadius: '4px', fontFamily: 'monospace', lineHeight: '1.4' }}
                            >
                                {displayPath || currentPath || '—'}
                            </div>
                        </div>
                        <button
                            onClick={goUp}
                            title={tn('go_up_tip')}
                            aria-label={tn('go_up_aria')}
                            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-primary)] hover:bg-[var(--bg-primary)]"
                            style={{ background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 10px', borderRadius: '6px', fontSize: '0.82rem', whiteSpace: 'nowrap' }}
                        >
                            <ArrowLeft size={15} /> {tn('up')}
                        </button>
                    </div>

                    {/* Shortcuts */}
                    <div
                        className="bg-[var(--bg-primary)] border-b border-[var(--border-primary)]"
                        style={{ padding: '8px 12px', display: 'flex', gap: '12px', alignItems: 'center' }}
                    >
                        <span className="text-[var(--text-tertiary)]" style={{ fontSize: '0.75rem', fontWeight: 500, textTransform: 'uppercase' }}>{tn('shortcuts')}</span>
                        <button
                            onClick={() => browse('/vault')}
                            className="text-[var(--gnosi-primary)] hover:underline"
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '0.85rem' }}
                        >
                            <Home size={14} /> {tn('vault')}
                        </button>
                        <button
                            onClick={() => browse('/Users/ismaelgarciafernandez')}
                            className="hover:underline"
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'transparent', border: 'none', cursor: 'pointer', color: '#a78bfa', fontSize: '0.85rem' }}
                        >
                            <Folder size={14} /> {tn('home')}
                        </button>
                        <button
                            onClick={() => browse('/')}
                            className="hover:underline"
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'transparent', border: 'none', cursor: 'pointer', color: '#f43f5e', fontSize: '0.85rem' }}
                        >
                            <Folder size={14} /> {tn('root')}
                        </button>
                    </div>

                    {/* Search */}
                    <div style={{ padding: '10px 12px', position: 'relative' }}>
                        <Search size={14} className="text-[var(--text-tertiary)]" style={{ position: 'absolute', left: '20px', top: '18px' }} />
                        <input
                            type="text"
                            data-autofocus
                            placeholder={searchPlaceholder}
                            aria-label={searchPlaceholder}
                            className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)]"
                            style={{ width: '100%', padding: '6px 12px 6px 30px', borderRadius: '6px', fontSize: '0.9em' }}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={handleSearchKeyDown}
                        />
                    </div>

                    {/* List (role="listbox": focus lives there and the arrow keys navigate it) */}
                    <div
                        ref={listRef}
                        role="listbox"
                        tabIndex={0}
                        aria-label={tn('list_aria')}
                        aria-activedescendant={highlightedIndex >= 0 ? optionId(highlightedIndex) : undefined}
                        onKeyDown={handleListKeyDown}
                        className="bg-[var(--bg-primary)]"
                        style={{ flex: 1, overflowY: 'auto', padding: '10px', outline: 'none' }}
                    >
                        {loading ? (
                            <div className="text-[var(--text-tertiary)]" style={{ textAlign: 'center', padding: '40px' }}>
                                {isSearching ? tn('searching') : tn('loading')}
                            </div>
                        ) : error ? (
                            <div style={{ color: '#ef4444', padding: '20px', textAlign: 'center' }}>{error}</div>
                        ) : itemCount === 0 ? (
                            <div className="text-[var(--text-tertiary)]" style={{ textAlign: 'center', padding: '20px', fontSize: '0.9em' }}>
                                {isSearching
                                    ? tn('no_results', { query: searchQuery })
                                    : (showFiles ? tn('no_files_folders') : tn('no_folders'))}
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                {items.map((it, i) => {
                                    const active = i === highlightedIndex;
                                    const isDir = it.kind === 'dir' || (it.kind === 'search' && it.data.is_dir);
                                    const name = it.kind === 'search' ? it.data.name : it.name;
                                    const key = it.kind === 'search'
                                        ? `s:${it.data.is_dir ? 'd' : 'f'}:${it.data.path}`
                                        : `${it.kind === 'dir' ? 'd' : 'f'}:${it.name}`;
                                    return (
                                        <div
                                            key={key}
                                            id={optionId(i)}
                                            role="option"
                                            aria-selected={active}
                                            ref={(el) => { itemRefs.current[i] = el; }}
                                            onClick={() => activate(i)}
                                            onMouseEnter={() => setHighlightedIndex(i)}
                                            className="text-[var(--text-primary)]"
                                            style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: active ? 'var(--bg-secondary)' : 'transparent', cursor: 'pointer', borderRadius: '6px', textAlign: 'left', width: '100%' }}
                                        >
                                            {isDir
                                                ? <Folder size={18} className="text-[var(--gnosi-primary)]" />
                                                : <FileIcon size={18} className="text-[var(--text-secondary)]" />}
                                            {it.kind === 'search' ? (
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                                                    <div className="text-[var(--text-tertiary)]" style={{ fontSize: '0.72rem', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {it.data.path}
                                                    </div>
                                                </div>
                                            ) : (
                                                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                                            )}
                                            {isDir && (
                                                <ChevronRight size={14} className="text-[var(--text-tertiary)]" />
                                            )}
                                        </div>
                                    );
                                })}
                                {isSearching && searchTruncated && (
                                    <div className="text-[var(--text-tertiary)]" style={{ textAlign: 'center', padding: '10px', fontSize: '0.78rem', fontStyle: 'italic' }}>
                                        {tn('too_many')}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div
                        className="bg-[var(--bg-secondary)] border-t border-[var(--border-primary)]"
                        style={{ padding: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexShrink: 0 }}
                    >
                        <span
                            className="text-[var(--text-tertiary)]"
                            style={{ fontSize: '0.72rem', lineHeight: 1.4 }}
                        >
                            {tn('keyboard_hints')}
                        </span>
                        <div style={{ display: 'flex', gap: '10px', flexShrink: 0 }}>
                            <button
                                onClick={onClose}
                                className="text-[var(--text-primary)] border border-[var(--border-primary)] hover:bg-[var(--bg-primary)]"
                                style={{ padding: '8px 16px', borderRadius: '6px', background: 'transparent', cursor: 'pointer' }}
                            >
                                {t('common.cancel')}
                            </button>
                            {canPickFolder && (
                                <button
                                    onClick={handleSelectCurrentFolder}
                                    className="btn-gnosi btn-gnosi-primary"
                                    style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontWeight: 500 }}
                                >
                                    {tn('select_this_folder')}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    return ReactDOM.createPortal(modalContent, document.body);
}
