import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, ExternalLink, Columns2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Menú contextual per a wikilinks (clic dret).
 * Ofereix obrir a la mateixa pestanya, en una de nova, o en panell paral·lel.
 */
export const WikilinkContextMenu = ({ isOpen, position, onClose, onOpenSameTab, onOpenNewTab, onOpenParallel }) => {
    const { t } = useTranslation();
    const menuRef = useRef(null);
    const [adjustedPos, setAdjustedPos] = useState(position);

    useEffect(() => {
        if (!isOpen) return;
        const handleClick = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                onClose();
            }
        };
        const handleKey = (e) => {
            if (e.key === 'Escape') onClose();
        };
        const handleScroll = () => onClose();
        // Defer per evitar tancar immediatament amb el mateix clic dret
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
    }, [isOpen, onClose]);

    // Ajustar posició si surt de la pantalla
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
    const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
    const cmdLabel = isMac ? '⌘' : 'Ctrl';

    const items = [
        {
            label: t('wikilink.open_same_tab', 'Obrir aquí'),
            shortcut: t('wikilink.shortcut_click', 'Clic'),
            icon: ArrowRight,
            onClick: onOpenSameTab,
        },
        {
            label: t('wikilink.open_new_tab', 'Obrir en una nova pestanya'),
            shortcut: `${cmdLabel} + ${t('wikilink.shortcut_click', 'Clic')}`,
            icon: ExternalLink,
            onClick: onOpenNewTab,
        },
        {
            label: t('wikilink.open_parallel', 'Obrir en panell paral·lel'),
            shortcut: `⇧ + ${t('wikilink.shortcut_click', 'Clic')}`,
            icon: Columns2,
            onClick: onOpenParallel,
        },
    ];

    const menu = (
        <div
            ref={menuRef}
            className="fixed z-[9999] bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700/60 py-1.5 min-w-[240px] animate-in fade-in zoom-in-95 duration-150"
            style={{ top: pos.y, left: pos.x }}
        >
            {items.map((item) => {
                const Icon = item.icon;
                const enabled = typeof item.onClick === 'function';
                return (
                    <button
                        key={item.label}
                        type="button"
                        disabled={!enabled}
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (enabled) item.onClick();
                            onClose();
                        }}
                        className="w-full flex items-center justify-between gap-4 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-left"
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
