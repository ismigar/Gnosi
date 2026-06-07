import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { X, Folder, ChevronRight, ArrowLeft, Home, Search, File as FileIcon } from 'lucide-react';
import { useModalKeyboard } from '../hooks/useModalKeyboard';

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
    const modalRef = useRef(null);

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
            } catch (err) {
                setError('Error de connexió');
                setSearchResults([]);
            } finally {
                setLoading(false);
            }
        }, 300);
        return () => clearTimeout(handle);
    }, [isOpen, searchQuery]);

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
        } catch (err) {
            setError('Error de connexió');
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
        ? 'Seleccionar fitxer o carpeta'
        : (mode === 'file' ? 'Seleccionar fitxer' : 'Seleccionar carpeta');
    const searchPlaceholder = mode === 'folder'
        ? 'Cerca carpetes a tot el Mac (≥2 caràcters)...'
        : 'Cerca a tot el Mac (≥2 caràcters)...';

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
                        aria-label="Tancar"
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
                            <div className="text-[var(--text-tertiary)]" style={{ fontSize: '0.7rem', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ruta real al Mac:</div>
                            <div
                                className="bg-[var(--bg-primary)] border border-[var(--border-primary)] text-[var(--gnosi-primary)]"
                                style={{ fontSize: '0.85em', wordBreak: 'break-all', padding: '8px 10px', borderRadius: '4px', fontFamily: 'monospace', lineHeight: '1.4' }}
                            >
                                {displayPath || currentPath || '—'}
                            </div>
                        </div>
                        <button
                            onClick={() => browse(joinPath(currentPath, '..'))}
                            title="Pujar un nivell"
                            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        >
                            <ArrowLeft size={16} />
                        </button>
                    </div>

                    {/* Shortcuts */}
                    <div
                        className="bg-[var(--bg-primary)] border-b border-[var(--border-primary)]"
                        style={{ padding: '8px 12px', display: 'flex', gap: '12px', alignItems: 'center' }}
                    >
                        <span className="text-[var(--text-tertiary)]" style={{ fontSize: '0.75rem', fontWeight: 500, textTransform: 'uppercase' }}>Dreceres:</span>
                        <button
                            onClick={() => browse('/vault')}
                            className="text-[var(--gnosi-primary)] hover:underline"
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '0.85rem' }}
                        >
                            <Home size={14} /> Vault
                        </button>
                        <button
                            onClick={() => browse('/Users/ismaelgarciafernandez')}
                            className="hover:underline"
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'transparent', border: 'none', cursor: 'pointer', color: '#a78bfa', fontSize: '0.85rem' }}
                        >
                            <Folder size={14} /> Home
                        </button>
                        <button
                            onClick={() => browse('/')}
                            className="hover:underline"
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'transparent', border: 'none', cursor: 'pointer', color: '#f43f5e', fontSize: '0.85rem' }}
                        >
                            <Folder size={14} /> Root (/)
                        </button>
                    </div>

                    {/* Search */}
                    <div style={{ padding: '10px 12px', position: 'relative' }}>
                        <Search size={14} className="text-[var(--text-tertiary)]" style={{ position: 'absolute', left: '20px', top: '18px' }} />
                        <input
                            type="text"
                            placeholder={searchPlaceholder}
                            className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)]"
                            style={{ width: '100%', padding: '6px 12px 6px 30px', borderRadius: '6px', fontSize: '0.9em' }}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    {/* List */}
                    <div className="bg-[var(--bg-primary)]" style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
                        {loading ? (
                            <div className="text-[var(--text-tertiary)]" style={{ textAlign: 'center', padding: '40px' }}>
                                {isSearching ? 'Cercant a tot el Mac...' : 'Carregant...'}
                            </div>
                        ) : error ? (
                            <div style={{ color: '#ef4444', padding: '20px', textAlign: 'center' }}>{error}</div>
                        ) : isSearching ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                {searchResults.length === 0 ? (
                                    <div className="text-[var(--text-tertiary)]" style={{ textAlign: 'center', padding: '20px', fontSize: '0.9em' }}>
                                        Cap resultat per a “{searchQuery}”
                                    </div>
                                ) : (
                                    <>
                                        {searchResults
                                            .filter((item) => showFiles || item.is_dir)
                                            .map((item) => (
                                                <button
                                                    key={`${item.is_dir ? 'd' : 'f'}:${item.path}`}
                                                    onClick={() => handleSearchResultClick(item)}
                                                    className="text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] group"
                                                    style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: '6px', textAlign: 'left', width: '100%' }}
                                                >
                                                    {item.is_dir
                                                        ? <Folder size={18} className="text-[var(--gnosi-primary)]" />
                                                        : <FileIcon size={18} className="text-[var(--text-secondary)]" />}
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                                                        <div className="text-[var(--text-tertiary)]" style={{ fontSize: '0.72rem', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                            {item.path}
                                                        </div>
                                                    </div>
                                                    {item.is_dir && (
                                                        <ChevronRight size={14} className="text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]" />
                                                    )}
                                                </button>
                                            ))}
                                        {searchTruncated && (
                                            <div className="text-[var(--text-tertiary)]" style={{ textAlign: 'center', padding: '10px', fontSize: '0.78rem', fontStyle: 'italic' }}>
                                                Massa resultats — afina la cerca per veure'n més
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                {visibleDirectories.length === 0 && visibleFiles.length === 0 && (
                                    <div className="text-[var(--text-tertiary)]" style={{ textAlign: 'center', padding: '20px', fontSize: '0.9em' }}>
                                        {showFiles ? "No s'han trobat fitxers ni carpetes" : "No s'han trobat carpetes"}
                                    </div>
                                )}
                                {visibleDirectories.map((dir) => (
                                    <button
                                        key={`d:${dir}`}
                                        onClick={() => browse(joinPath(currentPath, dir))}
                                        className="text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] group"
                                        style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: '6px', textAlign: 'left' }}
                                    >
                                        <Folder size={18} className="text-[var(--gnosi-primary)]" />
                                        <span style={{ flex: 1 }}>{dir}</span>
                                        <ChevronRight size={14} className="text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]" />
                                    </button>
                                ))}
                                {showFiles && visibleFiles.map((file) => (
                                    <button
                                        key={`f:${file}`}
                                        onClick={() => handleSelectFile(file)}
                                        className="text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
                                        style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: '6px', textAlign: 'left' }}
                                    >
                                        <FileIcon size={18} className="text-[var(--text-secondary)]" />
                                        <span style={{ flex: 1 }}>{file}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div
                        className="bg-[var(--bg-secondary)] border-t border-[var(--border-primary)]"
                        style={{ padding: '15px', display: 'flex', justifyContent: 'flex-end', gap: '10px', flexShrink: 0 }}
                    >
                        <button
                            onClick={onClose}
                            className="text-[var(--text-primary)] border border-[var(--border-primary)] hover:bg-[var(--bg-primary)]"
                            style={{ padding: '8px 16px', borderRadius: '6px', background: 'transparent', cursor: 'pointer' }}
                        >
                            Cancel·lar
                        </button>
                        {canPickFolder && (
                            <button
                                onClick={handleSelectCurrentFolder}
                                className="btn-gnosi btn-gnosi-primary"
                                style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontWeight: 500 }}
                            >
                                Seleccionar aquesta carpeta
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );

    return ReactDOM.createPortal(modalContent, document.body);
}
