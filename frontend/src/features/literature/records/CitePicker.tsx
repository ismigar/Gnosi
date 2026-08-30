import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Quote, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useModalKeyboard } from '../../../shared/hooks/useModalKeyboard';
import { logError } from '../../../shared/notifications/notifyError';
import {
    searchCitations,
    type CitationSearchItem,
} from '../../../shared/api/citations';


interface CitePickerProps {
    readonly isOpen: boolean;
    readonly onClose: () => void;
    readonly onSelect?: (item: CitationSearchItem) => void;
}


interface OpenCitePickerProps extends Omit<CitePickerProps, 'isOpen'> {
    readonly portalElement: HTMLElement;
}


function getCitePickerPortal(): HTMLElement | null {
    if (typeof document === 'undefined') return null;
    const existing = document.getElementById('cite-picker-root');
    if (existing) return existing;
    const element = document.createElement('div');
    element.id = 'cite-picker-root';
    document.body.append(element);
    return element;
}


function OpenCitePicker({
    onClose,
    onSelect,
    portalElement,
}: OpenCitePickerProps) {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const [items, setItems] = useState<CitationSearchItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    useModalKeyboard({
        isOpen: true,
        onClose,
        containerRef: panelRef,
        trapFocus: true,
    });

    useEffect(() => {
        let controller: AbortController | null = null;
        const timer = setTimeout(() => {
            controller = new AbortController();
            const signal = controller.signal;
            setLoading(true);
            void searchCitations(query, 30, signal)
                .then((results) => {
                    if (signal.aborted) return;
                    setItems(results);
                    setActiveIndex(0);
                })
                .catch((error: unknown) => {
                    if (signal.aborted) return;
                    logError('cite-picker.search', error);
                    setItems([]);
                })
                .finally(() => {
                    if (!signal.aborted) setLoading(false);
                });
        }, 200);
        return () => {
            clearTimeout(timer);
            controller?.abort();
        };
    }, [query]);

    useEffect(() => {
        const frame = requestAnimationFrame(() => {
            inputRef.current?.focus();
        });
        return () => {
            cancelAnimationFrame(frame);
        };
    }, []);

    const handleSelect = useCallback((item: CitationSearchItem): void => {
        if (!item.citation_key) return;
        try {
            onSelect?.(item);
        } catch (error) {
            logError('cite-picker.select', error);
        }
        onClose();
    }, [onClose, onSelect]);
    const handleKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>): void => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((current) => Math.min(
                current + 1,
                Math.max(items.length - 1, 0),
            ));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((current) => Math.max(current - 1, 0));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const item = items[activeIndex];
            if (item) handleSelect(item);
        }
    }, [activeIndex, handleSelect, items]);

    useEffect(() => {
        const active = listRef.current?.querySelector(`[data-idx="${String(activeIndex)}"]`);
        active?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex]);

    return createPortal(
        <div
            className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center bg-black/40 pt-24"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div
                className="w-full max-w-2xl overflow-hidden rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-2xl"
                onMouseDown={(event) => {
                    event.stopPropagation();
                }}
                ref={panelRef}
            >
                <div className="flex items-center gap-3 border-b border-[var(--border-secondary)] px-4 py-3">
                    <Search className="shrink-0 text-[var(--text-tertiary)]" size={18} />
                    <input
                        autoComplete="off"
                        className="flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
                        onChange={(event) => {
                            setQuery(event.target.value);
                        }}
                        onKeyDown={handleKeyDown}
                        placeholder={t('cite_picker.placeholder', {
                            defaultValue: 'Search by citation key, title or author…',
                        })}
                        ref={inputRef}
                        spellCheck={false}
                        type="text"
                        value={query}
                    />
                    <button
                        className="shrink-0 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                        onClick={onClose}
                        title={t('common.close', { defaultValue: 'Close' })}
                        type="button"
                    ><X size={18} /></button>
                </div>
                <div className="max-h-[60vh] overflow-y-auto" ref={listRef}>
                    {loading && items.length === 0 ? (
                        <div className="px-4 py-6 text-center text-sm text-[var(--text-tertiary)]">
                            {t('cite_picker.loading', { defaultValue: 'Searching…' })}
                        </div>
                    ) : null}
                    {!loading && items.length === 0 ? (
                        <div className="px-4 py-6 text-center text-sm text-[var(--text-tertiary)]">
                            {t('cite_picker.no_results', {
                                defaultValue: 'No results. Try another term.',
                            })}
                        </div>
                    ) : null}
                    {items.map((item, index) => {
                        const isActive = index === activeIndex;
                        const metadata = [item.author, item.year].filter(Boolean).join(', ');
                        return (
                            <button
                                className={`flex w-full items-start gap-3 border-b border-[var(--border-secondary)] px-4 py-3 text-left transition-colors last:border-b-0 ${isActive ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}
                                data-idx={index}
                                key={`${item.id || item.citation_key || 'citation'}-${String(index)}`}
                                onClick={() => {
                                    handleSelect(item);
                                }}
                                onMouseEnter={() => {
                                    setActiveIndex(index);
                                }}
                                type="button"
                            >
                                <Quote className="mt-0.5 shrink-0 text-[var(--gnosi-primary)]" size={16} />
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 truncate text-sm font-medium text-[var(--text-primary)]">
                                        <span className="shrink-0 rounded bg-[var(--bg-secondary)] px-1.5 py-0.5 font-mono text-xs text-[var(--gnosi-primary)]">
                                            @{item.citation_key}
                                        </span>
                                        <span className="truncate">{item.title || '—'}</span>
                                    </div>
                                    {metadata ? (
                                        <div className="mt-0.5 truncate text-xs text-[var(--text-tertiary)]">
                                            {metadata}
                                        </div>
                                    ) : null}
                                </div>
                            </button>
                        );
                    })}
                </div>
                <div className="flex gap-4 border-t border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-4 py-2 text-xs text-[var(--text-tertiary)]">
                    <span>↑↓ {t('cite_picker.hint_navigate', { defaultValue: 'navigate' })}</span>
                    <span>↵ {t('cite_picker.hint_insert', { defaultValue: 'insert' })}</span>
                    <span>Esc {t('cite_picker.hint_close', { defaultValue: 'close' })}</span>
                </div>
            </div>
        </div>,
        portalElement,
    );
}


export function CitePicker({ isOpen, onClose, onSelect }: CitePickerProps) {
    const portalElement = useMemo(() => getCitePickerPortal(), []);
    if (!isOpen || !portalElement) return null;
    return (
        <OpenCitePicker
            onClose={onClose}
            onSelect={onSelect}
            portalElement={portalElement}
        />
    );
}


export default CitePicker;
