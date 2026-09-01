import type { DragEndEvent } from '@dnd-kit/core';
import {
    DndContext,
    KeyboardSensor,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import {
    SortableContext,
    arrayMove,
    horizontalListSortingStrategy,
    sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { subscribeAppEvent } from '../../../shared/platform/app-events';
import {
    subscribeDocumentEvent,
    subscribeWindowEvent,
} from '../../../shared/platform/browser-events';
import { QuickOpenPopover } from './vault-document-tabs/QuickOpenPopover';
import { SortableDocumentTab } from './vault-document-tabs/SortableDocumentTab';
import {
    calculateQuickOpenPosition,
    filterQuickOpenItems,
    isEditableDocumentTarget,
    tabIndexForShortcut,
    type DocumentTab,
    type QuickOpenItem,
    type QuickOpenPosition,
} from './vault-document-tabs/vaultDocumentTabsModel';


export interface VaultDocumentTabsProps {
    readonly activeTabId?: string | null;
    readonly onQuickOpenItem?: (item: QuickOpenItem) => void;
    readonly onQuickOpenParallel?: (item: QuickOpenItem) => void;
    readonly onReorderTabs?: (tabs: DocumentTab[]) => void;
    readonly onTabClose: (tabId: string) => void;
    readonly onTabSelect: (tabId: string) => void;
    readonly onToggleSplit: (tabId: string) => void;
    readonly quickOpenItems?: readonly QuickOpenItem[];
    readonly splitTabIds?: readonly string[];
    readonly tabs?: readonly DocumentTab[];
}


function runtimeViewportWidth(): number {
    return typeof window === 'undefined' ? 0 : window.innerWidth;
}


export function VaultDocumentTabs({
    activeTabId,
    onQuickOpenItem,
    onQuickOpenParallel,
    onReorderTabs,
    onTabClose,
    onTabSelect,
    onToggleSplit,
    quickOpenItems = [],
    splitTabIds = [],
    tabs = [],
}: VaultDocumentTabsProps) {
    const { t } = useTranslation();
    const [isQuickOpenVisible, setIsQuickOpenVisible] = useState(false);
    const [query, setQuery] = useState('');
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const [dropdownPosition, setDropdownPosition] = useState<QuickOpenPosition>(
        () => calculateQuickOpenPosition(null, runtimeViewportWidth()),
    );
    const quickOpenRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const plusButtonRef = useRef<HTMLButtonElement | null>(null);
    const splitSet = useMemo(() => new Set(splitTabIds), [splitTabIds]);
    const filteredItems = useMemo(
        () => filterQuickOpenItems(quickOpenItems, query),
        [query, quickOpenItems],
    );
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );
    const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/u.test(
        navigator.userAgent,
    );
    const quickOpenShortcutLabel = isMac ? 'Cmd+T' : 'Ctrl+T';
    const tabJumpShortcutLabel = isMac ? 'Cmd+1..9' : 'Ctrl+1..9';

    const closeQuickOpen = useCallback((): void => {
        setIsQuickOpenVisible(false);
        setQuery('');
        setHighlightedIndex(0);
    }, []);
    const updateDropdownPosition = useCallback((): void => {
        setDropdownPosition(calculateQuickOpenPosition(
            plusButtonRef.current?.getBoundingClientRect() ?? null,
            runtimeViewportWidth(),
        ));
    }, []);
    const openQuickOpen = useCallback((): void => {
        updateDropdownPosition();
        setHighlightedIndex(0);
        setIsQuickOpenVisible(true);
    }, [updateDropdownPosition]);

    useEffect(() => {
        if (!isQuickOpenVisible) return undefined;
        const handleDocumentClick = (event: MouseEvent): void => {
            if (
                event.target instanceof Node
                && quickOpenRef.current
                && !quickOpenRef.current.contains(event.target)
                && !plusButtonRef.current?.contains(event.target)
            ) closeQuickOpen();
        };
        return subscribeDocumentEvent('mousedown', handleDocumentClick);
    }, [closeQuickOpen, isQuickOpenVisible]);

    useEffect(() => {
        if (!isQuickOpenVisible) return undefined;
        const timer = window.setTimeout(() => { inputRef.current?.focus(); }, 0);
        const unsubscribeResize = subscribeWindowEvent('resize', updateDropdownPosition);
        const unsubscribeScroll = subscribeWindowEvent('scroll', updateDropdownPosition, true);
        return () => {
            window.clearTimeout(timer);
            unsubscribeResize();
            unsubscribeScroll();
        };
    }, [isQuickOpenVisible, updateDropdownPosition]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent): void => {
            if (isEditableDocumentTarget(event.target)) return;
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 't') {
                event.preventDefault();
                openQuickOpen();
                return;
            }
            if (event.metaKey || event.ctrlKey) {
                const tabIndex = tabIndexForShortcut(event.key, tabs.length);
                if (tabIndex !== null) {
                    event.preventDefault();
                    const tab = tabs[tabIndex];
                    if (tab) onTabSelect(tab.id);
                    return;
                }
            }
            if (event.key === 'Escape') closeQuickOpen();
        };
        return subscribeWindowEvent('keydown', handleKeyDown);
    }, [closeQuickOpen, onTabSelect, openQuickOpen, tabs]);

    useEffect(() => subscribeAppEvent(
        'gnosi:quick-open-document',
        openQuickOpen,
    ), [openQuickOpen]);

    const handleDragEnd = (event: DragEndEvent): void => {
        if (!event.over || event.active.id === event.over.id || !onReorderTabs) return;
        const oldIndex = tabs.findIndex(({ id }) => id === event.active.id);
        const newIndex = tabs.findIndex(({ id }) => id === event.over?.id);
        if (oldIndex < 0 || newIndex < 0) return;
        onReorderTabs(arrayMove([...tabs], oldIndex, newIndex));
    };

    return <div className={`vault-document-tabs relative flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 pb-0 pt-1 ${tabs.length === 1 ? 'vault-document-tabs--single' : ''}`}>
        {tabs.length !== 1 ? <DndContext
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            sensors={sensors}
        >
            <SortableContext
                items={tabs.map(({ id }) => id)}
                strategy={horizontalListSortingStrategy}
            >
                {tabs.map((tab) => <SortableDocumentTab
                    canSplit={!tab.isTable}
                    isActive={tab.id === activeTabId}
                    isSplit={splitSet.has(tab.id)}
                    key={tab.id}
                    onTabClose={onTabClose}
                    onTabSelect={onTabSelect}
                    onToggleSplit={onToggleSplit}
                    tab={tab}
                />)}
            </SortableContext>
        </DndContext> : null}
        <button
            className={`${tabs.length === 1 ? 'hidden' : 'ml-1'} flex h-8 w-8 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-indigo-700`}
            onClick={() => {
                if (isQuickOpenVisible) closeQuickOpen();
                else openQuickOpen();
            }}
            ref={plusButtonRef}
            title={t('doc_tabs.new_tab_tooltip', {
                defaultValue: 'New tab or quick search ({{shortcut}}). Switch tab: {{tabShortcut}}',
                shortcut: quickOpenShortcutLabel,
                tabShortcut: tabJumpShortcutLabel,
            })}
            type="button"
        >
            <Plus size={16} />
        </button>
        {isQuickOpenVisible ? <QuickOpenPopover
            highlightedIndex={highlightedIndex}
            inputRef={inputRef}
            items={filteredItems}
            onClose={closeQuickOpen}
            onOpenItem={onQuickOpenItem}
            onOpenParallel={onQuickOpenParallel}
            onQueryChange={setQuery}
            position={dropdownPosition}
            query={query}
            rootRef={quickOpenRef}
            setHighlightedIndex={setHighlightedIndex}
        /> : null}
    </div>;
}
