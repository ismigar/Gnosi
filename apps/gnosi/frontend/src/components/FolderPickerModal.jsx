import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { X, Folder, ChevronRight, ArrowLeft, Home, Search } from 'lucide-react';

const joinPath = (...parts) => parts.filter(Boolean).join('/').replace(/\/+/g, '/');

export function FolderPickerModal({ isOpen, onClose, onSelect, initialPath = '' }) {
    const { t } = useTranslation();
    const [currentPath, setCurrentPath] = useState(initialPath || '/');
    const [displayPath, setDisplayPath] = useState('');
    const [directories, setDirectories] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [searchQuery, setSearchQuery] = useState('');

    // Sincronitzar la ruta quan el modal s'obra
    useEffect(() => {
        if (isOpen) {
            const startPath = initialPath || '/Users/ismaelgarciafernandez';
            setCurrentPath(startPath);
            browse(startPath);
        }
    }, [isOpen, initialPath]);

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
            if (data.error) {
                setError(data.error);
                if (data.display_path) setDisplayPath(data.display_path);
                if (data.current_path) setCurrentPath(data.current_path);
            } else {
                setCurrentPath(data.current_path);
                setDisplayPath(data.display_path || data.current_path);
                setDirectories(data.directories || []);
            }
        } catch (err) {
            setError(t('Connection error', 'Connection error'));
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen || typeof document === 'undefined') return null;

    const filteredDirectories = directories.filter(d =>
        d.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const modalContent = (
        <div className="settings-overlay flex items-center justify-center" onClick={onClose} style={{ zIndex: 9999 }}>
            <div className="settings-modal bg-gnosi text-gnosi border-gnosi shadow-2xl" style={{ maxWidth: '540px', width: '90%', height: '640px', display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 10000 }} onClick={(e) => e.stopPropagation()}>
                <div className="settings-modal__header border-b-gnosi" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px' }}>
                    <h2 className="settings-modal__title" style={{ margin: 0, fontSize: '1.2em', fontWeight: '600' }}>{t('Select Folder', 'Select Folder')}</h2>
                    <button className="settings-modal__close hover:bg-gnosi-hover" onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: '6px', borderRadius: '50%', display: 'flex', alignItems: 'center', transition: 'background 0.2s' }}>
                        <X size={20} />
                    </button>
                </div>

                <div className="settings-modal__content" style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>

                    {/* Path Bar */}
                    <div className="bg-gnosi-secondary border-b-gnosi" style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                            <div style={{ fontSize: '0.7rem', opacity: 0.6, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: '600' }}>{t('Path on Mac:', 'Path on Mac:')}</div>
                            <div className="bg-gnosi border-gnosi" style={{ fontSize: '0.9em', color: 'var(--accent-primary)', wordBreak: 'break-all', padding: '8px 12px', borderRadius: '6px', fontFamily: 'monospace', lineHeight: '1.4' }}>
                                {displayPath || currentPath}
                            </div>
                        </div>
                        <button
                            onClick={() => browse(joinPath(currentPath, '..'))}
                            className="btn-gnosi btn-gnosi-secondary"
                            title={t('Up', 'Up')}
                            style={{ padding: '8px', borderRadius: '10px' }}
                        >
                            <ArrowLeft size={18} />
                        </button>
                    </div>

                    {/* Shortcuts Bar */}
                    <div className="bg-gnosi border-b-gnosi" style={{ padding: '10px 20px', display: 'flex', gap: '16px', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.75rem', opacity: 0.5, fontWeight: '700', textTransform: 'uppercase' }}>{t('Shortcuts:', 'Shortcuts:')}</span>
                        <button
                            onClick={() => browse('/Users/ismaelgarciafernandez')}
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--accent-primary)', fontSize: '0.9rem', fontWeight: '500' }}
                            className="hover:underline"
                        >
                            <Folder size={16} /> Mac Home
                        </button>
                    </div>

                    {/* Search */}
                    <div style={{ padding: '12px 20px', position: 'relative' }}>
                        <Search size={16} style={{ position: 'absolute', left: '32px', top: '23px', opacity: 0.5 }} />
                        <input
                            type="text"
                            placeholder={t('Filter folders...', 'Filter folders...')}
                            className="bg-gnosi-secondary border-gnosi"
                            style={{ width: '100%', padding: '10px 12px 10px 38px', borderRadius: '8px', fontSize: '0.95em', color: 'inherit' }}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    {/* Directory List */}
                    <div className="bg-gnosi" style={{ flex: 1, overflowY: 'auto', padding: '10px 20px' }}>
                        {loading ? (
                            <div style={{ textAlign: 'center', padding: '60px', opacity: 0.5 }}>{t('Searching...', 'Searching...')}</div>
                        ) : error ? (
                            <div style={{ color: 'var(--danger)', padding: '30px', textAlign: 'center', fontWeight: '500' }}>{error}</div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                {filteredDirectories.length === 0 && (
                                    <div style={{ textAlign: 'center', padding: '30px', opacity: 0.5, fontSize: '0.95em' }}>{t('No folders found', 'No folders found')}</div>
                                )}
                                {filteredDirectories.map(dir => (
                                    <button
                                        key={dir}
                                        onClick={() => browse(joinPath(currentPath, dir))}
                                        style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', borderRadius: '8px', textAlign: 'left', transition: 'background 0.2s' }}
                                        className="folder-picker__item group hover:bg-gnosi-hover"
                                    >
                                        <Folder size={20} className="text-accent" style={{ color: 'var(--accent-primary)' }} />
                                        <span style={{ flex: 1, fontWeight: '500' }}>{dir}</span>
                                        <ChevronRight size={16} style={{ opacity: 0.3 }} className="group-hover:opacity-100" />
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Footer Actions */}
                    <div className="bg-gnosi-secondary border-t-gnosi" style={{ padding: '16px 20px', display: 'flex', justifyContent: 'flex-end', gap: '12px', flexShrink: 0 }}>
                        <button
                            onClick={onClose}
                            className="btn-gnosi btn-gnosi-secondary"
                        >
                            {t('Cancel', 'Cancel')}
                        </button>
                        <button
                            onClick={() => onSelect(currentPath)}
                            className="btn-gnosi btn-gnosi-primary"
                        >
                            {t('Select', 'Select')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
}
