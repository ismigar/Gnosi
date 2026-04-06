import React, { useState, useEffect, useRef } from 'react';
import { Search, FileText, Hash, FolderClosed } from 'lucide-react';

export function GlobalSearchModal({ isOpen, onClose, allNotes = [], onNoteSelect }) {
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef(null);
    const listRef = useRef(null);

    // Filter notes based on query
    const filteredNotes = React.useMemo(() => {
        if (!query.trim()) return [];
        const lowerQuery = query.toLowerCase();
        return allNotes.filter(note => {
            const titleMatch = (note.title || '').toLowerCase().includes(lowerQuery);
            const contentMatch = (note.content || '').toLowerCase().includes(lowerQuery); // If we add content search later
            return titleMatch || contentMatch;
        }).slice(0, 10); // Limit results for performance
    }, [query, allNotes]);

    useEffect(() => {
        if (isOpen) {
            setQuery('');
            setSelectedIndex(0);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen]);

    useEffect(() => {
        setSelectedIndex(0);
    }, [query]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (!isOpen) return;

            if (e.key === 'Escape') {
                onClose();
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex(prev => (prev < filteredNotes.length - 1 ? prev + 1 : prev));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex(prev => (prev > 0 ? prev - 1 : prev));
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
    }, [isOpen, filteredNotes, selectedIndex, onClose, onNoteSelect]);

    // Scroll selected item into view
    useEffect(() => {
        if (listRef.current && listRef.current.children[selectedIndex]) {
            const element = listRef.current.children[selectedIndex];
            element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }, [selectedIndex]);

    if (!isOpen) return null;

    const getIcon = (folder) => {
        if (folder === 'Tasques') return <Hash size={16} className="text-[var(--text-tertiary)]" />;
        if (folder === 'Notes') return <FileText size={16} className="text-[var(--text-tertiary)]" />;
        return <FolderClosed size={16} className="text-[var(--text-tertiary)]" />;
    };

    return (
        <div className="fixed inset-0 z-[150] flex items-start justify-center pt-[15vh] px-4 sm:p-0">
            {/* Overlay */}
            <div
                className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
                onClick={onClose}
            ></div>

            {/* Modal */}
            <div className="relative bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col font-sans border border-[var(--border-primary)]">
                <div className="flex items-center px-4 py-3 border-b border-[var(--border-primary)]">
                    <Search size={20} className="text-[var(--text-tertiary)] shrink-0" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Cerca a tot el Vault..."
                        className="w-full bg-transparent border-none focus:ring-0 text-lg px-3 py-1 outline-none text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
                    />
                    <kbd className="hidden sm:inline-flex items-center gap-1 text-[10px] font-medium text-[var(--text-tertiary)] bg-[var(--bg-secondary)] px-2 py-1 rounded border border-[var(--border-primary)]">
                        ESC
                    </kbd>
                </div>

                <div className="overflow-y-auto max-h-[60vh] custom-scrollbar" ref={listRef}>
                    {query.trim() === '' ? (
                        <div className="px-6 py-12 text-center text-[var(--text-secondary)] text-sm">
                            Comença a escriure per cercar notes i bases de dades...
                        </div>
                    ) : filteredNotes.length === 0 ? (
                        <div className="px-6 py-12 text-center text-[var(--text-secondary)] text-sm">
                            No s'ha trobat cap resultat per "{query}"
                        </div>
                    ) : (
                        <div className="p-2 space-y-1">
                            {filteredNotes.map((note, index) => {
                                const isSelected = index === selectedIndex;
                                return (
                                    <button
                                        key={note.id}
                                        onClick={() => {
                                            onNoteSelect(note.id, note.folder);
                                            onClose();
                                        }}
                                        onMouseEnter={() => setSelectedIndex(index)}
                                        className={`w-full flex items-center justify-between p-3 rounded-lg text-left transition-colors ${isSelected ? 'bg-[var(--gnosi-primary)]/10' : 'hover:bg-[var(--bg-secondary)]'
                                            }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            {note.metadata?.icon ? (
                                                <span className="w-4 h-4 flex items-center justify-center text-sm">{note.metadata.icon}</span>
                                            ) : (
                                                getIcon(note.folder)
                                            )}
                                            <div>
                                                <h3 className={`text-sm font-medium ${isSelected ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-primary)]'}`}>
                                                    {note.title || note.id || 'Sense Títol'}
                                                </h3>
                                                <div className="flex items-center gap-2 mt-0.5 opacity-70">
                                                    <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
                                                        {note.folder}
                                                    </span>
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
