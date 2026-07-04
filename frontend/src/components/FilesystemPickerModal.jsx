import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { X, Folder, ChevronRight, ArrowLeft, Home, Search, File as FileIcon } from 'lucide-react';
import { useModalKeyboard } from '../hooks/useModalKeyboard';
import { useTranslation } from 'react-i18next';

const joinPath = (...parts) => parts.filter(Boolean).join('/').replace(/\/+/g, '/');

/**
 * Modal navegador del sistema d'arxius (carpetes + fitxers).
 *
 * Props:
 *   - isOpen, onClose: control de visibilitat.
 *   - mode: 'folder' (per defecte), 'file' o 'any'.
 *       * 'folder': només mostra carpetes; botó "Seleccionar" al peu retorna
 *         la carpeta actual.
 *       * 'file': mostra carpetes i fitxers; clic en un fitxer retorna la
 *         seva ruta.
 *       * 'any': mostra carpetes i fitxers; clic en un fitxer el retorna i el
 *         botó del peu retorna la carpeta actual. Serveix per enllaçar tant
 *         fitxers com carpetes.
 *   - onSelect(absoluteHostPath, { isDir }): la ruta retornada és sempre la
 *     del HOST (la que veu Finder); no la del path mapeat dins de Docker. El
 *     segon argument indica si és una carpeta (sempre false en mode 'file',
 *     sempre true en mode 'folder').
 *   - initialPath: ruta on començar (interna o host).
 *   - initialQuery: text amb què pre-omplir la cerca en obrir-se. Útil quan
 *     ja se sap el nom del fitxer (p.ex. l'usuari ha arrossegat un fitxer i
 *     ara l'ha de localitzar al disc perquè el navegador no en dóna la ruta).
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
    // Resultats de la cerca global. `null` = no s'està buscant (mode browse).
    const [searchResults, setSearchResults] = useState(null);
    const [searchTruncated, setSearchTruncated] = useState(false);
    // Índex de l'element ressaltat a la llista (carpetes/fitxers o resultats de
    // cerca). Compartit per teclat (↑↓) i ratolí (hover), igual que el patró
    // canònic de MultiSelectPills: un sol `highlightedIndex` per a tots dos.
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const modalRef = useRef(null);
    // Contenidor scrollable de la llista (role="listbox"): rep el focus i les
    // fletxes; manté el focus en entrar/sortir de carpetes, així la navegació
    // amb teclat no s'interromp. Patró aria-activedescendant.
    const listRef = useRef(null);
    // Refs a cada opció renderitzada, per fer scrollIntoView de la ressaltada.
    const itemRefs = useRef([]);

    useEffect(() => {
        if (!isOpen) return;
        void browse(initialPath || currentPath || '');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, initialPath]);

    // En obrir-se, pre-omple la cerca amb `initialQuery` (si n'hi ha). El
    // useEffect de cerca debounced ja s'encarrega de llançar la consulta.
    useEffect(() => {
        if (isOpen) setSearchQuery(initialQuery || '');
    }, [isOpen, initialQuery]);

    // Picker de navegació sense una única acció primària (en mode 'file' es
    // selecciona clicant un fitxer de la llista; en 'folder'/'any' el botó del
    // peu). Per això NOMÉS Esc + focus-trap, sense onConfirm. El hook escolta en
    // CAPTURA a window (venç el stopPropagation de BlockNote/ProseMirror).
    useModalKeyboard({
        isOpen,
        onClose,
        containerRef: modalRef,
        trapFocus: true,
    });

    // Cerca global a tot el disk amb debounce. Si el query és curt (<2 chars)
    // tornem a mode browse i mostrem el directori actual.
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

    // En canviar de carpeta o de resultats de cerca, torna a ressaltar el
    // primer element (o cap, si la llista és buida). Així ↑↓ i Enter sempre
    // tenen un punt de partida coherent.
    useEffect(() => {
        const showFilesNow = mode === 'file' || mode === 'any';
        const count = searchResults !== null
            ? searchResults.filter((it) => showFilesNow || it.is_dir).length
            : directories.length + (showFilesNow ? files.length : 0);
        setHighlightedIndex(count > 0 ? 0 : -1);
    }, [currentPath, searchResults, directories, files, mode]);

    // Manté l'element ressaltat visible quan es navega amb el teclat.
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

    // 'file' i 'any' mostren fitxers; 'folder' i 'any' permeten retornar la
    // carpeta actual amb el botó del peu.
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

    // Resultat de cerca: si és carpeta, navega-hi (cal entrar-hi per
    // seleccionar-la amb el botó del peu); si és fitxer i el mode mostra
    // fitxers, seleccionar-lo.
    const handleSearchResultClick = (item) => {
        if (item.is_dir) {
            setSearchQuery('');
            void browse(item.path);
        } else if (showFiles) {
            onSelect(item.path, { isDir: false });
        }
    };

    // ── Navegació amb teclat ──
    // Llista plana i ordenada de tot el que es pot seleccionar ara mateix. Un
    // sol array perquè l'índex ressaltat (↑↓) i les refs casin amb el que es
    // pinta, tant en mode cerca com en mode browse.
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

    // Obre/selecciona l'element a `index`: carpeta → hi entra; fitxer → el
    // retorna; resultat de cerca → delega al seu handler (que ja distingeix).
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

    // Tecles dins la llista (contenidor role="listbox"). El focus hi viu, així
    // que ↑↓ no es perden en entrar/sortir de carpetes.
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
            // → només entra a carpetes (no selecciona fitxers, que seria inesperat).
            case 'ArrowRight': {
                const it = items[highlightedIndex];
                if (it && (it.kind === 'dir' || (it.kind === 'search' && it.data.is_dir))) {
                    e.preventDefault();
                    activate(highlightedIndex);
                }
                break;
            }
            // "Anar enrere": puja un nivell. Dins la llista no s'escriu text,
            // així que ⌫ i ← són segurs per a aquesta drecera (estil Finder).
            case 'Backspace':
            case 'ArrowLeft':
                e.preventDefault();
                goUp();
                break;
            default:
                break;
        }
    };

    // Tecles dins el cercador. ↓ baixa a la llista; Enter obre el ressaltat;
    // ⌫ amb el camp buit puja un nivell (no interfereix mai mentre s'escriu).
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

                    {/* List (role="listbox": el focus hi viu i les fletxes el naveguen) */}
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
