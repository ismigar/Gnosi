import React, { useRef } from 'react';
import { Trash2, CalendarPlus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';

export const RecurrenceChoiceModal = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    actionType = 'delete', // 'delete' | 'modify'
}) => {
    const { t } = useTranslation();
    const modalRef = useRef(null);

    // Lògica rica de teclat: Esc tanca, Enter confirma l'opció per defecte
    // (només aquesta instància), Tab focus-trap, restauració de focus. Veure
    // useModalKeyboard. (Substitueix l'antic RecurrenceKeyboardHandler.)
    useModalKeyboard({
        isOpen,
        onClose,
        onConfirm: () => onConfirm(false, true, false),
        containerRef: modalRef,
        trapFocus: true,
    });

    if (!isOpen) return null;

    const isDelete = actionType === 'delete';
    const Icon = isDelete ? Trash2 : CalendarPlus;
    const accentColor = isDelete ? 'text-red-500' : 'text-[var(--gnosi-primary)]';
    const bgColor = isDelete ? 'bg-red-500/10' : 'bg-[var(--gnosi-primary)]/10';
    const seriesBg = isDelete ? 'bg-red-500/5 hover:bg-red-500/10 border-red-500/20' : 'bg-[var(--gnosi-primary)]/5 hover:bg-[var(--gnosi-primary)]/10 border-[var(--gnosi-primary)]/20';
    const seriesText = isDelete ? 'text-red-500' : 'text-[var(--gnosi-primary)]';

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onMouseDown={onClose} />
            <div ref={modalRef} onMouseDown={(e) => e.stopPropagation()} className="relative bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-3xl p-8 max-w-md w-full shadow-2xl animate-in zoom-in-95 duration-200">
                <div className="flex items-center gap-4 mb-6">
                    <div className={`p-3 ${bgColor} rounded-2xl ${accentColor}`}><Icon size={24} /></div>
                    <h3 className="text-xl font-black tracking-tight">{title}</h3>
                </div>
                <p className="text-[var(--text-secondary)] mb-8 leading-relaxed">
                    {message}
                </p>
                <div className="flex flex-col gap-3">
                    <button
                        data-autofocus="true"
                        onClick={() => onConfirm(false, true, false)}
                        className="w-full p-4 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-primary)] hover:border-[var(--gnosi-primary)] text-left transition-all group"
                    >
                        <div className="font-bold text-[var(--text-primary)] group-hover:text-[var(--gnosi-primary)]">
                            {isDelete ? t('calendar.delete_instance', 'Només aquesta instància') : t('calendar.modify_instance', 'Només aquesta instància')}
                        </div>
                        <div className="text-xs text-[var(--text-tertiary)] mt-1">
                            {isDelete ? t('calendar.delete_instance_desc', 'Elimina només la cita d\'avui.') : t('calendar.modify_instance_desc', 'Aplica el canvi només a la cita seleccionada.')}
                        </div>
                    </button>
                    
                    <button 
                        onClick={() => onConfirm(false, false, true)}
                        className={`w-full p-4 rounded-2xl border text-left transition-all ${seriesBg} opacity-90`}
                    >
                        <div className={`font-bold ${seriesText}`}>
                            {isDelete ? t('calendar.delete_following', 'Aquesta i les següents') : t('calendar.modify_following', 'Aquesta i les següents')}
                        </div>
                        <div className={`text-xs ${seriesText} opacity-60 mt-1`}>
                            {isDelete ? t('calendar.delete_following_desc', 'Elimina aquesta cita i totes les futures repeticions.') : t('calendar.modify_following_desc', 'Crea un tall a la sèrie i aplica els canvis d\'aquí en endavant.')}
                        </div>
                    </button>

                    <button 
                        onClick={() => onConfirm(true, false, false)}
                        className={`w-full p-4 rounded-2xl border text-left transition-all ${seriesBg}`}
                    >
                        <div className={`font-bold ${seriesText}`}>
                            {isDelete ? t('calendar.delete_series', 'Tota la sèrie') : t('calendar.modify_series', 'Tota la sèrie')}
                        </div>
                        <div className={`text-xs ${seriesText} opacity-60 mt-1`}>
                            {isDelete ? t('calendar.delete_series_desc', 'Elimina permanentment totes les repeticions (passades i futures).') : t('calendar.modify_series_desc', 'Aplica el canvi a totes les repeticions de la sèrie.')}
                        </div>
                    </button>
                </div>
                <button 
                    onClick={onClose}
                    className="w-full mt-6 p-4 rounded-2xl font-bold text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] transition-all"
                >
                    {t('common.cancel', 'Cancel·lar')}
                </button>
            </div>
        </div>
    );
};
