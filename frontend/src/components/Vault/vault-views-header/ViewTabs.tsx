import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type CSSProperties,
    type ReactNode,
} from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
    closestCenter,
    DndContext,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
} from '@dnd-kit/core';
import {
    arrayMove,
    horizontalListSortingStrategy,
    SortableContext,
    sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';

import { useModalKeyboard } from '../../../hooks/useModalKeyboard';
import {
    browserViewportSize,
    observeElementResize,
    subscribeWindowEvent,
} from '../../../shared/platform/browser-events';
import { getViewPopoverLayout } from '../viewPopoverLayout';
import { isViewHidden } from '../viewConstants';
import { displayedTabViews } from './viewModel';
import { OverflowViewRow } from './OverflowViewRow';
import { SortableTab } from './SortableTab';
import type { HeaderView, ViewActionHandler } from './types';
import { ViewManagementDialog } from './ViewManagementDialog';

interface ViewTabsProps {
    readonly actions: ReactNode;
    readonly activeViewId?: string | null;
    readonly onAction: ViewActionHandler;
    readonly onAddView: (viewType: string) => unknown;
    readonly onReorderViews?: ((views: readonly HeaderView[]) => unknown) | null;
    readonly onViewSelect?: ((viewId: string) => unknown) | null;
    readonly tabViews: readonly HeaderView[];
    readonly views: readonly HeaderView[];
}

export function ViewTabs({
    actions,
    activeViewId,
    onAction,
    onAddView,
    onReorderViews,
    onViewSelect,
    tabViews,
    views,
}: ViewTabsProps) {
    const { t } = useTranslation();
    const containerRef = useRef<HTMLDivElement>(null);
    const actionsRef = useRef<HTMLDivElement>(null);
    const addViewButtonRef = useRef<HTMLButtonElement>(null);
    const [visibleCount, setVisibleCount] = useState(views.length || 1);
    const [showOverflow, setShowOverflow] = useState(false);
    const [isAddingView, setIsAddingView] = useState(false);
    const [viewPopoverLayout, setViewPopoverLayout] = useState<CSSProperties | null>(null);
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );
    const closeOverflow = useCallback(() => {
        setShowOverflow(false);
    }, []);
    const closeManagement = useCallback(() => {
        setIsAddingView(false);
    }, []);
    useModalKeyboard({ isOpen: showOverflow, onClose: closeOverflow });
    useModalKeyboard({ isOpen: isAddingView, onClose: closeManagement });

    const updateViewPopoverLayout = useCallback(() => {
        const button = addViewButtonRef.current;
        if (!button) return;
        const viewport = browserViewportSize();
        setViewPopoverLayout(getViewPopoverLayout(
            button.getBoundingClientRect(),
            viewport.width,
            viewport.height,
        ));
    }, []);

    useEffect(() => {
        if (!isAddingView) return undefined;
        const unsubscribeResize = subscribeWindowEvent('resize', updateViewPopoverLayout);
        const unsubscribeScroll = subscribeWindowEvent('scroll', updateViewPopoverLayout, true);
        return () => {
            unsubscribeResize();
            unsubscribeScroll();
        };
    }, [isAddingView, updateViewPopoverLayout]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return undefined;
        return observeElementResize(container, (entries) => {
            for (const entry of entries) {
                const actionsWidth = actionsRef.current?.offsetWidth ?? 210;
                const availableForTabs = entry.contentRect.width - actionsWidth - 40;
                const count = Math.max(1, Math.floor((availableForTabs - 60) / 184));
                setVisibleCount(count);
            }
        });
    }, [actionsRef, tabViews.length]);

    const handleDragEnd = (event: DragEndEvent): void => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        const oldIndex = tabViews.findIndex((view) => view.id === active.id);
        const newIndex = tabViews.findIndex((view) => view.id === over.id);
        const newTabOrder = arrayMove([...tabViews], oldIndex, newIndex);
        const hidden = views.filter((view) => isViewHidden(view, views));
        onReorderViews?.([...newTabOrder, ...hidden]);
    };
    const displayViews = displayedTabViews(tabViews, activeViewId, visibleCount);

    return (
        <div
            className="flex items-end justify-between px-2 md:px-4 min-w-0"
            ref={containerRef}
        >
            <div className="flex items-center flex-1 min-w-0 pr-2 md:pr-4">
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                >
                    <div className="flex items-end gap-1 flex-1 pb-0 relative min-w-0">
                        <SortableContext
                            items={displayViews.map((view) => view.id)}
                            strategy={horizontalListSortingStrategy}
                        >
                            {displayViews.slice(0, visibleCount).map((view) => (
                                <SortableTab
                                    key={view.id}
                                    view={view}
                                    tableViews={views}
                                    isActive={activeViewId === view.id}
                                    onSelect={onViewSelect}
                                    onAction={onAction}
                                />
                            ))}
                        </SortableContext>
                        {tabViews.length > visibleCount && (
                            <div className="relative">
                                <button
                                    onClick={() => {
                                        setShowOverflow((visible) => !visible);
                                    }}
                                    className={`p-1 mb-2 rounded transition-colors ${showOverflow
                                        ? 'bg-[var(--bg-tertiary)] text-[var(--gnosi-blue)]'
                                        : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'}`}
                                    title={t('views_header.more_views')}
                                >
                                    <MoreHorizontal size={15} />
                                </button>
                                {showOverflow && (
                                    <>
                                        <div
                                            className="fixed inset-0 z-40"
                                            onClick={closeOverflow}
                                        />
                                        <div className="absolute top-full left-0 mt-1 w-60 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-50 py-1 animate-in fade-in zoom-in-95 duration-100">
                                            <div className="px-3 py-1.5 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
                                                {t('views_header.other_views')}
                                            </div>
                                            {displayViews.slice(visibleCount).map((view) => (
                                                <OverflowViewRow
                                                    key={view.id}
                                                    view={view}
                                                    tableViews={views}
                                                    isActive={activeViewId === view.id}
                                                    onSelect={onViewSelect}
                                                    onAction={onAction}
                                                    onCloseOverflow={closeOverflow}
                                                />
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                        <button
                            ref={addViewButtonRef}
                            type="button"
                            onClick={() => {
                                if (isAddingView) {
                                    setIsAddingView(false);
                                    return;
                                }
                                updateViewPopoverLayout();
                                setIsAddingView(true);
                            }}
                            title={t('views_header.add_view')}
                            aria-label={t('views_header.add_view')}
                            aria-haspopup="dialog"
                            aria-expanded={isAddingView}
                            className="p-1 ml-1 mb-2 rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                        >
                            <Plus size={16} />
                        </button>
                    </div>
                </DndContext>
            </div>
            <div
                className="flex items-center gap-1 md:gap-2 mb-2 shrink-0 ml-1 md:ml-2"
                ref={actionsRef}
            >
                {actions}
            </div>
            {isAddingView && viewPopoverLayout && (
                <ViewManagementDialog
                    activeViewId={activeViewId}
                    layout={viewPopoverLayout}
                    onAction={onAction}
                    onAddView={onAddView}
                    onClose={closeManagement}
                    onReorderViews={onReorderViews}
                    views={views}
                />
            )}
        </div>
    );
}
