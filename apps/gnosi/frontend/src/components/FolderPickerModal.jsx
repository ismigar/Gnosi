import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, Folder, ChevronRight, ArrowLeft, Home, Search } from 'lucide-react';
import { useModalKeyboard } from '../hooks/useModalKeyboard';

const joinPath = (...parts) => parts.filter(Boolean).join('/').replace(/\/+/g, '/');

export function FolderPickerModal({ isOpen, onClose, onSelect, initialPath = '' }) {
    const { t } = useTranslation();
    const [currentPath, setCurrentPath] = useState(initialPath || '/');
    const [displayPath, setDisplayPath] = useState('');
    const [directories, setDirectories] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    // Shortcut targets resolved by the backend (active vault, current user's
    // home, root). `null` until the first browse response — not hardcoded, so
    // the Vault shortcut follows the ACTIVE vault and Home the real user.
    const [roots, setRoots] = useState(null);
    const modalRef = useRef(null);

    useEffect(() => {
        if (isOpen) {
            browserInit();
        }
    }, [isOpen, initialPath]);

    // Rich keyboard logic (Esc closes, Enter selects the current folder,
    // Tab focus-trap, focus restoration): centralized in the canonical hook.
    useModalKeyboard({
        isOpen,
        onClose,
        onConfirm: () => onSelect(currentPath),
        containerRef: modalRef,
        trapFocus: true,
    });

    const browserInit = async () => {
        const startPath = initialPath || currentPath || '/';
        await browse(startPath);
    };

    const browse = async (path) => {
        setLoading(true);
        setError('');
        try {
            const res = await fetch('/api/system/browse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path })
            });
            const data = await res.json();
            // The backend returns `roots` on every response (success or error),
            // so the shortcuts stay populated even when the initial path is bad.
            if (data.roots) setRoots(data.roots);
            if (data.error) {
                // Prefer the localized message keyed by `error_code`; fall back to
                // the raw English `error` for anything unmapped.
                setError(data.error_code ? t('fs_picker.errors.' + data.error_code, data.error) : data.error);
                // Even if there's a permissions error, we show the path where we failed
                if (data.display_path) setDisplayPath(data.display_path);
                if (data.current_path) setCurrentPath(data.current_path);
            } else {
                setCurrentPath(data.current_path);
                setDisplayPath(data.display_path || data.current_path);
                setDirectories(data.directories || []);
            }
        } catch (err) {
            setError(t('fs_picker.connection_error', 'Error de connexió'));
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    const filteredDirectories = directories.filter(d =>
        d.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const modalContent = (
        // The `active` class is REQUIRED because `.settings-overlay` without `active`
        // has `display: none` set in GlobalSettingsModal.css. Without
        // this class, the portal remains invisible (and clicks pass
        // through due to `pointer-events: none`).
        <div className="settings-overlay active" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div ref={modalRef} className="settings-modal active" style={{ maxWidth: '500px', height: '640px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onMouseDown={(e) => e.stopPropagation()}>
                <div className="settings-modal__header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 20px' }}>
                    <h2 className="settings-modal__title" style={{ margin: 0, fontSize: '1.1em' }}>📁 {t('fs_picker.title_folder', 'Seleccionar Carpeta')}</h2>
                    <button className="gnosi-close-btn" onClick={onClose} aria-label={t('fs_picker.close', 'Tancar')}>
                        <X />
                    </button>
                </div>

                <div className="settings-modal__content" style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>

                    {/* Path Bar */}
                    <div style={{ padding: '12px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('fs_picker.real_path', 'Ruta real al Mac:')}</div>
                            <div style={{ fontSize: '0.85em', color: '#60a5fa', wordBreak: 'break-all', background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', padding: '8px 10px', borderRadius: '4px', fontFamily: 'monospace', lineHeight: '1.4' }}>
                                {displayPath || currentPath}
                            </div>
                        </div>
                        <button
                            onClick={() => browse(joinPath(currentPath, '..'))}
                            className="p-1 folder-picker-item rounded text-zinc-400"
                            title={t('folder_picker.go_up', 'Pujar un nivell (Up)')}
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        >
                            <ArrowLeft size={16} />
                        </button>
                    </div>

                    {/* Shortcuts Bar */}
                    <div style={{ padding: '8px 12px', background: 'var(--bg-primary)', borderBottom: '1px solid var(--border-primary)', display: 'flex', gap: '12px', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: '500', textTransform: 'uppercase' }}>{t('fs_picker.shortcuts', 'Dreceres:')}</span>
                        <button
                            onClick={() => roots?.vault && browse(roots.vault)}
                            disabled={!roots?.vault}
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'transparent', border: 'none', cursor: roots?.vault ? 'pointer' : 'default', opacity: roots?.vault ? 1 : 0.4, color: '#60a5fa', fontSize: '0.85rem' }}
                            className="hover:underline"
                        >
                            <Home size={14} /> {t('fs_picker.vault', 'Vault')}
                        </button>
                        <button
                            onClick={() => roots?.home && browse(roots.home)}
                            disabled={!roots?.home}
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'transparent', border: 'none', cursor: roots?.home ? 'pointer' : 'default', opacity: roots?.home ? 1 : 0.4, color: '#a78bfa', fontSize: '0.85rem' }}
                            className="hover:underline"
                        >
                            <Folder size={14} /> {t('fs_picker.home', 'Home')}
                        </button>
                        <button
                            onClick={() => browse(roots?.root || '/')}
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'transparent', border: 'none', cursor: 'pointer', color: '#f43f5e', fontSize: '0.85rem' }}
                            className="hover:underline"
                        >
                            <Folder size={14} /> {t('fs_picker.root', 'Root (/)')}
                        </button>
                    </div>

                    {/* Search */}
                    <div style={{ padding: '10px 12px', position: 'relative' }}>
                        <Search size={14} style={{ position: 'absolute', left: '20px', top: '18px', color: 'var(--text-tertiary)' }} />
                        <input
                            type="text"
                            placeholder={t('folder_picker.filter_placeholder', 'Filtrar carpetes...')}
                            style={{ width: '100%', padding: '6px 12px 6px 30px', background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '6px', fontSize: '0.9em', color: 'var(--text-primary)' }}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                {/* Directory List */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '10px', background: 'var(--bg-primary)' }}>
                    {loading ? (
                        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-tertiary)' }}>{t('common.loading')}</div>
                    ) : error ? (
                        <div style={{ color: 'var(--status-error)', padding: '20px', textAlign: 'center' }}>{error}</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            {filteredDirectories.length === 0 && (
                                <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-tertiary)', fontSize: '0.9em' }}>{t('fs_picker.no_folders', "No s'han trobat carpetes")}</div>
                            )}
                            {filteredDirectories.map(dir => (
                                <button
                                    key={dir}
                                    onClick={() => browse(joinPath(currentPath, dir))}
                                    style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', borderRadius: '6px', textAlign: 'left', transition: 'background 0.2s' }}
                                    className="folder-picker-item group"
                                >
                                    <Folder size={18} className="text-indigo-400" />
                                    <span style={{ flex: 1 }}>{dir}</span>
                                    <ChevronRight size={14} className="text-zinc-600 group-hover:text-zinc-400" />
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div style={{ padding: '15px', borderTop: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', display: 'flex', justifyContent: 'flex-end', gap: '10px', flexShrink: 0 }}>
                    <button
                        onClick={onClose}
                        style={{ padding: '8px 16px', borderRadius: '6px', background: 'transparent', border: '1px solid var(--border-primary)', color: 'var(--text-primary)', cursor: 'pointer' }}
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        data-autofocus="true"
                        onClick={() => onSelect(currentPath)}
                        style={{ padding: '8px 16px', borderRadius: '6px', background: 'var(--gnosi-primary)', border: 'none', color: 'white', cursor: 'pointer', fontWeight: '500' }}
                    >
                        {t('folder_picker.select_btn', 'Seleccionar')}
                    </button>
                </div>
            </div>
            </div>
        </div>
    );

    return ReactDOM.createPortal(modalContent, document.body);
}
