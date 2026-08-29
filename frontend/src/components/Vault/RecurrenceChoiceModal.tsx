import { useRef } from 'react';
import { Trash2, CalendarPlus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useModalKeyboard } from '../../hooks/useModalKeyboard';

interface RecurrenceChoiceModalProps {
    readonly actionType?: 'delete' | 'modify';
    readonly isOpen: boolean;
    readonly message: string;
    readonly onClose: () => unknown;
    readonly onConfirm: (
        isSeries: boolean,
        isInstanceOnly: boolean,
        isFollowing: boolean,
    ) => unknown;
    readonly title: string;
}

export const RecurrenceChoiceModal = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    actionType = 'delete',
}: RecurrenceChoiceModalProps) => {
    const { t } = useTranslation();
    const modalRef = useRef<HTMLDivElement>(null);

    // Rich keyboard logic: Esc closes, Enter confirms the default option
    // (only this instance), Tab focus-trap, focus restoration. See
    // useModalKeyboard. (Replaces the old RecurrenceKeyboardHandler.)
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
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" />
            <div ref={modalRef} className="relative bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-3xl p-8 max-w-md w-full shadow-2xl animate-in zoom-in-95 duration-200" role="dialog" aria-modal="true" aria-label={title}>
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
                            {isDelete ? t('calendar.delete_instance', "Only this instance") : t('calendar.modify_instance', "Only this instance")}
                        </div>
                        <div className="text-xs text-[var(--text-tertiary)] mt-1">
                            {isDelete ? t('calendar.delete_instance_desc', "Deletes only this occurrence.") : t('calendar.modify_instance_desc', "Applies the change only to the selected event.")}
                        </div>
                    </button>
                    
                    <button 
                        onClick={() => onConfirm(false, false, true)}
                        className={`w-full p-4 rounded-2xl border text-left transition-all ${seriesBg} opacity-90`}
                    >
                        <div className={`font-bold ${seriesText}`}>
                            {isDelete ? t('calendar.delete_following', "This and following") : t('calendar.modify_following', "This and following")}
                        </div>
                        <div className={`text-xs ${seriesText} opacity-60 mt-1`}>
                            {isDelete ? t('calendar.delete_following_desc', "Deletes this event and all future repetitions.") : t('calendar.modify_following_desc', "Splits the series and applies the changes from here on.")}
                        </div>
                    </button>

                    <button 
                        onClick={() => onConfirm(true, false, false)}
                        className={`w-full p-4 rounded-2xl border text-left transition-all ${seriesBg}`}
                    >
                        <div className={`font-bold ${seriesText}`}>
                            {isDelete ? t('calendar.delete_series', "Entire series") : t('calendar.modify_series', "Entire series")}
                        </div>
                        <div className={`text-xs ${seriesText} opacity-60 mt-1`}>
                            {isDelete ? t('calendar.delete_series_desc', "Permanently deletes all repetitions (past and future).") : t('calendar.modify_series_desc', "Applies the change to every repetition in the series.")}
                        </div>
                    </button>
                </div>
                <button 
                    onClick={onClose}
                    className="w-full mt-6 p-4 rounded-2xl font-bold text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] transition-all"
                >
                    {t('common.cancel', "Cancel")}
                </button>
            </div>
        </div>
    );
};
