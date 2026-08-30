import { useEffect, useRef } from 'react';
import { CalendarPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Floating context menu for the calendar (right-click).
 */
export interface CalendarContextMenuProps {
    readonly isOpen: boolean;
    readonly onClose: () => void;
    readonly onDeleteEvent?: () => void;
    readonly onNewEvent: () => void;
    readonly position: { readonly x: number; readonly y: number };
}

export const CalendarContextMenu = ({
    isOpen,
    position,
    onClose,
    onNewEvent,
    onDeleteEvent,
}: CalendarContextMenuProps) => {
    const { t } = useTranslation();
    const menuRef = useRef<HTMLDivElement>(null);

    // Close when clicking outside
    useEffect(() => {
        if (!isOpen) return;
        const handleClick = (event: MouseEvent) => {
            if (
                menuRef.current
                && event.target instanceof Node
                && !menuRef.current.contains(event.target)
            ) {
                onClose();
            }
        };
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        // Defer to avoid closing immediately with the same click
        setTimeout(() => {
            document.addEventListener('mousedown', handleClick);
            document.addEventListener('keydown', handleKey);
        }, 0);
        return () => {
            document.removeEventListener('mousedown', handleClick);
            document.removeEventListener('keydown', handleKey);
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    // Make sure the menu doesn't go off screen
    const style = {
        top: Math.min(position.y, window.innerHeight - 60),
        left: Math.min(position.x, window.innerWidth - 200),
    };

    return (
        <div
            ref={menuRef}
            className="fixed z-[var(--z-popover)] bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700/60 py-1.5 min-w-[180px] animate-in fade-in zoom-in-95 duration-150"
            style={style}
        >
            <button
                onClick={() => { onNewEvent(); onClose(); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left"
            >
                <CalendarPlus size={16} className="text-[var(--gnosi-primary)]" />
                <span className="font-medium">{t('calendar.new_event', "New appointment")}</span>
            </button>
            {onDeleteEvent && (
                <button
                    onClick={() => { onDeleteEvent(); onClose(); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-left"
                >
                    <span className="text-lg">🗑️</span>
                    <span className="font-medium">{t('calendar.delete', "Delete")}</span>
                </button>
            )}
        </div>
    );
};

export default CalendarContextMenu;
