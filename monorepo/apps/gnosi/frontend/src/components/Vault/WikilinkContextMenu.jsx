import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, ExternalLink, Columns2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Context menu for wikilinks (right click).
 * Offers opening in the same tab, in a new one, or in a side panel.
 * Supports keyboard navigation: ↑ / ↓ between options, Enter to run.
 */
export const WikilinkContextMenu = ({ isOpen, position, onClose, onOpenSameTab, onOpenNewTab, onOpenParallel }) => {
    const { t } = useTranslation();
    const menuRef = useRef(null);
    const [adjustedPos, setAdjustedPos] = useState(position);

    const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
    const cmdLabel = isMac ? '⌘' : 'Ctrl';

    const items = useMemo(() => [
        {
            id: 'sameTab',
            label: t('wikilink.open_same_tab', 'Obrir aquí'),
            shortcut: t('wikilink.shortcut_click', 'Clic'),
            icon: ArrowRight,
            onClick: onOpenSameTab,
        },
        {
            id: 'newTab',
            label: t('wikilink.open_new_tab', 'Obrir en una nova pestanya'),
            shortcut: `${cmdLabel} + ${t('wikilink.shortcut_click', 'Clic')}`,
            icon: ExternalLink,
            onClick: onOpenNewTab,
        },
        {
            id: 'parallel',
            label: t('wikilink.open_parallel', 'Obrir en panell paral·lel'),
            shortcut: `⇧ + ${t('wikilink.shortcut_click', 'Clic')}`,
            icon: Columns2,
            onClick: onOpenParallel,
        },
    ], [t, cmdLabel, onOpenSameTab, onOpenNewTab, onOpenParallel]);

    // Keyboard selection. We start with no selection (-1) so as not to give
    // a visual hint before the user presses an arrow; the first ↓/↑
    // selects the first/last enabled option.
    const [selectedIdx, setSelectedIdx] = useState(-1);

    useEffect(() => {
        if (!isOpen) return;
        setSelectedIdx(-1);
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const enabledIndices = items
            .map((it, i) => (typeof it.onClick === 'function' ? i : -1))
            .filter(i => i >= 0);

        const moveSelection = (delta) => {
            if (enabledIndices.length === 0) return;
            setSelectedIdx(curr => {
                if (curr < 0) {
                    return delta > 0 ? enabledIndices[0] : enabledIndices[enabledIndices.length - 1];
                }
                const pos = enabledIndices.indexOf(curr);
                const nextPos = (pos + delta + enabledIndices.length) % enabledIndices.length;
                return enabledIndices[nextPos];
            });
        };

        const handleClick = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                onClose();
            }
        };
        const handleKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                moveSelection(1);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                moveSelection(-1);
                return;
            }
            if (e.key === 'Home') {
                e.preventDefault();
                if (enabledIndices.length > 0) setSelectedIdx(enabledIndices[0]);
                return;
            }
            if (e.key === 'End') {
                e.preventDefault();
                if (enabledIndices.length > 0) setSelectedIdx(enabledIndices[enabledIndices.length - 1]);
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                // If nothing is selected, Enter runs the first option
                // (standard menu behavior when activated via keyboard).
                const idx = selectedIdx >= 0 ? selectedIdx : (enabledIndices[0] ?? -1);
                const item = items[idx];
                if (item && typeof item.onClick === 'function') {
                    item.onClick();
                }
                onClose();
            }
        };
        const handleScroll = () => onClose();
        // Defer to avoid closing immediately with the same right-click
        const timer = setTimeout(() => {
            document.addEventListener('mousedown', handleClick);
            document.addEventListener('keydown', handleKey);
            window.addEventListener('scroll', handleScroll, true);
        }, 0);
        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handleClick);
            document.removeEventListener('keydown', handleKey);
            window.removeEventListener('scroll', handleScroll, true);
        };
    }, [isOpen, onClose, items, selectedIdx]);

    // Adjust position if it goes off-screen
    useLayoutEffect(() => {
        if (!isOpen || !menuRef.current || !position) return;
        const rect = menuRef.current.getBoundingClientRect();
        const PADDING = 8;
        let { x, y } = position;
        if (x + rect.width > window.innerWidth - PADDING) {
            x = Math.max(PADDING, window.innerWidth - rect.width - PADDING);
        }
        if (y + rect.height > window.innerHeight - PADDING) {
            y = Math.max(PADDING, window.innerHeight - rect.height - PADDING);
        }
        // eslint-disable-next-line react-hooks/set-state-in-effect -- compute position after menu measurement
        setAdjustedPos({ x, y });
    }, [isOpen, position]);

    if (!isOpen || !position) return null;

    const pos = adjustedPos || position;

    const menu = (
        <div
            ref={menuRef}
            role="menu"
            aria-orientation="vertical"
            className="fixed z-[9999] bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700/60 py-1.5 min-w-[240px] animate-in fade-in zoom-in-95 duration-150"
            style={{ top: pos.y, left: pos.x }}
        >
            {items.map((item, idx) => {
                const Icon = item.icon;
                const enabled = typeof item.onClick === 'function';
                const isSelected = idx === selectedIdx;
                return (
                    <button
                        key={item.id}
                        type="button"
                        role="menuitem"
                        disabled={!enabled}
                        aria-disabled={!enabled}
                        onMouseEnter={() => enabled && setSelectedIdx(idx)}
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (enabled) item.onClick();
                            onClose();
                        }}
                        className={`w-full flex items-center justify-between gap-4 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-left ${
                            isSelected
                                ? 'bg-slate-100 dark:bg-slate-800'
                                : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                    >
                        <span className="flex items-center gap-2.5">
                            <Icon size={15} className="text-slate-500 dark:text-slate-400 flex-shrink-0" />
                            <span className="font-medium">{item.label}</span>
                        </span>
                        <span className="text-xs text-slate-400 dark:text-slate-500 font-mono">{item.shortcut}</span>
                    </button>
                );
            })}
        </div>
    );

    return typeof document !== 'undefined' ? createPortal(menu, document.body) : null;
};

export default WikilinkContextMenu;
