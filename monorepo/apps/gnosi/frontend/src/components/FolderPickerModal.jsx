import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { X, Folder, ChevronRight, ArrowLeft, Home, Search } from 'lucide-react';

const joinPath = (...parts) => parts.filter(Boolean).join('/').replace(/\/+/g, '/');

export function FolderPickerModal({ isOpen, onClose, onSelect, initialPath = '' }) {
    const [currentPath, setCurrentPath] = useState(initialPath || '/vault');
    const [displayPath, setDisplayPath] = useState('');
    const [directories, setDirectories] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        if (isOpen) {
            browse(currentPath);
        }
    }, [isOpen]);

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
                // Fins i tot si hi ha error de permisos, mostrem la ruta on hem fallat
                if (data.display_path) setDisplayPath(data.display_path);
                if (data.current_path) setCurrentPath(data.current_path);
            } else {
                setCurrentPath(data.current_path);
                setDisplayPath(data.display_path || data.current_path);
                setDirectories(data.directories || []);
            }
        } catch (err) {
            setError('Error de connexió');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    const filteredDirectories = directories.filter(d =>
        d.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const modalContent = (
        <div className="settings-overlay" onClick={onClose}>
            <div className="settings-modal" style={{ maxWidth: '500px', height: '640px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={(e) => e.stopPropagation()}>
                <div className="settings-modal__header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 20px' }}>
                    <h2 className="settings-modal__title" style={{ margin: 0, fontSize: '1.1em' }}>📁 Seleccionar Carpeta</h2>
                    <button className="settings-modal__close" onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#71717a', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}>
                        <X size={20} />
                    </button>
                </div>

                <div className="settings-modal__content" style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>

                    {/* Path Bar */}
                    <div style={{ padding: '12px', background: '#18181b', borderBottom: '1px solid #27272a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                            <div style={{ fontSize: '0.7rem', color: '#71717a', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ruta real al Mac:</div>
                            <div style={{ fontSize: '0.85em', color: '#60a5fa', wordBreak: 'break-all', background: '#09090b', border: '1px solid #27272a', padding: '8px 10px', borderRadius: '4px', fontFamily: 'monospace', lineHeight: '1.4' }}>
                                {displayPath || currentPath}
                            </div>
                        </div>
                        <button
                            onClick={() => browse(joinPath(currentPath, '..'))}
                            className="p-1 hover:bg-zinc-800 rounded text-zinc-400"
                            title="Pujar un nivell (Up)"
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        >
                            <ArrowLeft size={16} />
                        </button>
                    </div>

                    {/* Shortcuts Bar */}
                    <div style={{ padding: '8px 12px', background: '#09090b', borderBottom: '1px solid #27272a', display: 'flex', gap: '12px', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.75rem', color: '#71717a', fontWeight: '500', textTransform: 'uppercase' }}>Dreceres:</span>
                        <button
                            onClick={() => browse('/vault')}
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'transparent', border: 'none', cursor: 'pointer', color: '#60a5fa', fontSize: '0.85rem' }}
                            className="hover:underline"
                        >
                            <Home size={14} /> Vault
                        </button>
                        <button
                            onClick={() => browse('/Users/ismaelgarciafernandez')}
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'transparent', border: 'none', cursor: 'pointer', color: '#a78bfa', fontSize: '0.85rem' }}
                            className="hover:underline"
                        >
                            <Folder size={14} /> Mac Home
                        </button>
                    </div>

                    {/* Search */}
                    <div style={{ padding: '10px 12px', position: 'relative' }}>
                        <Search size={14} style={{ position: 'absolute', left: '20px', top: '18px', color: '#71717a' }} />
                        <input
                            type="text"
                            placeholder="Filtrar carpetes..."
                            style={{ width: '100%', padding: '6px 12px 6px 30px', background: '#18181b', border: '1px solid #27272a', borderRadius: '6px', fontSize: '0.9em', color: 'white' }}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                {/* Directory List */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '10px', background: '#09090b' }}>
                    {loading ? (
                        <div style={{ textAlign: 'center', padding: '40px', color: '#71717a' }}>Carregant...</div>
                    ) : error ? (
                        <div style={{ color: '#ef4444', padding: '20px', textAlign: 'center' }}>{error}</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            {filteredDirectories.length === 0 && (
                                <div style={{ textAlign: 'center', padding: '20px', color: '#71717a', fontSize: '0.9em' }}>No s'han trobat carpetes</div>
                            )}
                            {filteredDirectories.map(dir => (
                                <button
                                    key={dir}
                                    onClick={() => browse(joinPath(currentPath, dir))}
                                    style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: 'transparent', border: 'none', color: '#e4e4e7', cursor: 'pointer', borderRadius: '6px', textAlign: 'left', transition: 'background 0.2s' }}
                                    className="hover:bg-zinc-800 group"
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
                <div style={{ padding: '15px', borderTop: '1px solid #27272a', background: '#18181b', display: 'flex', justifyContent: 'flex-end', gap: '10px', flexShrink: 0 }}>
                    <button
                        onClick={onClose}
                        style={{ padding: '8px 16px', borderRadius: '6px', background: 'transparent', border: '1px solid #27272a', color: '#e4e4e7', cursor: 'pointer' }}
                    >
                        Cancel·lar
                    </button>
                    <button
                        onClick={() => onSelect(currentPath)}
                        style={{ padding: '8px 16px', borderRadius: '6px', background: '#3b82f6', border: 'none', color: 'white', cursor: 'pointer', fontWeight: '500' }}
                    >
                        Seleccionar
                    </button>
                </div>
            </div>
            </div>
        </div>
    );

    return ReactDOM.createPortal(modalContent, document.body);
}
