import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { X, Folder, ChevronRight, ArrowLeft, Home, Search, File as FileIcon, FolderOpen } from 'lucide-react';
import { useModalKeyboard } from '../hooks/useModalKeyboard';
import { useTranslation } from 'react-i18next';
import { transportFetch } from '../shared/api/transports';

const joinPath = (...parts) => parts.filter(Boolean).join('/').replace(/\/+/g, '/');

// Last folder the user visited in the picker, persisted so that inserting
// several files from the same location doesn't require re-navigating there on
// every open. Shared across all picker instances (insert content, rich links,
// file fields…). localStorage can throw (private mode, disabled storage), so
// access is wrapped and the picker just falls back to the default start.
const LAST_PATH_KEY = 'gnosi.fsPicker.lastPath';
const readLastPath = () => {
    try { return localStorage.getItem(LAST_PATH_KEY) || ''; } catch { return ''; }
};
const saveLastPath = (path) => {
    try { if (path) localStorage.setItem(LAST_PATH_KEY, path); } catch { /* best-effort */ }
};

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
 *   - onSelectMany(entries[]): optional; each entry is { path, isDir }. When
 *     provided (and the mode shows files), the picker turns multi-select:
 *     clicking a file toggles it
 *     into a checked set instead of returning immediately, and the footer
 *     confirms the whole batch. The set survives folder navigation, so files
 *     can be gathered from several folders in one go. Double-clicking a file
 *     still returns it alone through `onSelect` (single-pick shortcut).
 *   - preferNative: when the OS panel is available, open it straight away
 *     instead of making the user click through the in-app browser first. The
 *     in-app browser stays mounted underneath: cancelling the panel lands
 *     there, which is also the fallback whenever the panel isn't available
 *     (no host helper: Docker, remote access) or when disk-wide Spotlight
 *     search is what the user actually needs.
 *   - initialPath: path to start at (internal or host).
 *   - initialQuery: text to pre-fill the search with on open. Useful when
 *     the file name is already known (e.g. the user has dragged a file and
 *     now needs to locate it on disk because the browser doesn't provide its path).
 */
export function FilesystemPickerModal({ isOpen, onClose, onSelect, onSelectMany = null, initialPath = '', mode = 'folder', initialQuery = '', preferNative = true }) {
    const { t } = useTranslation();
    const tn = useCallback((k, opts) => t('fs_picker.' + k, opts), [t]);
    // Localize a backend error: prefer the i18n message keyed by `error_code`,
    // falling back to the raw English `error` string for anything unmapped.
    const localizeError = useCallback(
        (data) => (data.error_code ? tn('errors.' + data.error_code, data.error) : data.error),
        [tn],
    );
    // Explicit initialPath wins; otherwise resume at the last visited folder.
    const [currentPath, setCurrentPath] = useState(initialPath || readLastPath());
    const [displayPath, setDisplayPath] = useState('');
    const [directories, setDirectories] = useState([]);
    const [files, setFiles] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    // Global search results. `null` = not currently searching (browse mode).
    const [searchResults, setSearchResults] = useState(null);
    const [searchTruncated, setSearchTruncated] = useState(false);
    // Shortcut targets resolved by the backend (active vault, current user's
    // home, root). `null` until the first browse response. Not hardcoded so the
    // Vault shortcut follows the ACTIVE vault and Home follows the real user.
    const [roots, setRoots] = useState(null);
    // Index of the highlighted element in the list (folders/files or search
    // results). Shared by keyboard (↑↓) and mouse (hover), same as the
    // canonical MultiSelectPills pattern: a single `highlightedIndex` for both.
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    // Multi-select basket (only when `onSelectMany` is provided). Keyed by host
    // path so the same file can't be added twice, and kept across folder
    // navigation and searches so a batch can be gathered from several places.
    const [checkedPaths, setCheckedPaths] = useState([]);
    // Progressive enhancement: when the browser and backend are on the same Mac
    // and the host helper is up, offer the OS-native open dialog (which returns
    // a real host path the browser itself can't). `false` keeps just the in-app
    // picker. `nativePicking` is true while the native dialog is open on screen.
    const [nativeAvailable, setNativeAvailable] = useState(false);
    const [nativePicking, setNativePicking] = useState(false);
    // Kept apart from `error`, which owns the list area: a failing OS panel says
    // nothing about the browsable listing, and blanking the list would strand
    // the user with no way to pick anything — the in-app browser IS the
    // fallback for a panel that won't open.
    const [nativeError, setNativeError] = useState('');
    const modalRef = useRef(null);
    // Scrollable container for the list (role="listbox"): receives focus and the
    // arrows; keeps focus when entering/leaving folders, so navigation
    // with the keyboard isn't interrupted. aria-activedescendant pattern.
    const listRef = useRef(null);
    // Refs to each rendered option, to scrollIntoView the highlighted one.
    const itemRefs = useRef([]);

    useEffect(() => {
        if (!isOpen) return;
        const startPath = initialPath || currentPath || '';
        void (async () => {
            const ok = await browse(startPath);
            // The remembered folder can vanish between sessions (deleted,
            // unmounted disk, Docker↔native path change): fall back to the
            // default start (active vault) instead of opening onto an error.
            if (!ok && !initialPath && startPath) await browse('');
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, initialPath]);

    // Probe native-dialog availability once per open (loopback + helper up),
    // in parallel with the first browse. Failure just leaves the button hidden.
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        void (async () => {
            try {
                const res = await transportFetch('/api/system/native-pick/available');
                const data = await res.json();
                if (!cancelled) setNativeAvailable(!!data.available);
            } catch {
                if (!cancelled) setNativeAvailable(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isOpen]);

    // Latest handleNativePick, which is defined below the `isOpen` early return
    // and so can't be called from an effect directly.
    const nativePickRef = useRef(null);
    // Auto-open the OS panel once per opening. `autoNativeDone` also gates the
    // retry: after cancelling, the user is left in the in-app browser instead of
    // having the panel thrown at them again.
    const [autoNativeDone, setAutoNativeDone] = useState(false);
    useEffect(() => {
        if (!isOpen) { setAutoNativeDone(false); return; }
        if (!preferNative || !nativeAvailable || autoNativeDone) return;
        // A pre-filled search means the caller already knows the name and wants
        // the in-app index to locate it (a dragged file); opening the OS panel
        // over that would throw away the hint.
        if (initialQuery) return;
        setAutoNativeDone(true);
        void nativePickRef.current?.();
    }, [isOpen, preferNative, nativeAvailable, autoNativeDone, initialQuery]);

    // On opening, pre-fills the search with `initialQuery` (if present). The
    // debounced search useEffect already takes care of firing the query.
    useEffect(() => {
        if (isOpen) setSearchQuery(initialQuery || '');
    }, [isOpen, initialQuery]);

    // A closed picker must not remember the previous batch: reopening it starts
    // from an empty basket (the remembered FOLDER is intentional, the selection
    // isn't).
    useEffect(() => {
        if (!isOpen) setCheckedPaths([]);
    }, [isOpen]);

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
                const res = await transportFetch('/api/system/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: q, limit: 200 }),
                });
                const data = await res.json();
                if (data.error) {
                    setError(localizeError(data));
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
    }, [isOpen, searchQuery, tn, localizeError]);

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
            const res = await transportFetch('/api/system/browse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path }),
            });
            const data = await res.json();
            // The backend returns `roots` on every response (success or error),
            // so keep the shortcuts populated even when the initial path is bad.
            if (data.roots) setRoots(data.roots);
            if (data.error) {
                setError(localizeError(data));
                if (data.display_path) setDisplayPath(data.display_path);
                if (data.current_path) setCurrentPath(data.current_path);
                return false;
            }
            setCurrentPath(data.current_path);
            setDisplayPath(data.display_path || data.current_path);
            setDirectories(data.directories || []);
            setFiles(data.files || []);
            saveLastPath(data.current_path);
            return true;
        } catch {
            setError(tn('connection_error'));
            return false;
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

    // Multi-select is opt-in (a consumer that can't handle a batch simply
    // doesn't pass `onSelectMany`) and only makes sense where files are shown.
    const canMulti = showFiles && typeof onSelectMany === 'function';
    const isChecked = (path) => checkedPaths.includes(path);
    const toggleChecked = (path) => {
        setCheckedPaths((prev) => (prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]));
    };

    const handleSelectFile = (filename) => {
        const hostPath = joinPath(displayPath || currentPath, filename);
        if (canMulti) { toggleChecked(hostPath); return; }
        onSelect(hostPath, { isDir: false });
    };

    // Double-click keeps the single-pick shortcut alive in multi mode: it
    // returns just that file instead of forcing check + confirm for one item.
    const handleSelectFileNow = (path) => {
        saveLastPath(path.slice(0, path.lastIndexOf('/')));
        onSelect(path, { isDir: false });
    };

    const handleConfirmMany = () => {
        if (checkedPaths.length === 0) return;
        // Only files can be ticked in the list, so the whole basket is files.
        onSelectMany(checkedPaths.map((path) => ({ path, isDir: false })));
    };

    const handleSelectCurrentFolder = () => {
        onSelect(displayPath || currentPath, { isDir: true });
    };

    // Native OS dialog. Delegates to the host helper (via the backend), which
    // returns a real host path — the same shape onSelect gets from browsing.
    // The panel mirrors this picker's own mode, 'any' included: it is a real
    // NSOpenPanel, which takes "files" and "folders" as independent flags, so
    // one dialog can offer both. When the consumer accepts batches it also
    // opens with multiple selections allowed.
    const handleNativePick = async () => {
        if (nativePicking) return;
        setNativeError('');
        setNativePicking(true);
        try {
            const res = await transportFetch('/api/system/native-pick', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode, prompt: titleText, multiple: canMulti }),
            });
            if (!res.ok) { setNativeError(tn('native_error')); return; }
            const data = await res.json();
            if (data.status !== 'ok' || !data.path) return; // cancelled → stay open
            // Keep the in-app picker's remembered folder in sync with the choice.
            saveLastPath(data.is_dir ? data.path : data.path.slice(0, data.path.lastIndexOf('/')));
            // Several entries chosen in the native panel: hand the whole batch
            // over, same as the in-app confirm. The panel can mix folders and
            // files in one pick, so each entry keeps its own isDir. A single
            // entry stays on the single-pick path, unchanged for other callers.
            const picked = Array.isArray(data.entries) && data.entries.length
                ? data.entries.map((e) => ({ path: e.path, isDir: !!e.is_dir }))
                : [{ path: data.path, isDir: !!data.is_dir }];
            if (canMulti && picked.length > 1) onSelectMany(picked);
            else onSelect(picked[0].path, { isDir: picked[0].isDir });
        } catch {
            setNativeError(tn('native_error'));
        } finally {
            setNativePicking(false);
        }
    };
    nativePickRef.current = handleNativePick;

    // Search result: if it's a folder, navigate into it (you need to enter it to
    // select it with the bottom button); if it's a file and the mode shows
    // files, select it.
    const handleSearchResultClick = (item) => {
        if (item.is_dir) {
            setSearchQuery('');
            void browse(item.path);
        } else if (canMulti) {
            toggleChecked(item.path);
        } else if (showFiles) {
            // Picking straight from search skips browse(), so remember the
            // file's parent folder here (browse accepts host paths too).
            handleSelectFileNow(item.path);
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
    // Host path of a listed FILE (null for folders): search results carry it,
    // browsed entries are joined with the folder currently on screen.
    const itemFilePath = (it) => {
        if (!it) return null;
        if (it.kind === 'file') return joinPath(displayPath || currentPath, it.name);
        if (it.kind === 'search' && !it.data.is_dir) return it.data.path;
        return null;
    };

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
            // Space toggles the highlighted file in/out of the batch, the
            // canonical listbox multi-select key.
            case ' ':
                if (canMulti && itemFilePath(items[highlightedIndex])) {
                    e.preventDefault();
                    toggleChecked(itemFilePath(items[highlightedIndex]));
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
            style={{ zIndex: 'var(--z-modal)' }}
        >
            <div
                ref={modalRef}
                className="bg-[var(--bg-primary)] text-[var(--text-primary)] border border-[var(--border-primary)]"
                role="dialog"
                aria-modal="true"
                aria-label={titleText}
                style={{
                    maxWidth: '560px', width: '100%', height: '660px',
                    display: 'flex', flexDirection: 'column', overflow: 'hidden',
                    borderRadius: '10px',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
                }}
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
                            onClick={() => roots?.vault && browse(roots.vault)}
                            disabled={!roots?.vault}
                            className="text-[var(--gnosi-primary)] hover:underline"
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'transparent', border: 'none', cursor: roots?.vault ? 'pointer' : 'default', opacity: roots?.vault ? 1 : 0.4, fontSize: '0.85rem' }}
                        >
                            <Home size={14} /> {tn('vault')}
                        </button>
                        <button
                            onClick={() => roots?.home && browse(roots.home)}
                            disabled={!roots?.home}
                            className="hover:underline"
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'transparent', border: 'none', cursor: roots?.home ? 'pointer' : 'default', opacity: roots?.home ? 1 : 0.4, color: '#a78bfa', fontSize: '0.85rem' }}
                        >
                            <Folder size={14} /> {tn('home')}
                        </button>
                        <button
                            onClick={() => browse(roots?.root || '/')}
                            className="hover:underline"
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'transparent', border: 'none', cursor: 'pointer', color: '#f43f5e', fontSize: '0.85rem' }}
                        >
                            <Folder size={14} /> {tn('root')}
                        </button>
                        {nativeAvailable && (
                            <button
                                onClick={handleNativePick}
                                disabled={nativePicking}
                                title={tn('native_button_tip')}
                                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-primary)] hover:bg-[var(--bg-secondary)]"
                                style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '5px', background: 'transparent', cursor: nativePicking ? 'default' : 'pointer', opacity: nativePicking ? 0.6 : 1, padding: '4px 10px', borderRadius: '6px', fontSize: '0.82rem', whiteSpace: 'nowrap' }}
                            >
                                <FolderOpen size={14} /> {nativePicking ? tn('native_waiting') : tn('native_button')}
                            </button>
                        )}
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

                    {nativeError && (
                        <div
                            role="status"
                            className="border-b border-[var(--border-primary)]"
                            style={{ color: '#ef4444', padding: '6px 12px', fontSize: '0.8rem' }}
                        >
                            {nativeError}
                        </div>
                    )}

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
                                    const filePath = canMulti ? itemFilePath(it) : null;
                                    const checked = filePath ? isChecked(filePath) : false;
                                    const key = it.kind === 'search'
                                        ? `s:${it.data.is_dir ? 'd' : 'f'}:${it.data.path}`
                                        : `${it.kind === 'dir' ? 'd' : 'f'}:${it.name}`;
                                    return (
                                        <div
                                            key={key}
                                            id={optionId(i)}
                                            role="option"
                                            aria-selected={filePath ? checked : active}
                                            ref={(el) => { itemRefs.current[i] = el; }}
                                            onClick={() => activate(i)}
                                            onDoubleClick={() => { if (filePath) handleSelectFileNow(filePath); }}
                                            onMouseEnter={() => setHighlightedIndex(i)}
                                            className="text-[var(--text-primary)]"
                                            style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: checked ? 'var(--bg-tertiary, var(--bg-secondary))' : (active ? 'var(--bg-secondary)' : 'transparent'), cursor: 'pointer', borderRadius: '6px', textAlign: 'left', width: '100%' }}
                                        >
                                            {filePath && (
                                                <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    readOnly
                                                    tabIndex={-1}
                                                    aria-hidden="true"
                                                    style={{ pointerEvents: 'none', flexShrink: 0 }}
                                                />
                                            )}
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
                            {canMulti
                                ? (checkedPaths.length > 0
                                    ? tn('selected_count', { defaultValue: "{{count}} files selected", count: checkedPaths.length })
                                    : tn('multi_hint', { defaultValue: "Click to tick several files · double-click to pick just one" }))
                                : tn('keyboard_hints')}
                        </span>
                        <div style={{ display: 'flex', gap: '10px', flexShrink: 0 }}>
                            <button
                                onClick={onClose}
                                className="text-[var(--text-primary)] border border-[var(--border-primary)] hover:bg-[var(--bg-primary)]"
                                style={{ padding: '8px 16px', borderRadius: '6px', background: 'transparent', cursor: 'pointer' }}
                            >
                                {t('common.cancel')}
                            </button>
                            {canMulti && checkedPaths.length > 0 && (
                                <button
                                    onClick={handleConfirmMany}
                                    className="btn-gnosi btn-gnosi-primary"
                                    style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontWeight: 500 }}
                                >
                                    {tn('select_files_count', { defaultValue: "Select {{count}} files", count: checkedPaths.length })}
                                </button>
                            )}
                            {/* With a batch pending, the folder button would be an
                                ambiguous second primary action: hide it. */}
                            {canPickFolder && !(canMulti && checkedPaths.length > 0) && (
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
