import type { Dispatch, KeyboardEvent, RefObject, SetStateAction } from 'react';
import { useEffect, useRef } from 'react';
import { Columns2, FileText, LayoutPanelLeft, Search } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import {
    canQuickOpenInParallel,
    type QuickOpenItem,
    type QuickOpenPosition,
} from './vaultDocumentTabsModel';


export interface QuickOpenPopoverProps {
    readonly highlightedIndex: number;
    readonly inputRef: RefObject<HTMLInputElement | null>;
    readonly items: readonly QuickOpenItem[];
    readonly onClose: () => void;
    readonly onOpenItem?: (item: QuickOpenItem) => void;
    readonly onOpenParallel?: (item: QuickOpenItem) => void;
    readonly onQueryChange: (query: string) => void;
    readonly position: QuickOpenPosition;
    readonly query: string;
    readonly rootRef: RefObject<HTMLDivElement | null>;
    readonly setHighlightedIndex: Dispatch<SetStateAction<number>>;
}


export function QuickOpenPopover({
    highlightedIndex,
    inputRef,
    items,
    onClose,
    onOpenItem,
    onOpenParallel,
    onQueryChange,
    position,
    query,
    rootRef,
    setHighlightedIndex,
}: QuickOpenPopoverProps) {
    const { t } = useTranslation();
    const itemRefs = useRef<Array<HTMLDivElement | null>>([]);
    const safeIndex = items.length === 0
        ? 0
        : Math.min(highlightedIndex, items.length - 1);

    useEffect(() => {
        itemRefs.current[safeIndex]?.scrollIntoView({ block: 'nearest' });
    }, [items, safeIndex]);

    const openItem = (item: QuickOpenItem): void => {
        if (!onOpenItem) return;
        onOpenItem(item);
        onClose();
    };
    const openParallel = (item: QuickOpenItem): void => {
        if (!onOpenParallel) return;
        onOpenParallel(item);
        onClose();
    };
    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (items.length > 0) {
                setHighlightedIndex((current) => Math.min(current + 1, items.length - 1));
            }
            return;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (items.length > 0) setHighlightedIndex((current) => Math.max(current - 1, 0));
            return;
        }
        if (event.key === 'Enter') {
            const selected = items[safeIndex];
            if (!selected) return;
            event.preventDefault();
            if (
                (event.metaKey || event.ctrlKey)
                && canQuickOpenInParallel(selected, Boolean(onOpenParallel))
            ) openParallel(selected);
            else openItem(selected);
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
        }
    };

    return createPortal(<div
        className="fixed z-[var(--z-popover)] rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-xl"
        ref={rootRef}
        style={position}
    >
        <div className="flex items-center gap-2 border-b border-[var(--border-primary)] px-3 py-2">
            <Search className="text-[var(--text-tertiary)]" size={14} />
            <input
                className="w-full bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
                onChange={(event) => {
                    onQueryChange(event.target.value);
                    setHighlightedIndex(0);
                }}
                onKeyDown={handleKeyDown}
                placeholder={t('doc_tabs.search_placeholder', 'Search pages and tables...')}
                ref={inputRef}
                value={query}
            />
        </div>
        <div className="max-h-72 overflow-y-auto py-1">
            {items.length === 0 ? <div className="px-3 py-4 text-xs text-slate-500">
                {t('doc_tabs.no_results', 'No results')}
            </div> : items.map((item, index) => {
                const highlighted = index === safeIndex;
                return <div
                    className={`flex items-center gap-2 px-2 py-1.5 ${highlighted ? 'bg-indigo-50/20' : 'hover:bg-[var(--bg-secondary)]'}`}
                    key={`${item.type}-${item.id}`}
                    onMouseEnter={() => { setHighlightedIndex(index); }}
                    ref={(element) => { itemRefs.current[index] = element; }}
                >
                    <button
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        onClick={() => { openItem(item); }}
                        type="button"
                    >
                        {item.type === 'table'
                            ? <LayoutPanelLeft className={`shrink-0 ${highlighted ? 'text-indigo-600' : 'text-indigo-500'}`} size={14} />
                            : <FileText className={`shrink-0 ${highlighted ? 'text-indigo-500' : 'text-[var(--text-tertiary)]'}`} size={14} />}
                        <div className="min-w-0">
                            <div className={`truncate text-sm ${highlighted ? 'text-indigo-900' : 'text-[var(--text-primary)]'}`}>
                                {item.title}
                            </div>
                            <div className="truncate text-[11px] text-[var(--text-tertiary)]">
                                {item.subtitle}
                            </div>
                        </div>
                    </button>
                    {canQuickOpenInParallel(item, Boolean(onOpenParallel)) ? <button
                        className={`rounded p-1 transition-colors ${highlighted ? 'text-purple-600 hover:bg-purple-100/20' : 'text-[var(--text-tertiary)] hover:bg-purple-50/10 hover:text-purple-600'}`}
                        onClick={() => { openParallel(item); }}
                        title={item.type === 'table'
                            ? t('doc_tabs.open_table_parallel', 'Open table in parallel')
                            : t('sidebar.open_parallel', 'Open in parallel')}
                        type="button"
                    >
                        <Columns2 size={14} />
                    </button> : null}
                </div>;
            })}
        </div>
    </div>, document.body);
}
