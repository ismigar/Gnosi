import {
    createElement,
    useCallback,
    useRef,
    useState,
    type CSSProperties,
    type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { GripVertical, Lock, MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { useModalKeyboard } from '../../../hooks/useModalKeyboard';
import {
    browserDocumentBody,
    browserViewportSize,
} from '../../../shared/platform/browser-events';
import {
    getViewIcon,
    isMainView,
    isPageEmbedView,
    isViewHidden,
} from '../viewConstants';
import type {
    HeaderView,
    ViewActionHandler,
    ViewMenuPosition,
} from './types';
import { useOutsidePointer } from './useOutsidePointer';
import { ViewActionMenu } from './ViewActionMenu';

interface SortableManageRowProps {
    readonly isActive: boolean;
    readonly onAction: ViewActionHandler;
    readonly tableViews: readonly HeaderView[];
    readonly view: HeaderView;
}

export function SortableManageRow({
    isActive,
    onAction,
    tableViews,
    view,
}: SortableManageRowProps) {
    const { t } = useTranslation();
    const {
        attributes,
        isDragging,
        listeners,
        setNodeRef,
        transform,
        transition,
    } = useSortable({ id: view.id });
    const [showMenu, setShowMenu] = useState(false);
    const [menuPosition, setMenuPosition] = useState<ViewMenuPosition | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const closeMenu = useCallback(() => {
        setShowMenu(false);
    }, []);
    useOutsidePointer(showMenu, menuRef, closeMenu);
    useModalKeyboard({ isOpen: showMenu, onClose: closeMenu });

    const toggleMenu = (event: MouseEvent<HTMLButtonElement>): void => {
        if (showMenu) {
            setShowMenu(false);
            setMenuPosition(null);
            return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        const { width } = browserViewportSize();
        setMenuPosition({
            top: rect.bottom + 4,
            right: Math.max(8, width - rect.right),
        });
        setShowMenu(true);
    };
    const style: CSSProperties = {
        opacity: isDragging ? 0.5 : 1,
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 100 : 1,
    };
    const isPrimaryView = isMainView(view, tableViews);
    const hidden = isViewHidden(view, tableViews);

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md group/row ${isActive ? 'bg-[var(--gnosi-blue)]/5' : 'hover:bg-[var(--bg-tertiary)]'}`}
        >
            <span
                {...listeners}
                className="cursor-grab active:cursor-grabbing text-[var(--text-tertiary)] shrink-0"
                title={t('views_header.drag_to_reorder', 'Drag to reorder')}
            >
                <GripVertical size={14} />
            </span>
            {createElement(getViewIcon(view.type), {
                size: 14,
                className: `shrink-0 ${hidden
                    ? 'text-[var(--text-tertiary)]/60'
                    : 'text-[var(--text-secondary)]'}`,
            })}
            <span className="flex-1 min-w-0 flex flex-col items-start gap-0.5 py-0.5">
                <span
                    className={`w-full text-xs leading-4 break-words line-clamp-2 ${hidden ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-primary)]'}`}
                    title={view.name ?? undefined}
                >
                    {view.name}
                </span>
                {isPageEmbedView(view) && (
                    <span
                        className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] border border-[var(--border-primary)] font-normal"
                        title={t('views_header.dashboard_view_badge_hint', 'Embedded view from a page or dashboard')}
                    >
                        {t('views_header.dashboard_view_badge', 'Dashboard')}
                    </span>
                )}
            </span>
            {isPrimaryView && (
                <span
                    className="shrink-0 inline-flex items-center justify-center w-7 h-6 text-[var(--text-tertiary)]/70"
                    title={t('views_header.main_view_locked')}
                    aria-label={t('views_header.main_view_locked')}
                >
                    <Lock size={13} />
                </span>
            )}
            <div className="relative shrink-0">
                <button
                    type="button"
                    onClick={toggleMenu}
                    className={`inline-flex items-center justify-center w-7 h-6 rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors ${showMenu ? 'bg-[var(--bg-secondary)]' : ''}`}
                    title={t('views_header.more_actions', 'More actions')}
                    aria-label={t('views_header.more_actions', 'More actions')}
                    aria-haspopup="menu"
                    aria-expanded={showMenu}
                >
                    <MoreHorizontal size={14} />
                </button>
                {showMenu && menuPosition && createPortal(
                    <ViewActionMenu
                        className="fixed w-44 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-[var(--z-popover)] py-1 animate-in fade-in zoom-in-95 duration-100"
                        isPrimaryView={isPrimaryView}
                        menuRef={menuRef}
                        onAction={onAction}
                        onClose={closeMenu}
                        role="menu"
                        style={menuPosition}
                        view={view}
                    />,
                    browserDocumentBody(),
                )}
            </div>
        </div>
    );
}
