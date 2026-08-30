import { createPortal } from 'react-dom';
import type { CSSProperties } from 'react';
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
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useTranslation } from 'react-i18next';

import { browserDocumentBody } from '../../../../shared/platform/browser-events';
import { isMainView, VIEW_TYPES } from '../viewConstants';
import { SortableManageRow } from './SortableManageRow';
import type { HeaderView, ViewActionHandler } from './types';

interface ViewManagementDialogProps {
    readonly activeViewId?: string | null;
    readonly layout: CSSProperties;
    readonly onAction: ViewActionHandler;
    readonly onAddView: (viewType: string) => unknown;
    readonly onClose: () => void;
    readonly onReorderViews?: ((views: readonly HeaderView[]) => unknown) | null;
    readonly views: readonly HeaderView[];
}

export function ViewManagementDialog({
    activeViewId,
    layout,
    onAction,
    onAddView,
    onClose,
    onReorderViews,
    views,
}: ViewManagementDialogProps) {
    const { t } = useTranslation();
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );
    const handleDragEnd = (event: DragEndEvent): void => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        const oldIndex = views.findIndex((view) => view.id === active.id);
        const newIndex = views.findIndex((view) => view.id === over.id);
        onReorderViews?.(arrayMove([...views], oldIndex, newIndex));
    };
    const sortedViews = [...views].sort((left, right) => (
        (isMainView(right, views) ? 1 : 0)
        - (isMainView(left, views) ? 1 : 0)
    ));

    return createPortal(
        <>
            <div
                className="fixed inset-0 z-[var(--z-overlay)]"
                onClick={onClose}
            />
            <div
                role="dialog"
                aria-label={t('views_header.manage_views', 'Views')}
                className="fixed flex flex-col overflow-y-auto bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-[var(--z-popover)] py-1.5 animate-in fade-in zoom-in-95 duration-150"
                style={layout}
            >
                <div className="px-3 py-1 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
                    {t('views_header.manage_views', 'Views')}
                </div>
                <div className="max-h-72 overflow-y-auto px-1">
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                    >
                        <SortableContext
                            items={views.map((view) => view.id)}
                            strategy={verticalListSortingStrategy}
                        >
                            {sortedViews.map((view) => (
                                <SortableManageRow
                                    key={view.id}
                                    view={view}
                                    tableViews={views}
                                    isActive={activeViewId === view.id}
                                    onAction={onAction}
                                />
                            ))}
                        </SortableContext>
                    </DndContext>
                </div>
                <div className="h-px bg-[var(--border-primary)] my-1.5 mx-2" />
                <div className="px-3 py-1 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
                    {t('views_header.add_new_view', 'Add new view')}
                </div>
                {VIEW_TYPES.map((viewType) => {
                    const ViewIcon = viewType.icon;
                    return (
                        <button
                            key={viewType.id}
                            onClick={() => {
                                onClose();
                                onAddView(viewType.id);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors text-left"
                        >
                            <ViewIcon size={14} className="text-[var(--text-tertiary)]" />
                            <span className="capitalize">
                                {t(`view.type_${viewType.id}`, viewType.label)}
                            </span>
                        </button>
                    );
                })}
            </div>
        </>,
        browserDocumentBody(),
    );
}
