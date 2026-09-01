import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type SetStateAction,
} from 'react';
import { Search, FileText, Hash, FolderClosed, Clock, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isCalendarPage } from '../../../shared/records/model/schemaUtils';
import { useModalKeyboard } from '../../../shared/hooks/useModalKeyboard';
import { subscribeWindowEvent } from '../../../shared/platform/browser-events';
import { IconRenderer } from '../../../shared/ui/previews/IconRenderer';
import { getIntlLocale } from '../../../shared/i18n/locales/registry';
import {
    openVaultNote,
    selectRecentNotes,
    type VaultQuickNote,
} from '../../../shared/routing/vaultQuickNavigation';


export interface RecentModalProps {
    readonly allNotes?: readonly VaultQuickNote[];
    readonly isOpen: boolean;
    readonly onClose: () => unknown;
    readonly onNoteSelect?: (pageId: string) => void;
}


interface SelectionState {
    readonly index: number;
    readonly open: boolean;
}


function displayText(value: unknown): string {
    return typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'boolean'
        ? String(value)
        : '';
}


function noteIcon(note: VaultQuickNote): string | undefined {
    const icon = note.metadata?.icon;
    return typeof icon === 'string' && icon ? icon : undefined;
}

export function RecentModal({
    isOpen,
    onClose,
    allNotes = [],
    onNoteSelect,
}: RecentModalProps) {
    const { t, i18n } = useTranslation();
    const [selection, setSelection] = useState<SelectionState>({
        index: 0,
        open: isOpen,
    });
    const listRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const selectedIndex = selection.open === isOpen ? selection.index : 0;
    const setSelectedIndex = useCallback((value: SetStateAction<number>): void => {
        setSelection((previous) => {
            const currentIndex = previous.open === isOpen ? previous.index : 0;
            return {
                index: typeof value === 'function' ? value(currentIndex) : value,
                open: isOpen,
            };
        });
    }, [isOpen]);

    // Esc + focus-trap centralized in the canonical hook. We do NOT pass onConfirm:
    // Enter in this modal selects the highlighted item (its own handler).
    useModalKeyboard({ isOpen, onClose, containerRef: panelRef, trapFocus: true });

    // Filter and sort notes
    const recentNotes = useMemo(() => {
        // Filter out calendar pages
        const filtered = allNotes.filter((page) => !isCalendarPage(page));

        return selectRecentNotes(filtered, 20);
    }, [allNotes]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent): void => {
            if (!isOpen) return;

            if (event.key === 'ArrowDown') {
                event.preventDefault();
                setSelectedIndex((previous) => (
                    previous < recentNotes.length - 1 ? previous + 1 : previous
                ));
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setSelectedIndex((previous) => (previous > 0 ? previous - 1 : previous));
            } else if (event.key === 'Enter') {
                event.preventDefault();
                if (recentNotes.length > 0 && recentNotes[selectedIndex]) {
                    const selected = recentNotes[selectedIndex];
                    openVaultNote(onNoteSelect, selected);
                    onClose();
                }
            }
        };

        return subscribeWindowEvent('keydown', handleKeyDown);
    }, [isOpen, recentNotes, selectedIndex, onNoteSelect, onClose, setSelectedIndex]);

    // Scroll selected item into view
    useEffect(() => {
        const element = listRef.current?.children.item(selectedIndex);
        if (element instanceof HTMLElement
            && typeof element.scrollIntoView === 'function') {
            element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }, [selectedIndex]);

    if (!isOpen) return null;

    const getIcon = (folder: unknown) => {
        if (folder === 'Tasques') return <Hash size={16} className="text-[var(--text-tertiary)]" />;
        if (folder === 'Notes') return <FileText size={16} className="text-[var(--text-tertiary)]" />;
        return <FileText size={16} className="text-[var(--text-tertiary)]" />;
    };

    const formatDate = (dateString: string | number | Date | null | undefined) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleDateString(getIntlLocale(i18n.resolvedLanguage || i18n.language), {
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
            ></div>

            {/* Modal */}
            <div ref={panelRef} className="relative bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col font-sans border border-[var(--border-primary)]" role="dialog" aria-modal="true" aria-labelledby="recent-modal-title">
                <div className="flex items-center px-4 py-3 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
                    <Clock size={20} className="text-[var(--text-tertiary)]/70 shrink-0 mr-3" />
                    <h2 id="recent-modal-title" className="text-lg font-bold text-[var(--text-primary)] flex-1">{t('vault.recent.title')}</h2>
                    <kbd className="hidden sm:inline-flex items-center gap-1 text-[10px] font-bold text-[var(--text-tertiary)]/60 bg-[var(--bg-primary)] px-2 py-1 rounded border border-[var(--border-primary)] shadow-sm">
                        ESC
                    </kbd>
                    <button
                        type="button"
                        onClick={onClose}
                        className="ml-2 rounded p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
                        aria-label={t('common.close', 'Close')}
                    >
                        <X size={16} />
                    </button>
                </div>

                <div className="overflow-y-auto max-h-[60vh] custom-scrollbar" ref={listRef}>
                    {recentNotes.length === 0 ? (
                        <div className="px-6 py-12 text-center text-[var(--text-tertiary)] text-sm">
                            {t('vault.recent.empty')}
                        </div>
                    ) : (
                        <div className="p-2 space-y-1">
                            {recentNotes.map((note, index) => {
                                const isSelected = index === selectedIndex;
                                const folder = displayText(note.folder);
                                const icon = noteIcon(note);
                                return (
                                    <button
                                        key={note.id || displayText(note.filename)}
                                        onClick={() => {
                                            openVaultNote(onNoteSelect, note);
                                            onClose();
                                        }}
                                        onMouseEnter={() => {
                                            setSelectedIndex(index);
                                        }}
                                        className={`w-full flex items-center justify-between p-3 rounded-lg text-left transition-colors ${isSelected ? 'bg-[var(--gnosi-primary)]/10' : 'hover:bg-[var(--bg-secondary)]'
                                            }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            {icon ? (
                                                <IconRenderer icon={icon} size={16} className="shrink-0" />
                                            ) : (
                                                getIcon(note.folder)
                                            )}
                                            <div>
                                                <h3 className={`text-sm font-bold ${isSelected ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-primary)]'}`}>
                                                    {displayText(note.title) || displayText(note.filename) || t('common.untitled')}
                                                </h3>
                                                <div className="flex items-center gap-2 mt-0.5 opacity-70">
                                                    <span className="text-[11px] font-medium text-[var(--text-secondary)]/60">
                                                        {t('vault.recent.modified')} {formatDate(note.last_modified)}
                                                    </span>
                                                    {folder && (
                                                        <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-secondary)]">
                                                            {folder}
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
