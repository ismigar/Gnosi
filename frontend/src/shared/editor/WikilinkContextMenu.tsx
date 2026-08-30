import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Columns2, ExternalLink, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
    subscribeDocumentEvent,
    subscribeWindowEvent,
} from '../platform/browser-events';
import {
    adjustedContextMenuPosition,
    nextEnabledMenuIndex,
    type ContextMenuPosition,
} from './wikilink-context-menu/wikilinkContextMenuModel';


export interface WikilinkContextMenuProps {
    readonly isOpen: boolean;
    readonly onClose: () => void;
    readonly onOpenNewTab?: () => void;
    readonly onOpenParallel?: () => void;
    readonly onOpenSameTab?: () => void;
    readonly position?: ContextMenuPosition | null;
}


interface ContextMenuItem {
    readonly Icon: LucideIcon;
    readonly id: string;
    readonly label: string;
    readonly onClick?: () => void;
    readonly shortcut: string;
}


interface OpenContextMenuProps extends Omit<WikilinkContextMenuProps, 'position'> {
    readonly position: ContextMenuPosition;
}


export function WikilinkContextMenu(props: WikilinkContextMenuProps) {
    if (!props.isOpen || !props.position) return null;
    return <OpenWikilinkContextMenu
        {...props}
        key={`${String(props.position.x)}:${String(props.position.y)}`}
        position={props.position}
    />;
}


function OpenWikilinkContextMenu({
    onClose,
    onOpenNewTab,
    onOpenParallel,
    onOpenSameTab,
    position,
}: OpenContextMenuProps) {
    const { t } = useTranslation();
    const menuRef = useRef<HTMLDivElement | null>(null);
    const selectedIndexRef = useRef(-1);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const [adjustedPosition, setAdjustedPosition] = useState(position);
    const commandLabel = /Mac|iPhone|iPad/u.test(navigator.userAgent) ? '⌘' : 'Ctrl';
    const items = useMemo<readonly ContextMenuItem[]>(() => [
        {
            Icon: ArrowRight,
            id: 'sameTab',
            label: t('wikilink.open_same_tab', 'Open here'),
            onClick: onOpenSameTab,
            shortcut: t('wikilink.shortcut_click', 'Click'),
        },
        {
            Icon: ExternalLink,
            id: 'newTab',
            label: t('wikilink.open_new_tab', 'Open in a new tab'),
            onClick: onOpenNewTab,
            shortcut: `${commandLabel} + ${t('wikilink.shortcut_click', 'Click')}`,
        },
        {
            Icon: Columns2,
            id: 'parallel',
            label: t('wikilink.open_parallel', 'Open in parallel panel'),
            onClick: onOpenParallel,
            shortcut: `⇧ + ${t('wikilink.shortcut_click', 'Click')}`,
        },
    ], [commandLabel, onOpenNewTab, onOpenParallel, onOpenSameTab, t]);
    const enabledIndices = useMemo(() => items.flatMap((item, index) => (
        item.onClick ? [index] : []
    )), [items]);
    const selectIndex = (index: number): void => {
        selectedIndexRef.current = index;
        setSelectedIndex(index);
    };

    useEffect(() => {
        let unsubscribeClick: () => void = () => undefined;
        let unsubscribeKey: () => void = () => undefined;
        let unsubscribeScroll: () => void = () => undefined;
        const timer = window.setTimeout(() => {
            unsubscribeClick = subscribeDocumentEvent('mousedown', (event) => {
                const target = event.target;
                if (target instanceof Node && !menuRef.current?.contains(target)) onClose();
            });
            unsubscribeKey = subscribeDocumentEvent('keydown', (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    onClose();
                    return;
                }
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    selectIndex(nextEnabledMenuIndex(
                        enabledIndices,
                        selectedIndexRef.current,
                        event.key === 'ArrowDown' ? 1 : -1,
                    ));
                    return;
                }
                if (event.key === 'Home' || event.key === 'End') {
                    event.preventDefault();
                    selectIndex(event.key === 'Home'
                        ? enabledIndices[0] ?? -1
                        : enabledIndices.at(-1) ?? -1);
                    return;
                }
                if (event.key !== 'Enter') return;
                event.preventDefault();
                const index = selectedIndexRef.current >= 0
                    ? selectedIndexRef.current
                    : enabledIndices[0] ?? -1;
                items[index]?.onClick?.();
                onClose();
            });
            unsubscribeScroll = subscribeWindowEvent('scroll', onClose, true);
        }, 0);
        return () => {
            window.clearTimeout(timer);
            unsubscribeClick();
            unsubscribeKey();
            unsubscribeScroll();
        };
    }, [enabledIndices, items, onClose]);

    useLayoutEffect(() => {
        let cancelled = false;
        queueMicrotask(() => {
            if (cancelled || !menuRef.current) return;
            const rect = menuRef.current.getBoundingClientRect();
            const nextPosition = adjustedContextMenuPosition(
                position,
                { height: rect.height, width: rect.width },
                { height: window.innerHeight, width: window.innerWidth },
            );
            if (nextPosition.x !== position.x || nextPosition.y !== position.y) {
                setAdjustedPosition(nextPosition);
            }
        });
        return () => { cancelled = true; };
    }, [position]);

    const menu = <div
        aria-orientation="vertical"
        className="fixed z-[var(--z-popover)] min-w-[240px] animate-in rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl duration-150 fade-in zoom-in-95 dark:border-slate-700/60 dark:bg-slate-900"
        ref={menuRef}
        role="menu"
        style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
    >
        {items.map((item, index) => {
            const enabled = Boolean(item.onClick);
            return <button
                aria-disabled={!enabled}
                className={`flex w-full items-center justify-between gap-4 px-3 py-2 text-left text-sm text-slate-700 transition-colors disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-200 ${index === selectedIndex
                    ? 'bg-slate-100 dark:bg-slate-800'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                disabled={!enabled}
                key={item.id}
                onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    item.onClick?.();
                    onClose();
                }}
                onMouseEnter={() => { if (enabled) selectIndex(index); }}
                role="menuitem"
                type="button"
            >
                <span className="flex items-center gap-2.5">
                    <item.Icon className="flex-shrink-0 text-slate-500 dark:text-slate-400" size={15} />
                    <span className="font-medium">{item.label}</span>
                </span>
                <span className="font-mono text-xs text-slate-400 dark:text-slate-500">{item.shortcut}</span>
            </button>;
        })}
    </div>;
    return createPortal(menu, document.body);
}


export default WikilinkContextMenu;
