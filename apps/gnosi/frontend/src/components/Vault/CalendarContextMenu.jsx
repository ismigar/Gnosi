import React, { useEffect, useRef } from 'react';
import { CalendarPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Menú contextual flotant per al calendari (clic dret).
 */
export const CalendarContextMenu = ({ isOpen, position, onClose, onNewEvent, onDeleteEvent }) => {
    const { t } = useTranslation();
    const menuRef = useRef(null);

    // Tancar quan es clica fora
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
        // Defer per evitar tancar immediatament amb el mateix clic
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

    // Assegurar que el menú no surti de la pantalla
    const style = {
        top: Math.min(position.y, window.innerHeight - 60),
        left: Math.min(position.x, window.innerWidth - 200),
    };

    return (
        <div
            ref={menuRef}
            className="fixed z-[9998] bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700/60 py-1.5 min-w-[180px] animate-in fade-in zoom-in-95 duration-150"
            style={style}
        >
            <button
                onClick={() => { onNewEvent(); onClose(); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left"
            >
                <CalendarPlus size={16} className="text-[var(--gnosi-primary)]" />
                <span className="font-medium">{t('new_event', 'Nova cita')}</span>
            </button>
            {onDeleteEvent && (
                <button
                    onClick={() => { onDeleteEvent(); onClose(); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-left"
                >
                    <span className="text-lg">🗑️</span>
                    <span className="font-medium">{t('delete_event', 'Eliminar')}</span>
                </button>
            )}
        </div>
    );
};

export default CalendarContextMenu;
