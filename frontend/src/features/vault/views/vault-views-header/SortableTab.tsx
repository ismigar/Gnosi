import {
    createElement,
    useCallback,
    useRef,
    useState,
    type CSSProperties,
} from 'react';
import { Lock, MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { useModalKeyboard } from '../../../../shared/hooks/useModalKeyboard';
import { getViewIcon, isMainView } from '../viewConstants';
import type { HeaderView, ViewActionHandler } from './types';
import { useOutsidePointer } from './useOutsidePointer';
import { ViewActionMenu } from './ViewActionMenu';

interface SortableTabProps {
    readonly isActive: boolean;
    readonly onAction: ViewActionHandler;
    readonly onSelect?: ((viewId: string) => unknown) | null;
    readonly tableViews: readonly HeaderView[];
    readonly view: HeaderView;
}

export function SortableTab({
    isActive,
    onAction,
    onSelect,
    tableViews,
    view,
}: SortableTabProps) {
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
    const menuRef = useRef<HTMLDivElement>(null);
    const closeMenu = useCallback(() => {
        setShowMenu(false);
    }, []);
    useOutsidePointer(showMenu, menuRef, closeMenu);
    useModalKeyboard({ isOpen: showMenu, onClose: closeMenu });

    const style: CSSProperties = {
        opacity: isDragging ? 0.5 : 1,
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 100 : 1,
    };
    const isPrimaryView = isMainView(view, tableViews);

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            className="relative flex items-center shrink-0"
        >
            <div
                className={`w-[184px] flex items-center gap-1.5 px-3 pt-1.5 pb-0 text-xs font-medium transition-all rounded-t-md border-b-2 mr-1 cursor-pointer ${isActive
                    ? 'text-[var(--gnosi-blue)] border-[var(--gnosi-blue)] bg-[var(--bg-primary)] shadow-[0_-2px_5px_-1px_rgba(var(--gnosi-primary-rgb),0.1)]'
                    : 'text-[var(--text-tertiary)] border-transparent hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'}`}
                onClick={() => {
                    onSelect?.(view.id);
                }}
                title={view.name ?? undefined}
            >
                <span
                    {...listeners}
                    className="cursor-grab active:cursor-grabbing flex items-center"
                    onClick={(event) => {
                        event.stopPropagation();
                    }}
                    title={t('views_header.drag_to_reorder', 'Drag to reorder')}
                >
                    {createElement(getViewIcon(view.type), {
                        size: 13,
                        className: isActive
                            ? 'text-[var(--gnosi-blue)]'
                            : 'text-[var(--text-tertiary)]',
                    })}
                </span>
                <span className="truncate flex-1 min-w-0" title={view.name ?? undefined}>
                    {view.name}
                </span>
                {isPrimaryView && (
                    <span
                        className="inline-flex items-center px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[10px] text-[var(--text-tertiary)] border border-[var(--border-primary)]"
                        title={t('views_header.main_view')}
                        aria-label={t('views_header.main_view')}
                    >
                        <Lock size={10} />
                    </span>
                )}
                <div
                    onClick={(event) => {
                        event.stopPropagation();
                        setShowMenu((visible) => !visible);
                    }}
                    className={`p-0.5 rounded hover:bg-[var(--bg-tertiary)] transition-colors ml-0.5 ${showMenu ? 'bg-[var(--bg-tertiary)]' : ''}`}
                >
                    <MoreHorizontal size={13} />
                </div>
            </div>
            {showMenu && (
                <ViewActionMenu
                    className="absolute top-full left-0 mt-1 w-44 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-[var(--z-popover)] py-1 animate-in fade-in zoom-in-95 duration-100 font-normal"
                    isPrimaryView={isPrimaryView}
                    menuRef={menuRef}
                    onAction={onAction}
                    onClose={closeMenu}
                    view={view}
                />
            )}
        </div>
    );
}
