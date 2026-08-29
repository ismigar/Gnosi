import { createElement, useCallback, useRef, useState } from 'react';
import { Lock, MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useModalKeyboard } from '../../../hooks/useModalKeyboard';
import { getViewIcon, isMainView } from '../viewConstants';
import type { HeaderView, ViewActionHandler } from './types';
import { useOutsidePointer } from './useOutsidePointer';
import { ViewActionMenu } from './ViewActionMenu';

interface OverflowViewRowProps {
    readonly isActive: boolean;
    readonly onAction: ViewActionHandler;
    readonly onCloseOverflow?: (() => void) | null;
    readonly onSelect?: ((viewId: string) => unknown) | null;
    readonly tableViews: readonly HeaderView[];
    readonly view: HeaderView;
}

export function OverflowViewRow({
    isActive,
    onAction,
    onCloseOverflow,
    onSelect,
    tableViews,
    view,
}: OverflowViewRowProps) {
    const { t } = useTranslation();
    const [showMenu, setShowMenu] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const closeMenu = useCallback(() => {
        setShowMenu(false);
    }, []);
    const closeMenuAndOverflow = useCallback(() => {
        setShowMenu(false);
        onCloseOverflow?.();
    }, [onCloseOverflow]);
    useOutsidePointer(showMenu, menuRef, closeMenu);
    useModalKeyboard({ isOpen: showMenu, onClose: closeMenu });

    const isPrimaryView = isMainView(view, tableViews);

    return (
        <div
            className={`group/overflow-row relative flex items-center justify-between px-3 py-1.5 text-xs transition-colors ${isActive
                ? 'text-[var(--gnosi-blue)] bg-[var(--gnosi-blue)]/5 font-medium'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'}`}
        >
            <button
                type="button"
                onClick={() => {
                    onSelect?.(view.id);
                    onCloseOverflow?.();
                }}
                className="flex items-center gap-2 flex-1 min-w-0 text-left"
            >
                {createElement(getViewIcon(view.type), {
                    size: 13,
                    className: 'shrink-0',
                })}
                <span className="truncate flex-1 min-w-0" title={view.name ?? undefined}>
                    {view.name}
                </span>
                {isPrimaryView && (
                    <span
                        className="shrink-0 inline-flex items-center text-[9px] px-1.5 py-0.5 rounded border border-[var(--border-primary)] bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]"
                        title={t('views_header.main_view')}
                        aria-label={t('views_header.main_view')}
                    >
                        <Lock size={9} />
                    </span>
                )}
            </button>
            <div className="relative shrink-0 ml-1">
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        setShowMenu((visible) => !visible);
                    }}
                    className={`p-0.5 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors ${showMenu ? 'bg-[var(--bg-secondary)]' : ''}`}
                    title={t('views_header.more_actions', 'More actions')}
                    aria-label={t('views_header.more_actions', 'More actions')}
                    aria-haspopup="menu"
                    aria-expanded={showMenu}
                >
                    <MoreHorizontal size={13} />
                </button>
                {showMenu && (
                    <ViewActionMenu
                        className="absolute right-0 top-full mt-1 w-44 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-[var(--z-popover)] py-1 animate-in fade-in zoom-in-95 duration-100 font-normal"
                        isPrimaryView={isPrimaryView}
                        menuRef={menuRef}
                        onAction={onAction}
                        onClose={closeMenuAndOverflow}
                        role="menu"
                        stopPropagation
                        view={view}
                    />
                )}
            </div>
        </div>
    );
}
