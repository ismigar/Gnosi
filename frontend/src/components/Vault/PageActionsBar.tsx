import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useMediaQuery } from '../../shared/hooks/useMediaQuery';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import {
    buildPageActionItems,
    pageActionButtonClass,
    pageActionIconFill,
    partitionPageActions,
    type PageActionItem,
    type PageActionsConfig,
} from './page-actions-bar/pageActionsBarModel';


interface MenuPosition {
    readonly right: number;
    readonly top: number;
}


export interface PageActionsBarProps {
    readonly compactHeader?: boolean;
    readonly compactOverflowItems?: readonly PageActionItem[];
    readonly containerWidth?: number;
    readonly pageActions?: PageActionsConfig | null;
}


export function PageActionsBar({
    compactHeader = false,
    compactOverflowItems = [],
    containerWidth,
    pageActions,
}: PageActionsBarProps) {
    const { t } = useTranslation();
    const isCompact = useMediaQuery('(max-width: 768px)');
    const [overflowOpen, setOverflowOpen] = useState(false);
    const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const items = useMemo(() => buildPageActionItems(pageActions, t), [pageActions, t]);
    const { inline, overflow } = useMemo(() => partitionPageActions({
        compactHeader,
        compactOverflowItems,
        containerWidth,
        isCompact,
        items,
    }), [compactHeader, compactOverflowItems, containerWidth, isCompact, items]);

    useEffect(() => {
        if (!overflowOpen) return undefined;
        const handler = (event: MouseEvent): void => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (
                menuRef.current && !menuRef.current.contains(target)
                && triggerRef.current && !triggerRef.current.contains(target)
            ) setOverflowOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => { document.removeEventListener('mousedown', handler); };
    }, [overflowOpen]);

    useModalKeyboard({ isOpen: overflowOpen, onClose: () => { setOverflowOpen(false); } });

    if (!items.length && compactOverflowItems.length === 0) return null;
    const showOverflowMenu = overflowOpen && overflow.length > 0 && menuPosition;
    const toggleOverflow = (): void => {
        if (overflowOpen) {
            setOverflowOpen(false);
            return;
        }
        const rect = triggerRef.current?.getBoundingClientRect();
        if (rect) {
            setMenuPosition({
                right: Math.max(8, window.innerWidth - rect.right),
                top: rect.bottom + 6,
            });
        }
        setOverflowOpen(true);
    };

    return <div className="vault-page-actions flex shrink-0 items-center gap-0.5">
        {inline.map((item) => {
            const { Icon } = item;
            return <button
                aria-label={item.label}
                aria-pressed={item.active || undefined}
                className={pageActionButtonClass(item)}
                key={item.key}
                onClick={item.onClick}
                title={item.label}
                type="button"
            ><Icon fill={pageActionIconFill(item)} size={16} /></button>;
        })}

        {overflow.length > 0 ? <button
            aria-expanded={overflowOpen}
            aria-haspopup="menu"
            aria-label={t('shell.page_options', 'Page options')}
            className={`rounded-md p-1.5 transition-colors ${overflowOpen
                ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)]'
                : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]'}`}
            onClick={toggleOverflow}
            ref={triggerRef}
            title={t('shell.page_options', 'Page options')}
            type="button"
        ><MoreHorizontal size={16} /></button> : null}

        {showOverflowMenu ? createPortal(<div
            className="fixed z-[var(--z-popover)] w-56 animate-in rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] py-1 shadow-xl duration-150 fade-in zoom-in-95"
            ref={menuRef}
            role="menu"
            style={{ right: `${String(menuPosition.right)}px`, top: `${String(menuPosition.top)}px` }}
        >
            {overflow.map((item, index) => {
                const { Icon } = item;
                return <Fragment key={item.key}>
                    {item.danger && index > 0
                        ? <div className="my-1 border-t border-[var(--border-primary)]" />
                        : null}
                    <button
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${item.danger
                            ? 'text-red-600 hover:bg-red-500/10'
                            : item.active
                                ? item.activeClassName
                                    || 'text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10'
                                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'}`}
                        onClick={() => {
                            setOverflowOpen(false);
                            item.onClick?.();
                        }}
                        role="menuitem"
                        type="button"
                    >
                        <Icon fill={pageActionIconFill(item)} size={14} />
                        <span>{item.label}</span>
                    </button>
                </Fragment>;
            })}
        </div>, document.body) : null}
    </div>;
}


export default PageActionsBar;
