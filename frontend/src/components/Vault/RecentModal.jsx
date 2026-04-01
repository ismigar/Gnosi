import React, { useState, useEffect, useRef } from 'react';
import { Search, FileText, Hash, FolderClosed, Clock } from 'lucide-react';

export function RecentModal({ isOpen, onClose, allNotes = [], onNoteSelect }) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const listRef = useRef(null);

    // Filter and sort notes
    const recentNotes = React.useMemo(() => {
        // Sort by last_modified descending
        const sorted = [...allNotes].sort((a, b) => {
            const dateA = new Date(a.last_modified || 0).getTime();
            const dateB = new Date(b.last_modified || 0).getTime();
            return dateB - dateA;
        });

        // Take top 20
        return sorted.slice(0, 20);
    }, [allNotes]);

    useEffect(() => {
        if (isOpen) {
            setSelectedIndex(0);
        }
    }, [isOpen]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (!isOpen) return;

            if (e.key === 'Escape') {
                onClose();
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex(prev => (prev < recentNotes.length - 1 ? prev + 1 : prev));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex(prev => (prev > 0 ? prev - 1 : prev));
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (recentNotes.length > 0 && recentNotes[selectedIndex]) {
                    const selected = recentNotes[selectedIndex];
                    onNoteSelect(selected.id, selected.folder); // Pass ID instead of filename, since loadPage takes ID
                    onClose();
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, recentNotes, selectedIndex, onClose, onNoteSelect]);

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
        return <FileText size={16} className="text-[var(--text-tertiary)]" />;
    };

    const formatDate = (dateString) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleDateString('ca-ES', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return (
        <div className="fixed inset-0 z-[150] flex items-start justify-center pt-[15vh] px-4 sm:p-0">
            {/* Overlay */}
            <div
                className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
                onClick={onClose}
            ></div>

            {/* Modal */}
            <div className="relative bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col font-sans border border-[var(--border-primary)]">
                <div className="flex items-center px-4 py-3 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
                    <Clock size={20} className="text-[var(--text-tertiary)]/70 shrink-0 mr-3" />
                    <h2 className="text-lg font-bold text-[var(--text-primary)] flex-1">Pàgines Recents</h2>
                    <kbd className="hidden sm:inline-flex items-center gap-1 text-[10px] font-bold text-[var(--text-tertiary)]/60 bg-[var(--bg-primary)] px-2 py-1 rounded border border-[var(--border-primary)] shadow-sm">
                        ESC
                    </kbd>
                </div>

                <div className="overflow-y-auto max-h-[60vh] custom-scrollbar" ref={listRef}>
                    {recentNotes.length === 0 ? (
                        <div className="px-6 py-12 text-center text-[var(--text-tertiary)] text-sm">
                            No hi ha pàgines recents per mostrar.
                        </div>
                    ) : (
                        <div className="p-2 space-y-1">
                            {recentNotes.map((note, index) => {
                                const isSelected = index === selectedIndex;
                                return (
                                    <button
                                        key={note.id || note.filename}
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
                                                <h3 className={`text-sm font-bold ${isSelected ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-primary)]'}`}>
                                                    {note.title || note.filename || 'Sense Títol'}
                                                </h3>
                                                <div className="flex items-center gap-2 mt-0.5 opacity-70">
                                                    <span className="text-[11px] font-medium text-[var(--text-secondary)]/60">
                                                        Modificat: {formatDate(note.last_modified)}
                                                    </span>
                                                    {note.folder && (
                                                        <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-secondary)]">
                                                            {note.folder}
                                                        </span>
                                                    )}
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
